export interface AndroidRevocationSnapshot {
  /** Lowercase, non-padded serials whose status is REVOKED or SUSPENDED. */
  blockedSerials: ReadonlySet<string>;
  /** ISO timestamp at which the control plane fetched the official list. */
  fetchedAt: string;
  /** ISO timestamp derived from the HTTP Cache-Control freshness lifetime. */
  nextUpdate: string;
}

export interface AndroidStatusListEntry {
  status: "REVOKED" | "SUSPENDED";
  expires?: string;
  reason?: "UNSPECIFIED" | "KEY_COMPROMISE" | "CA_COMPROMISE" | "SUPERSEDED" | "SOFTWARE_FLAW";
  comment?: string;
}

/** Google's status list uses lowercase hex without leading zeros. */
export function normalizeSerial(serialNumber: string): string {
  return serialNumber.toLowerCase().replace(/^0+/, "") || "0";
}

/** Strictly parses Google's JSON status-list body; HTTP freshness stays explicit. */
export function parseAndroidStatusList(
  json: string,
  fetchedAt: string,
  nextUpdate: string,
): AndroidRevocationSnapshot {
  const value: unknown = JSON.parse(json);
  if (!plainObject(value) || Object.keys(value).some((key) => key !== "entries") || !plainObject(value.entries)) {
    throw new Error("Android attestation status listesi tanınmıyor");
  }
  const blockedSerials = new Set<string>();
  for (const [serial, raw] of Object.entries(value.entries)) {
    if (!/^[a-f1-9][a-f0-9]*$/.test(serial) || !validStatusEntry(raw)) {
      throw new Error("Android attestation status listesi geçersiz bir kayıt içeriyor");
    }
    blockedSerials.add(serial);
  }
  const snapshot = { blockedSerials, fetchedAt, nextUpdate };
  validateRevocationSnapshot(snapshot);
  return snapshot;
}

export function validateRevocationSnapshot(snapshot: AndroidRevocationSnapshot | undefined): void {
  if (!snapshot || !snapshot.blockedSerials || typeof snapshot.blockedSerials[Symbol.iterator] !== "function") {
    throw new Error("Android attestation CRL snapshot'ı gerekli");
  }
  const fetched = Date.parse(snapshot.fetchedAt);
  const next = Date.parse(snapshot.nextUpdate);
  if (!validIsoTimestamp(snapshot.fetchedAt) || !validIsoTimestamp(snapshot.nextUpdate) || next <= fetched) {
    throw new Error("Android attestation CRL snapshot zamanları geçersiz");
  }
  for (const serial of snapshot.blockedSerials) {
    if (!/^[a-f1-9][a-f0-9]*$/.test(serial)) throw new Error("Android attestation CRL seri numarası geçersiz");
  }
}

export function revocationStatusReason(snapshot: AndroidRevocationSnapshot, now: Date): string | undefined {
  const time = now.getTime();
  if (time < Date.parse(snapshot.fetchedAt) - 5 * 60_000) return "revocation-status-not-yet-valid";
  if (time >= Date.parse(snapshot.nextUpdate)) return "revocation-status-stale";
  return undefined;
}

function validStatusEntry(value: unknown): value is AndroidStatusListEntry {
  if (!plainObject(value)) return false;
  const allowed = new Set(["status", "expires", "reason", "comment"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (value.status !== "REVOKED" && value.status !== "SUSPENDED") return false;
  if (value.expires !== undefined && (typeof value.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.expires))) return false;
  const reasons = ["UNSPECIFIED", "KEY_COMPROMISE", "CA_COMPROMISE", "SUPERSEDED", "SOFTWARE_FLAW"];
  if (value.reason !== undefined && (typeof value.reason !== "string" || !reasons.includes(value.reason))) return false;
  return value.comment === undefined || (typeof value.comment === "string" && value.comment.length <= 140);
}

function validIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
