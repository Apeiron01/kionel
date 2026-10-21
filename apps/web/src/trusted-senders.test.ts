import { describe, expect, it } from "vitest";
import { b64, createIdentity } from "@kionel/crypto";
import { issueDispatch, issueReceipt } from "@kionel/issue";
import { entryFor } from "./transfer-log.ts";
import { TRUSTED_SENDER_LIMIT, alreadyReceived, isAccepted, pinSender, senderShort } from "./trusted-senders.ts";

const content = new TextEncoder().encode("numune,sonuc\nT-1,0.8\n");

describe("alıcının kabul ettiği gönderenler", () => {
  it("liste boşken herkesi, sabitlendikten sonra yalnız listedekileri kabul eder", async () => {
    const first = b64((await createIdentity()).pub);
    const second = b64((await createIdentity()).pub);
    expect(isAccepted([], first)).toBe(true);
    const list = pinSender([], first, "2026-10-02T10:00:00.000Z", "a.csv");
    expect(list).toEqual([{ key: first, at: "2026-10-02T10:00:00.000Z", file: "a.csv" }]);
    expect(isAccepted(list, first)).toBe(true);
    expect(isAccepted(list, second)).toBe(false);
  });

  it("aynı göndereni iki kez eklemez, sınırı aşmaz", async () => {
    const key = b64((await createIdentity()).pub);
    const once = pinSender([], key, "2026-10-02T10:00:00.000Z");
    expect(pinSender(once, key, "2026-10-03T10:00:00.000Z")).toEqual(once);
    const full = Array.from({ length: TRUSTED_SENDER_LIMIT }, (_, i) => ({ key: `k${i}`, at: "2026-10-02T10:00:00.000Z" }));
    expect(() => pinSender(full, key, "2026-10-02T10:00:00.000Z")).toThrow(/already pins 50 senders/);
  });

  it("kısa gösterim anahtarın ilk sekiz baytıdır, dörderli gruplarla", async () => {
    const identity = await createIdentity();
    const short = senderShort(b64(identity.pub));
    expect(short).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    expect(short.replace(/ /g, "")).toBe(Array.from(identity.pub.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join(""));
  });
});

describe("tekrar gönderilen dosya", () => {
  it("aynı sevk kaydını tanır; yeniden gönderilen aynı dosyayı yeni sevk sayar", async () => {
    const sender = await createIdentity();
    const receiver = await createIdentity();
    const dispatch = await issueDispatch(sender, { session: 77, content, context: { profile: "lab", reference: "WO-1" } });
    const receipt = await issueReceipt(receiver, { session: 77, content, sender: sender.pub, dispatch });
    const log = [entryFor("sent", "x.csv", dispatch), entryFor("received", "a.csv", receipt)];

    expect(alreadyReceived(log, dispatch)?.file).toBe("a.csv");
    // Gönderenin kendi "sent" satırı alınmış sayılmaz.
    expect(alreadyReceived([entryFor("sent", "x.csv", dispatch)], dispatch)).toBeUndefined();
    // Aynı içerik yeniden seçilip gönderilirse yeni oturum ve yeni imza: yeni sevk.
    const again = await issueDispatch(sender, { session: 78, content, context: { profile: "lab", reference: "WO-1" } });
    expect(alreadyReceived(log, again)).toBeUndefined();
  });
});
