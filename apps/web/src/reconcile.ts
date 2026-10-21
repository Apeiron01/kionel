/**
 * Tek yönlü bağlantı mutabakatı.
 *
 * Tek yönlü bir bağlantıda (seri kablo, veri diyotu) gönderen, dosyanın ulaşıp
 * ulaşmadığını bilemez: geri dönen bir yol yoktur. Kayıtlar ise iki tarafta da
 * imzalıdır. Gönderenin kayıtları ile alıcının kayıtları yan yana konunca her
 * sevk için üç sonuçtan biri çıkar: imzalı makbuzu var, makbuzu yok, ya da
 * kayıtlardan biri doğrulanmıyor. Saf fonksiyon: DOM ve depolama yok.
 */
import { verifyDispatch, verifyReceipt, type Dispatch, type Receipt } from "@kionel/crypto";

export type LinkState = "delivered" | "missing" | "invalid";
export interface LinkRow {
  file: string;
  /** Gönderenin imzaladığı an. */
  sentAt: string;
  state: LinkState;
  /** Alıcının imzaladığı an; yalnız teslim edilenlerde. */
  receivedAt?: string;
  reason?: string;
}
export interface LinkReport {
  rows: LinkRow[];
  delivered: number;
  missing: number;
  invalid: number;
  /** Alıcıda olup gönderenin kayıtlarında bulunmayan makbuzlar (çoğu zaman başka bir dönem). */
  unmatched: number;
}

interface Exported { kind: string; file: string; record: unknown }

function entries(value: unknown, kind: "sent" | "received", side: string): Exported[] {
  // Gönderen tarafta dosya optikle gitmiş ("sent") ya da başka yoldan taşınmak üzere mühürlenmiş ("sealed") olabilir.
  const kinds = kind === "sent" ? ["sent", "sealed"] : [kind];
  if (!Array.isArray(value)) throw new Error(`The ${side}'s file is not a Kionel records file. Use "Download signed records (JSON)" in the transfer log.`);
  const list = value.filter((entry): entry is Exported =>
    typeof entry === "object" && entry !== null && kinds.includes((entry as Exported).kind) && typeof (entry as Exported).record === "object" && (entry as Exported).record !== null);
  if (!list.length) throw new Error(`The ${side}'s file has no ${kinds.join(" or ")} records. Is it the ${side}'s export, and does it cover the period?`);
  return list;
}

/** Sevk kaydının kimliği: imzası. Aynı dosya iki kez gönderilse de iki ayrı sevktir. */
const key = (dispatch: { sig?: unknown } | undefined): string => (typeof dispatch?.sig === "string" ? dispatch.sig : "");

// ponytail: web uygulamasının ürettiği v1 kayıtları; v2 kayıtları "doğrulanamadı" çıkar, gerekince eklenir.
export async function reconcileLink(sent: unknown, received: unknown): Promise<LinkReport> {
  const dispatches = entries(sent, "sent", "sender");
  const receipts = new Map<string, Receipt>();
  for (const entry of entries(received, "received", "receiver")) {
    const receipt = entry.record as Receipt;
    const id = key(receipt.dispatch);
    if (id) receipts.set(id, receipt);
  }
  const used = new Set<string>();
  const rows: LinkRow[] = [];
  for (const entry of dispatches) {
    const dispatch = entry.record as Dispatch;
    const row: LinkRow = { file: String(entry.file ?? ""), sentAt: String(dispatch.at ?? ""), state: "missing" };
    const receipt = receipts.get(key(dispatch));
    if (!(await verifyDispatch(dispatch)).ok) {
      row.state = "invalid";
      row.reason = "the sender's record does not verify";
    } else if (receipt) {
      used.add(key(dispatch));
      if ((await verifyReceipt(receipt)).ok) {
        row.state = "delivered";
        row.receivedAt = receipt.at;
      } else {
        row.state = "invalid";
        row.reason = "the receiver's receipt does not verify";
      }
    }
    rows.push(row);
  }
  // Önce eksikler ve doğrulanmayanlar: okuyanın bakması gereken satırlar bunlar.
  const order: Record<LinkState, number> = { missing: 0, invalid: 1, delivered: 2 };
  rows.sort((a, b) => order[a.state] - order[b.state]);
  const count = (state: LinkState) => rows.filter((row) => row.state === state).length;
  return { rows, delivered: count("delivered"), missing: count("missing"), invalid: count("invalid"), unmatched: receipts.size - used.size };
}
