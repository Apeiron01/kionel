// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createIdentity, verifyDispatch, type Bytes } from "@kionel/crypto";
import {
  createReceiverKey, createTransferCode, formatTransferCode, isCodeWire, issueReceiverCard, normalizeTransferCode,
  openOneWay, openWithCode, sealOneWay, sealWithCode, verifyReceiverCard,
} from "./oneway.ts";

const bytes = (text: string): Bytes => new TextEncoder().encode(text) as Bytes;
const context = { profile: "lab", classification: "restricted", reference: "LIMS-2026-0042" } as const;

describe("tek yönlü aktarım (gönderende kamera yok)", () => {
  it("kartla mühürlenen dosya alıcıda açılır ve sevk kaydı içeriğe bağlıdır", async () => {
    const [sender, receiver] = await Promise.all([createIdentity(), createIdentity()]);
    const key = await createReceiverKey();
    const card = await issueReceiverCard(receiver, key, "Merkez lab tableti");

    const file = { name: "result_041.csv", data: bytes("numune,sonuc\nA-1,0.8\n") };
    const { wire, dispatch } = await sealOneWay(sender, card, file, context);

    const opened = await openOneWay(key, wire);
    expect(opened.name).toBe("result_041.csv");
    expect(new TextDecoder().decode(opened.data)).toContain("A-1,0.8");
    // Kanıt, çift yönlü akıştakiyle aynı: içerik özetine bağlı ve gönderenin imzası.
    expect((await verifyDispatch(opened.dispatch, opened.data)).ok).toBe(true);
    // Alıcının açtığı kayıt, gönderenin ürettiğinin AYNISI olmalı: imzalı bağlam
    // ve gönderen kimliği yolda değişmemeli.
    expect(opened.dispatch.sender).toBe(dispatch.sender);
    expect(opened.dispatch.sig).toBe(dispatch.sig);
    expect(opened.dispatch.context).toEqual(context);
  });

  it("başka bir alıcı açamaz ve değiştirilmiş zarf reddedilir", async () => {
    const [sender, receiver] = await Promise.all([createIdentity(), createIdentity()]);
    const key = await createReceiverKey();
    const card = await issueReceiverCard(receiver, key, "Merkez lab tableti");
    const { wire } = await sealOneWay(sender, card, { name: "a.txt", data: bytes("gizli") }, context);

    // Kart doğru olsa da anahtarı olmayan cihaz açamaz: şifre alıcıya bağlı.
    const other = await createReceiverKey();
    await expect(openOneWay(other, wire)).rejects.toThrow();

    // Tek bayt oynanmış zarf: GCM etiketi tutmaz.
    const tampered = wire.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(openOneWay(key, tampered as typeof wire)).rejects.toThrow();

    // Tek yönlü zarf olmayan baytlar erken ve net reddedilir.
    await expect(openOneWay(key, bytes("düz metin") as typeof wire)).rejects.toThrow(/one-way transfer/);
  });

  it("kartı değiştiren onu geçersiz kılar", async () => {
    const receiver = await createIdentity();
    const key = await createReceiverKey();
    const card = await issueReceiverCard(receiver, key, "Merkez lab tableti");
    expect(await verifyReceiverCard(card)).toBeTruthy();

    // Etiketi değiştirmek imzayı düşürür: kart yolda düzenlenemez.
    expect(await verifyReceiverCard({ ...card, label: "Başka cihaz" })).toBeNull();
    // Anahtarı değiştirmek de: saldırgan kendi anahtarını kartın içine koyamaz.
    const rogue = await createReceiverKey();
    expect(await verifyReceiverCard({ ...card, x: Buffer.from(rogue.pub).toString("base64url") })).toBeNull();
    expect(await verifyReceiverCard({ ...card, extra: 1 })).toBeNull();
    expect(await verifyReceiverCard(null)).toBeNull();

    const sender = await createIdentity();
    await expect(sealOneWay(sender, { ...card, label: "Başka cihaz" },
      { name: "a.txt", data: bytes("x") }, context)).rejects.toThrow(/receiver card/);
  });
});

describe("yazılan kodla gönderim (kart yok, gönderende kamera yok)", () => {
  it("doğru kod açar; yanlış kod ve değiştirilmiş zarf reddedilir", async () => {
    const sender = await createIdentity();
    const code = createTransferCode();
    const file = { name: "result_041.csv", data: bytes("numune,sonuc\nA-1,0.8\n") };
    const { wire, dispatch } = await sealWithCode(sender, formatTransferCode(code).toLowerCase(), file, context);
    expect(isCodeWire(wire)).toBe(true);

    const opened = await openWithCode(code, wire);
    expect(new TextDecoder().decode(opened.data)).toContain("A-1,0.8");
    expect(opened.dispatch.sig).toBe(dispatch.sig);
    expect((await verifyDispatch(opened.dispatch, opened.data)).ok).toBe(true);

    const wrong = code.slice(0, -1) + (code.endsWith("0") ? "1" : "0");
    await expect(openWithCode(wrong, wire)).rejects.toThrow(/code does not open this transfer/);
    const tampered = wire.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(openWithCode(code, tampered as typeof wire)).rejects.toThrow();
  }, 20_000);

  it("kod 60 bit rastgele ve yazım hatalarını hoş görür", () => {
    const code = createTransferCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(new Set(Array.from({ length: 50 }, createTransferCode)).size).toBe(50);
    expect(normalizeTransferCode(" 7k3q-m9xd-4pla ")).toBe("7K3QM9XD4P1A");
    expect(normalizeTransferCode("O0O0-IIII-LLLL")).toBe("000011111111");
    expect(normalizeTransferCode("7K3Q-M9XD")).toBeNull();
    expect(normalizeTransferCode("7K3Q-M9XD-4PLU")).toBeNull(); // U alfabede yok
  });
});

describe("büyük dosya", () => {
  // b64 tüm baytları tek çağrıya yayıyordu; yüz KB'ı aşan dosyada iki yol da
  // "Maximum call stack size exceeded" ile düşüyordu.
  it("2 MB dosya kodla ve kartla mühürlenip açılır", async () => {
    const data = new Uint8Array(2 * 1024 * 1024) as Bytes;
    for (let i = 0; i < data.length; i += 65536) globalThis.crypto.getRandomValues(data.subarray(i, i + 65536));
    const file = { name: "raw.bin", data };
    const [sender, receiver] = await Promise.all([createIdentity(), createIdentity()]);

    const code = createTransferCode();
    const viaCode = await openWithCode(code, (await sealWithCode(sender, code, file, context)).wire);
    expect(viaCode.data).toEqual(data);

    const key = await createReceiverKey();
    const card = await issueReceiverCard(receiver, key, "Merkez lab tableti");
    const viaCard = await openOneWay(key, (await sealOneWay(sender, card, file, context)).wire);
    expect(viaCard.data).toEqual(data);
  }, 30_000);
});
