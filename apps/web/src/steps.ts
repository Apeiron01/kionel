/**
 * Adım akışı: kullanıcıya seçtiği yolun adımlarını sırayla gösterir; biteni
 * işaretler, sıradakini öne çıkarır ve ilgili denetime götürür. Durum app.ts'den
 * bir anlık görüntü olarak gelir; burada DOM yok, birim testli.
 *
 * Bazı adımlar ölçülemez (kabloyu bağlamak, kodu yazıp saklamak). Sonraki bir
 * adım bittiyse öncekiler de bitmiş sayılır; ölçülemeyen adım böylece akışı kilitlemez.
 */
export type StepState = "done" | "now" | "todo";
export interface Step { title: string; detail?: string; state: StepState; target?: string }
type Raw = { title: string; detail?: string; done: boolean; target?: string };

function mark(raw: Raw[]): Step[] {
  const last = raw.map((s) => s.done).lastIndexOf(true);
  return raw.map(({ done: _, ...s }, i) => ({ ...s, state: i <= last ? "done" : i === last + 1 ? "now" : "todo" }));
}

export type SendRoute = "screen" | "paper" | "serial";
export interface SendSnapshot {
  route: SendRoute;
  file: boolean;
  /** Geçerli bir alıcı kodu yazılı. */
  code: boolean;
  /** Kameralı el sıkışma tamamlandı. */
  handshake: boolean;
  /** Kodlar ekranda ya da seri hatta akıyor. */
  sending: boolean;
  printed: boolean;
  /** Seri hatta bir tur bitti. */
  sent: boolean;
}

export function sendSteps(s: SendSnapshot): Step[] {
  const file: Raw = { title: "Choose the file", detail: "Several files travel together as one ZIP.", done: s.file, target: "file" };
  if (s.route === "paper") {
    return mark([
      file,
      { title: "Print the pages", detail: "Press Print the file as codes, then print, or save as PDF and print later.", done: s.printed, target: "paper-print" },
      { title: "Write down the code", detail: "It is shown in large letters under the button. Keep it apart from the pages: without it they cannot be read.", done: false, target: "paper-code" },
      { title: "Read the pages on the receiving device", detail: "There: Receive → Printed pages, enter the code, and point the camera at each page, in any order.", done: false },
    ]);
  }
  if (s.route === "serial") {
    return mark([
      file,
      { title: "Connect the cable", detail: "This PC's transmit pin (3) to the receiver's receive pin (2), and ground (5) to ground. Leave the other direction unconnected.", done: false },
      { title: "Start listening on the receiver", detail: "There: Receive → Sender has no camera — show a code → Serial cable → Choose the serial port and listen.", done: false },
      { title: "Type the receiver's code here", done: s.code, target: "typed-code" },
      { title: "Choose the port and send", detail: "Use the same speed on both sides.", done: s.sending || s.sent, target: "serial-send" },
      { title: "Check the receiver", detail: "It shows the file when it is complete. If it does not, press Send more.", done: false },
    ]);
  }
  return mark([
    file,
    { title: "Connect to the receiver", detail: "With a camera here: point it at the QR on the receiver. Without one: on the receiver choose Receive → Sender has no camera — show a code, and type that code below.", done: s.handshake || s.code, target: "typed-code" },
    { title: "Start sending", detail: "Press Send with this code, or confirm the matching codes if you scanned.", done: s.sending, target: "code-send" },
    { title: "Keep this screen visible", detail: "Point the receiver's camera at this screen until it shows the file.", done: false },
  ]);
}

export type Pair = "camera" | "code" | "card" | "paper";
export type Read = "live" | "record" | "file" | "serial";
export interface ReceiveSnapshot {
  pair: Pair;
  read: Read;
  code?: string;
  handshake: boolean;
  confirmed: boolean;
  listening: boolean;
  /** 0–1: toplanan pay. */
  progress: number;
  delivered: boolean;
}

const pct = (p: number) => `${Math.round(p * 100)}% collected so far.`;

function readStep(s: ReceiveSnapshot): Raw {
  const busy = s.progress > 0 || s.delivered;
  const tail = s.progress > 0 && !s.delivered ? ` ${pct(s.progress)}` : "";
  switch (s.read) {
    case "record": return { title: "Record the sender's screen", detail: `Press Record the screen now and film for as long as the sender's screen says.${tail}`, done: busy, target: "read-record-panel" };
    case "file": return { title: "Open the recording", detail: `Open the video of the sender's screen, or photos or scans of printed pages.${tail}`, done: busy, target: "read-file-panel" };
    case "serial": return { title: "Listen on the serial port", detail: `Press Choose the serial port and listen, at the sender's speed.${tail}`, done: s.listening || busy, target: "serial-listen" };
    default: return { title: s.pair === "paper" ? "Point this camera at the pages" : "Point this camera at the sender's screen", detail: (s.pair === "paper" ? "One page at a time, in any order, close enough for the codes to fill most of the picture." : "Keep the whole code in the picture until the file arrives.") + tail, done: busy, target: "recv-video" };
  }
}

export function receiveSteps(s: ReceiveSnapshot): Step[] {
  const save: Raw = { title: "Save the file and its receipt", detail: "Download both below, or choose a folder once and they are saved there.", done: false, target: "result" };
  const arrive: Raw = { ...readStep(s), done: s.delivered };
  if (s.pair === "paper") {
    return mark([
      { title: "Enter the code that came with the pages", detail: "Or scan first: when every code needed has been read, Kionel asks for the code.", done: Boolean(s.code) || s.progress > 0, target: "code-enter" },
      arrive,
      save,
    ]);
  }
  if (s.pair === "camera") {
    return mark([
      { title: "Show this QR to the sender's camera", done: s.handshake, target: "offer-qr" },
      { title: "Compare the codes on both screens and confirm", done: s.confirmed, target: "recv-confirm" },
      arrive,
      save,
    ]);
  }
  if (s.pair === "card") {
    return mark([
      { title: "Create this device's receiver card and load it on the sender once", done: s.progress > 0 || s.delivered || s.listening, target: "card-create" },
      arrive,
      save,
    ]);
  }
  const typeCode = `Type ${s.code ? s.code : "the code shown here"} on the sending PC`;
  if (s.read === "serial") {
    // Seri hatta geri kanal yok: alıcı gönderimden önce dinliyor olmalı.
    return mark([
      { title: "Listen on the serial port", detail: "Press Choose the serial port and listen, at the speed the sender will use.", done: s.listening || s.progress > 0 || s.delivered, target: "serial-listen" },
      { title: `${typeCode} and send over the cable`, detail: "Under Send over a serial cable, with the same speed.", done: s.progress > 0 || s.delivered, target: "code-display" },
      { title: "Wait for the file", detail: s.progress > 0 && !s.delivered ? pct(s.progress) : "It arrives without a camera; nothing goes back to the sender.", done: s.delivered },
      save,
    ]);
  }
  return mark([
    { title: typeCode, detail: "Under \"This PC has no camera?\", then press Send with this code.", done: s.progress > 0 || s.delivered, target: "code-display" },
    arrive,
    save,
  ]);
}
