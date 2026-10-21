import { describe, expect, it } from "vitest";
import { createIdentity, unb64, b64, verifyReceipt } from "@kionel/crypto";
import { issueDispatch, issueReceipt } from "@kionel/issue";
import { SOUND_MAX_BYTES, SOUND_RECEIPT_BYTES, SoundReceiver, packSoundReceipt, rsCorrect, rsParity, soundSamples, unpackSoundReceipt } from "./sound-link.ts";

/** Tekrarlanabilir gürültü: testler rastgele düşmesin. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const gaussian = (random: () => number): number =>
  Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random());

const offer = (seed = 1): Uint8Array => {
  const random = rng(seed);
  return Uint8Array.from({ length: 170 }, () => Math.floor(random() * 256));
};

/** Mikrofonun verdiği gibi parça parça besler; ilk çözülen çerçeveyi döndürür. */
function listen(signal: Float32Array, sampleRate: number, chunk = 4096): Uint8Array | undefined {
  const receiver = new SoundReceiver(sampleRate);
  for (let at = 0; at < signal.length; at += chunk) {
    const heard = receiver.push(signal.subarray(at, at + chunk));
    if (heard) return heard;
  }
  return undefined;
}

/** Sinyali rastgele bir sessizlikten sonra başlatır; gürültü, zayıflama ve yankı ekler. */
function channel(clean: Float32Array, sampleRate: number, opts: { noise?: number; gain?: number; echoes?: [number, number][]; seed?: number } = {}): Float32Array {
  const random = rng(opts.seed ?? 7);
  const lead = Math.floor((0.2 + random() * 0.3) * sampleRate);
  const out = new Float32Array(lead + clean.length + sampleRate);
  for (let i = 0; i < clean.length; i++) out[lead + i] = clean[i] * (opts.gain ?? 1);
  for (const [seconds, level] of opts.echoes ?? []) {
    const delay = Math.round(seconds * sampleRate);
    for (let i = 0; i < clean.length; i++) out[lead + delay + i] += clean[i] * (opts.gain ?? 1) * level;
  }
  if (opts.noise) for (let i = 0; i < out.length; i++) out[i] += opts.noise * gaussian(random);
  return out;
}

describe("Reed–Solomon", () => {
  it("16 bozuk baytı düzeltir, 17'de yanlış sonuç vermez", () => {
    const random = rng(3);
    const message = Uint8Array.from({ length: 171 }, () => Math.floor(random() * 256));
    const clean = new Uint8Array([...message, ...rsParity(message)]);
    for (const errors of [1, 8, 16]) {
      const code = clean.slice();
      const hit = new Set<number>();
      while (hit.size < errors) hit.add(Math.floor(random() * code.length));
      for (const index of hit) code[index] ^= 1 + Math.floor(random() * 255);
      expect(rsCorrect(code), `${errors} hata`).toBe(true);
      expect(code).toEqual(clean);
    }
    const broken = clean.slice();
    for (let i = 0; i < 17; i++) broken[i * 5] ^= 0x5a;
    // Kapasiteyi aşan bozulmada ya başarısız olur ya da başka bir geçerli kod sözcüğüne gider;
    // sessizce "düzeldi" deyip özgün olmayan veriyi özgün gibi vermesi tek kabul edilemez durum.
    if (rsCorrect(broken)) expect(broken).not.toEqual(clean);
  });
});

describe("sesle eşleşme modemi", () => {
  it("temiz kanalda 170 baytlık teklifi aynen taşır, 6 saniyeden kısa sürer", () => {
    const payload = offer();
    const samples = soundSamples(payload, 48000);
    expect(samples.length / 48000).toBeLessThan(6);
    expect(samples.reduce((peak, v) => Math.max(peak, Math.abs(v)), 0)).toBeLessThanOrEqual(1);
    expect(listen(channel(samples, 48000), 48000)).toEqual(payload);
  });

  it("sinyalle aynı güçte gürültüde çözer", () => {
    const payload = offer(2);
    // Her ton 0,2 genlikte; 0,3'lük gürültü sinyalin toplam gücünden yüksek.
    expect(listen(channel(soundSamples(payload, 48000), 48000, { noise: 0.3 }), 48000)).toEqual(payload);
  });

  it("oda yankısıyla çözer", () => {
    const payload = offer(3);
    const heard = listen(channel(soundSamples(payload, 48000), 48000, { echoes: [[0.023, 0.5], [0.061, 0.3]], noise: 0.05 }), 48000);
    expect(heard).toEqual(payload);
  });

  it("çok zayıf sinyali çözer (kısık hoparlör)", () => {
    const payload = offer(4);
    expect(listen(channel(soundSamples(payload, 48000), 48000, { gain: 0.01, noise: 0.002 }), 48000)).toEqual(payload);
  });

  it("48 kHz çalınıp 44,1 kHz dinlenince çözer", () => {
    const payload = offer(5);
    const played = channel(soundSamples(payload, 48000), 48000, { noise: 0.05 });
    const heard = new Float32Array(Math.floor((played.length * 44100) / 48000));
    for (let i = 0; i < heard.length; i++) {
      const at = (i * 48000) / 44100;
      const base = Math.floor(at);
      heard[i] = played[base] + (at - base) * ((played[base + 1] ?? 0) - played[base]);
    }
    expect(listen(heard, 44100, 2048)).toEqual(payload);
  });

  it("döngüde çalınan çerçevenin ortasından başlayınca sonraki turu yakalar", () => {
    const payload = offer(6);
    const once = soundSamples(payload, 48000);
    const loop = new Float32Array(once.length * 2);
    loop.set(once, 0);
    loop.set(once, once.length);
    expect(listen(loop.subarray(Math.floor(once.length * 0.4)), 48000)).toEqual(payload);
  });

  it("gürültüden ve konuşma benzeri tonlardan çerçeve uydurmaz", () => {
    const random = rng(9);
    const noise = Float32Array.from({ length: 48000 * 8 }, (_, i) =>
      0.3 * gaussian(random) + 0.3 * Math.sin(2 * Math.PI * 2200 * (i / 48000)) + 0.2 * Math.sin(2 * Math.PI * 3100 * (i / 48000)));
    expect(listen(noise, 48000)).toBeUndefined();
  });

  it("en küçük ve en büyük çerçeveyi taşır, sınırı aşanı reddeder", () => {
    for (const size of [1, SOUND_MAX_BYTES]) {
      const random = rng(size);
      const payload = Uint8Array.from({ length: size }, () => Math.floor(random() * 256));
      expect(listen(channel(soundSamples(payload, 48000), 48000), 48000), `${size} bayt`).toEqual(payload);
    }
    expect(() => soundSamples(new Uint8Array(SOUND_MAX_BYTES + 1), 48000)).toThrow();
    expect(() => soundSamples(new Uint8Array(0), 48000)).toThrow();
  });
});

describe("sesle teslim makbuzu", () => {
  it("gönderen, sesle gelen imza ve saatten makbuzu yeniden kurar ve doğrular", async () => {
    const sender = await createIdentity();
    const receiver = await createIdentity();
    const content = new TextEncoder().encode("numune,sonuc\nS-1,0.8\n");
    const dispatch = await issueDispatch(sender, { session: 0xabcdef12, content, context: { profile: "lab", reference: "WO-7" } });
    const receipt = await issueReceipt(receiver, { session: dispatch.session, content, sender: sender.pub, dispatch });

    const packed = packSoundReceipt({ session: receipt.session, at: receipt.at, signature: unb64(receipt.sig) });
    expect(packed.length).toBe(SOUND_RECEIPT_BYTES);
    // Ses kanalından geçer: makbuz çerçevesi 4 saniyeden kısa.
    const samples = soundSamples(packed, 48000);
    expect(samples.length / 48000).toBeLessThan(4);
    const heard = listen(channel(samples, 48000, { noise: 0.1 }), 48000)!;
    const compact = unpackSoundReceipt(heard)!;

    // Gönderenin bildikleri: kendi sevk kaydı, kendi anahtarı ve el sıkışmadan alıcının anahtarı.
    const rebuilt = {
      v: 1 as const, session: compact.session, hash: dispatch.hash, bytes: dispatch.bytes, at: compact.at,
      sender: dispatch.sender, receiver: b64(receiver.pub), dispatch, sig: b64(compact.signature),
    };
    expect(rebuilt).toEqual(receipt);
    expect((await verifyReceipt(rebuilt, content)).ok).toBe(true);

    // Alıcı başka bir dosya aldıysa imza gönderenin dosyasına uymaz.
    const other = await issueReceipt(receiver, { session: dispatch.session, content: new TextEncoder().encode("başka"), sender: sender.pub, dispatch });
    const forged = { ...rebuilt, sig: other.sig, at: other.at };
    expect((await verifyReceipt(forged, content)).ok).toBe(false);
  });

  it("makbuz olmayan çerçeveyi ve bozuk saati reddeder", () => {
    expect(unpackSoundReceipt(new Uint8Array(170))).toBeUndefined();
    expect(unpackSoundReceipt(new Uint8Array(SOUND_RECEIPT_BYTES))).toBeUndefined();
    expect(() => packSoundReceipt({ session: 1, at: "2026-10-01 12:00", signature: new Uint8Array(64) })).toThrow();
    expect(() => packSoundReceipt({ session: 1, at: new Date().toISOString(), signature: new Uint8Array(10) })).toThrow();
  });
});
