import { expect, test } from "vitest";
import {
  AdaptiveFlowController,
  ControlKind,
  SessionState,
  SessionStateMachine,
  decodeAck,
  decodeCapabilities,
  decodeHandshakeControl,
  encodeAck,
  encodeCapabilities,
  encodeHandshakeControl,
  negotiateCapabilities,
} from "./session.ts";
import { LtDecoder, systematicEncode } from "./fountain.ts";
import { PROFILES, simulate, simulateDuplex } from "./channel.ts";

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 29 + 7) & 0xff);

test("sistematik bloklar kesin eksik listesinden seçici tekrar edilir", () => {
  const data = bytes(1000);
  const decoder = new LtDecoder(data.length, 100);
  for (const block of systematicEncode(data, 100)) {
    const index = block.seed & 0x7fffffff;
    if (![2, 3, 7].includes(index)) decoder.ingest(block.seed, block.payload);
  }
  expect(decoder.missingRanges()).toEqual([{ start: 2, end: 4 }, { start: 7, end: 8 }]);
  for (const block of systematicEncode(data, 100, decoder.missingRanges())) decoder.ingest(block.seed, block.payload);
  expect([...decoder.result()!]).toEqual([...data]);
});

test("decoder checkpoint kesintiden sonra yalnız eksik bloklarla devam eder", () => {
  const data = bytes(1025);
  const decoder = new LtDecoder(data.length, 128);
  for (const block of systematicEncode(data, 128, [{ start: 0, end: 4 }])) decoder.ingest(block.seed, block.payload);
  const resumed = LtDecoder.fromCheckpoint(decoder.checkpoint());
  expect(resumed.progress).toBe(decoder.progress);
  for (const block of systematicEncode(data, 128, resumed.missingRanges())) resumed.ingest(block.seed, block.payload);
  expect([...resumed.result()!]).toEqual([...data]);
});

test("yetenek müzakeresi ortak en güvenli profili seçer ve gerekirse simplex'e düşer", () => {
  const local = { v: 1 as const, transports: ["color-grid-v1", "qr-v1"], maxFrameBytes: 2000, maxFps: 60, duplex: true, arq: true, resume: true };
  const remote = { v: 1 as const, transports: ["qr-v1"], maxFrameBytes: 1400, maxFps: 24, duplex: true, arq: true, resume: false };
  expect(negotiateCapabilities(local, remote)).toEqual({
    transport: "qr-v1", frameBytes: 1400, fps: 24, duplex: true, arq: true, resume: false, fallback: false,
  });
  expect(negotiateCapabilities(local)).toMatchObject({ duplex: false, arq: false, fallback: true });
  expect(decodeCapabilities(encodeCapabilities(local))).toEqual(local);
  const control = { kind: ControlKind.Offer, record: bytes(170), capabilities: local };
  expect(decodeHandshakeControl(encodeHandshakeControl(control))).toEqual(control);
});

test("ACK ikili biçimi eksik aralıkları kayıpsız taşır ve bozuk biçimi reddeder", () => {
  const ack = { sequence: 7, receivedBlocks: 92, totalBlocks: 100, decodeMicros: 12_500, missing: [{ start: 2, end: 5 }, { start: 95, end: 100 }], complete: false };
  const wire = encodeAck(ack);
  expect(decodeAck(wire)).toEqual(ack);
  wire[0] = 99;
  expect(decodeAck(wire)).toBeNull();
});

test("akış kontrolü kayıpta yavaşlar, sağlıklı örneklerde kontrollü hızlanır", () => {
  const flow = new AdaptiveFlowController(30, 5, 60);
  expect(flow.observe({ sent: 100, received: 60, decodeMs: 10 })).toBe(24);
  flow.observe({ sent: 100, received: 100, decodeMs: 5 });
  flow.observe({ sent: 100, received: 100, decodeMs: 5 });
  expect(flow.observe({ sent: 100, received: 100, decodeMs: 5 })).toBe(27);
});

test("oturum durum makinesi yalnız güvenli geçişlere izin verir", () => {
  const machine = new SessionStateMachine();
  machine.transition(SessionState.Negotiation);
  machine.transition(SessionState.Transfer);
  machine.transition(SessionState.Interrupted);
  machine.transition(SessionState.Transfer);
  machine.transition(SessionState.Verification);
  machine.transition(SessionState.Complete);
  expect(machine.state).toBe(SessionState.Complete);
  expect(() => machine.transition(SessionState.Transfer)).toThrow(/geçersiz/);
});

test("duplex ARQ yüksek kayıpta tamamlanır ve checkpoint'ten devam eder", () => {
  const data = bytes(200_000);
  const result = simulateDuplex(data, PROFILES["qr-v27-L-30"], {
    lossRate: 0.3, corruptRate: 0.02, ackLossRate: 0.2, seed: 42,
    interruptAfterFrames: 80, resumeDelaySeconds: 1,
  });
  expect(result.ok).toBe(true);
  expect(result.resumed).toBe(true);
  expect(result.rounds).toBeLessThan(20);
});

test("duplex seçici tekrar %20 kayıpta fountain fallback'ten hızlıdır", () => {
  const data = bytes(500_000);
  const profile = PROFILES["qr-v27-L-30"];
  const simplex = simulate(data, profile, { lossRate: 0.2, corruptRate: 0.01, seed: 9 });
  const duplex = simulateDuplex(data, profile, { lossRate: 0.2, corruptRate: 0.01, ackLossRate: 0.1, seed: 9 });
  expect(duplex.ok).toBe(true);
  expect(duplex.seconds).toBeLessThan(simplex.seconds);
});
