import { describe, expect, it } from "vitest";
import { receiveSteps, sendSteps, type ReceiveSnapshot, type SendSnapshot } from "./steps.ts";

const send: SendSnapshot = { route: "screen", file: false, code: false, handshake: false, sending: false, printed: false, sent: false };
const recv: ReceiveSnapshot = { pair: "code", read: "live", handshake: false, confirmed: false, listening: false, progress: 0, delivered: false };
const states = (steps: { state: string }[]) => steps.map((s) => s.state).join(",");

describe("gönderen adımları", () => {
  it("sıradaki adım öne çıkar, biten işaretlenir", () => {
    expect(states(sendSteps(send))).toBe("now,todo,todo,todo");
    expect(states(sendSteps({ ...send, file: true, code: true }))).toBe("done,done,now,todo");
    expect(states(sendSteps({ ...send, file: true, code: true, sending: true }))).toBe("done,done,done,now");
  });

  it("ölçülemeyen adım akışı kilitlemez: sonraki biterse önceki de biter", () => {
    const serial = sendSteps({ ...send, route: "serial", file: true, code: true });
    expect(states(serial)).toBe("done,done,done,done,now,todo");
    expect(serial[4].target).toBe("serial-send");
  });

  it("kâğıt: basılınca sıra kodu yazmaya gelir", () => {
    const paper = sendSteps({ ...send, route: "paper", file: true, printed: true });
    expect(states(paper)).toBe("done,done,now,todo");
    expect(paper[2].target).toBe("paper-code");
  });
});

describe("alıcı adımları", () => {
  it("kod: kod adımda yazılı, okuma ilerleyince yüzde görünür", () => {
    const steps = receiveSteps({ ...recv, code: "7K3Q-M9XD-4PAB", progress: 0.4 });
    expect(steps[0].title).toBe("Type 7K3Q-M9XD-4PAB on the sending PC");
    expect(states(steps)).toBe("done,now,todo");
    expect(steps[1].detail).toMatch(/40% collected/);
  });

  it("basılı sayfalar: kod girilince kamera adımı; teslimde kaydet adımı", () => {
    expect(states(receiveSteps({ ...recv, pair: "paper" }))).toBe("now,todo,todo");
    // Kod sona kalabilir: tarama ilerlerken kod adımı akışı kilitlemez.
    expect(states(receiveSteps({ ...recv, pair: "paper", progress: 0.3 }))).toBe("done,now,todo");
    const reading = receiveSteps({ ...recv, pair: "paper", code: "X" });
    expect(reading[1]).toMatchObject({ state: "now", title: "Point this camera at the pages", target: "recv-video" });
    expect(states(receiveSteps({ ...recv, pair: "paper", code: "X", delivered: true }))).toBe("done,done,now");
  });

  it("seri: önce dinle, sonra gönderende kod; dinlerken sıra göndermede", () => {
    expect(receiveSteps({ ...recv, read: "serial" })[0]).toMatchObject({ title: "Listen on the serial port", state: "now" });
    const listening = receiveSteps({ ...recv, read: "serial", listening: true, code: "AB" });
    expect(states(listening)).toBe("done,now,todo,todo");
    expect(listening[1].title).toBe("Type AB on the sending PC and send over the cable");
  });
});
