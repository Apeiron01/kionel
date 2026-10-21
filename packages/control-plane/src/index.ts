/**
 * Kionel management-plane product contract.
 *
 * This package deliberately contains no optical-transfer payload endpoint. The
 * control plane manages tenant-scoped metadata and emits policy decisions; the
 * sensitive content path remains local and optical.
 */

export const CONTROL_PLANE_API_VERSION = "2026-08-04" as const;
export const CONTROL_PLANE_BASE_PATH = "/v1" as const;

export type ManagementRole =
  | "security-admin"
  | "device-admin"
  | "auditor"
  | "operator"
  | "read-only";

export type HttpMethod = "GET" | "POST" | "PATCH";
export type ApiStability = "implemented-contract" | "planned";

export interface ControlPlaneEndpoint {
  operationId: string;
  method: HttpMethod;
  path: string;
  summary: string;
  roles: readonly ManagementRole[];
  mutating: boolean;
  idempotencyRequired: boolean;
  twoPersonApproval: boolean;
  stability: ApiStability;
}

export const CONTROL_PLANE_ENDPOINTS: readonly ControlPlaneEndpoint[] = Object.freeze([
  endpoint("getTenant", "GET", "/v1/tenants/{tenantId}", "Tenant metadata", ["security-admin", "device-admin", "auditor", "operator", "read-only"]),
  endpoint("listSites", "GET", "/v1/tenants/{tenantId}/sites", "List tenant sites", ["security-admin", "device-admin", "auditor", "operator", "read-only"]),
  endpoint("createSite", "POST", "/v1/tenants/{tenantId}/sites", "Create a tenant site", ["security-admin", "device-admin"], true),
  endpoint("listDevices", "GET", "/v1/tenants/{tenantId}/devices", "List enrolled devices", ["security-admin", "device-admin", "auditor", "operator", "read-only"]),
  endpoint("requestEnrollment", "POST", "/v1/tenants/{tenantId}/enrollment-requests", "Request hardware-backed device enrollment", ["security-admin", "device-admin"], true),
  endpoint("approveEnrollment", "POST", "/v1/tenants/{tenantId}/enrollment-requests/{requestId}/approve", "Approve device enrollment", ["security-admin", "device-admin"], true, true),
  endpoint("requestRevocation", "POST", "/v1/tenants/{tenantId}/revocation-requests", "Request device-key revocation", ["security-admin", "device-admin"], true),
  endpoint("approveRevocation", "POST", "/v1/tenants/{tenantId}/revocation-requests/{requestId}/approve", "Approve device-key revocation", ["security-admin"], true, true),
  endpoint("listPolicies", "GET", "/v1/tenants/{tenantId}/policies", "List transfer policies", ["security-admin", "device-admin", "auditor", "operator", "read-only"]),
  endpoint("requestPolicy", "POST", "/v1/tenants/{tenantId}/policy-requests", "Request a versioned transfer policy", ["security-admin"], true),
  endpoint("approvePolicy", "POST", "/v1/tenants/{tenantId}/policy-requests/{requestId}/approve", "Approve and publish a transfer policy", ["security-admin"], true, true),
  endpoint("getTrustBundle", "GET", "/v1/tenants/{tenantId}/trust-bundles/latest", "Download the latest signed offline trust bundle", ["security-admin", "device-admin", "auditor", "operator"]),
  endpoint("listAuditEvents", "GET", "/v1/tenants/{tenantId}/audit-events", "List management-plane audit events", ["security-admin", "auditor"]),
  endpoint("requestAuditExport", "POST", "/v1/tenants/{tenantId}/audit-exports", "Request a sealed audit export", ["security-admin", "auditor"], true),
]);

export interface ManagementActor {
  subject: string;
  tenantId: string;
  roles: readonly ManagementRole[];
  authenticatedAt: string;
  mfa: boolean;
}

export type AuthorizationDecision =
  | { ok: true; endpoint: ControlPlaneEndpoint }
  | { ok: false; reason: string };

/** Deny by default and bind every object operation to the authenticated tenant. */
export function authorizeControlPlaneRequest(
  actor: ManagementActor,
  operationId: string,
  resourceTenantId: string,
): AuthorizationDecision {
  const endpoint = CONTROL_PLANE_ENDPOINTS.find((candidate) => candidate.operationId === operationId);
  if (!endpoint) return { ok: false, reason: "unknown operation; access denied by default" };
  if (!validIdentifier(actor.subject, 160) || !validIdentifier(actor.tenantId, 80)) {
    return { ok: false, reason: "invalid authenticated actor" };
  }
  if (actor.tenantId !== resourceTenantId) return { ok: false, reason: "tenant boundary violation" };
  if (!actor.roles.some((role) => endpoint.roles.includes(role))) {
    return { ok: false, reason: "role is not allowed for this operation" };
  }
  if (endpoint.mutating && !actor.mfa) return { ok: false, reason: "mutating operations require MFA" };
  if (!strictIsoDate(actor.authenticatedAt)) return { ok: false, reason: "invalid authentication time" };
  return { ok: true, endpoint };
}

const FORBIDDEN_CONTENT_KEYS = new Set([
  "content", "contents", "file", "files", "payload", "bytes", "blob", "ciphertext",
  "plaintext", "cameraframe", "cameraframes", "sessionkey", "privatekey", "aeskey",
]);
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_MANAGEMENT_SCALAR_CHARS = 1_000_000;
const MAX_MANAGEMENT_FIELDS = 20_000;

/** Reject transfer-plane material before it can enter a management API handler. */
export function validateManagementPayload(value: unknown): { ok: true } | { ok: false; reason: string } {
  const seen = new Set<object>();
  let fields = 0;
  const visit = (candidate: unknown, path: string, depth: number): string | undefined => {
    if (depth > 12) return `${path}: nesting limit exceeded`;
    if (typeof candidate === "string" && candidate.length > MAX_MANAGEMENT_SCALAR_CHARS) return `${path}: string limit exceeded`;
    if (typeof candidate === "number" && !Number.isFinite(candidate)) return `${path}: non-finite number is forbidden`;
    if (["bigint", "function", "symbol", "undefined"].includes(typeof candidate)) return `${path}: non-JSON value is forbidden`;
    if (candidate instanceof ArrayBuffer || ArrayBuffer.isView(candidate) || candidate instanceof Blob) {
      return `${path}: binary transfer material is forbidden`;
    }
    if (!candidate || typeof candidate !== "object") return undefined;
    if (seen.has(candidate)) return `${path}: cyclic object is forbidden`;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      if (candidate.length > 10_000) return `${path}: array limit exceeded`;
      for (let index = 0; index < candidate.length; index++) {
        const error = visit(candidate[index], `${path}[${index}]`, depth + 1);
        if (error) return error;
      }
      return undefined;
    }
    const record = candidate as Record<string, unknown>;
    for (const [key, nested] of Object.entries(record)) {
      fields++;
      if (fields > MAX_MANAGEMENT_FIELDS) return `${path}: field limit exceeded`;
      const normalizedKey = key.normalize("NFKC").replace(/[-_\s]/g, "").toLowerCase();
      if (FORBIDDEN_OBJECT_KEYS.has(key)) return `${path}.${key}: unsafe object key is forbidden`;
      if (FORBIDDEN_CONTENT_KEYS.has(normalizedKey)) return `${path}.${key}: transfer material is forbidden`;
      const error = visit(nested, `${path}.${key}`, depth + 1);
      if (error) return error;
    }
    return undefined;
  };
  const reason = visit(value, "$", 0);
  return reason ? { ok: false, reason } : { ok: true };
}

export interface ApprovalRequest<T> {
  id: string;
  tenantId: string;
  kind: "enrollment" | "revocation" | "policy";
  requestedBy: string;
  requestedAt: string;
  state: "pending" | "approved";
  approvedBy?: string;
  approvedAt?: string;
  value: T;
}

/** Pure transition used by adapters; persistence must use an atomic compare-and-set. */
export function approveRequest<T>(
  request: ApprovalRequest<T>,
  actor: ManagementActor,
  now = new Date(),
): ApprovalRequest<T> {
  if (request.state !== "pending") throw new Error("approval request is not pending");
  if (request.tenantId !== actor.tenantId) throw new Error("tenant boundary violation");
  if (request.requestedBy === actor.subject) throw new Error("requester cannot approve their own request");
  if (!actor.mfa) throw new Error("approval requires MFA");
  const canApprove = request.kind === "enrollment"
    ? actor.roles.some((role) => role === "security-admin" || role === "device-admin")
    : actor.roles.includes("security-admin");
  if (!canApprove) {
    throw new Error("actor cannot approve this request");
  }
  return Object.freeze({
    ...request,
    state: "approved",
    approvedBy: actor.subject,
    approvedAt: now.toISOString(),
  });
}

export type PhaseStatus = "complete" | "active" | "planned" | "external-evidence";
export type EvidenceStatus = "verified" | "pending" | "external";

export interface ProductPhase {
  id: string;
  order: number;
  horizon: "Foundation" | "Paid pilot" | "Enterprise" | "Global GA";
  title: string;
  outcome: string;
  status: PhaseStatus;
  evidence: readonly { label: string; status: EvidenceStatus }[];
}

export const PRODUCT_PHASES: readonly ProductPhase[] = Object.freeze([
  phase("secure-core", 1, "Foundation", "Secure optical core", "Encrypted optical transfer, mutual receipt and protocol conformance.", "complete", [
    ["Protocol and cryptographic tests", "verified"], ["Coverage-guided fuzz target", "verified"],
  ]),
  phase("enterprise-trust", 2, "Foundation", "Enterprise offline trust", "Signed tenant enrollment, policy, revocation and rollback protection.", "complete", [
    ["Trust bundle implementation", "verified"], ["Mutual enrollment SDK enforcement", "verified"],
  ]),
  phase("control-plane-contract", 3, "Paid pilot", "Control Plane API & console", "Tenant-isolated management contract and evidence-led operations interface.", "active", [
    ["Tenant-bound authorization contract", "verified"], ["Two-person approval state machine", "verified"],
    ["B2B/OEM offer surface and local pilot scoping", "verified"],
    ["Public policy center and accessible motion baseline", "verified"],
    ["Legal operator, hosting and disclosure-channel approval", "pending"],
    ["Persistent regional service and IAM", "pending"],
  ]),
  phase("native-device-trust", 4, "Paid pilot", "Native hardware identity", "StrongBox, TPM and Secure Enclave signing with verified platform attestation.", "active", [
    ["Windows TPM signing bridge and local qualification", "verified"],
    ["Android StrongBox producer build and lint", "verified"],
    ["Pinned Google roots and fresh revocation cache operation", "verified"],
    ["Windows TPM attestation producer", "pending"],
    ["Apple App Attest native producer", "pending"],
    ["Windows, Android and Apple verifier implementations", "verified"],
    ["Physical vendor-rooted device evidence", "external"],
  ]),
  phase("physical-qualification", 5, "Paid pilot", "Physical device qualification", "Five-device matrix with ≥99% success and zero silent corruption.", "external-evidence", [
    ["Qualification tooling", "verified"], ["25,000+ physical transfers", "external"],
  ]),
  phase("independent-assurance", 6, "Enterprise", "Independent security assurance", "External protocol, cryptography and application assessment with findings closed.", "external-evidence", [
    ["Review scope and evidence pack", "verified"], ["Independent assessment", "external"],
  ]),
  phase("enterprise-operations", 7, "Enterprise", "Enterprise operations", "Regional service, HSM authority, SSO/SCIM, sealed audit export and support controls.", "planned", [
    ["HSM-backed authority service", "pending"], ["SSO, SCIM and regional isolation", "pending"], ["WORM audit export", "pending"],
  ]),
  phase("signed-distribution", 8, "Enterprise", "Signed distribution", "Reproducible, signed web/native release with provenance and rollback drills.", "planned", [
    ["SBOM and release manifest", "verified"], ["Signed tags and native installers", "pending"],
  ]),
  phase("global-ga", 9, "Global GA", "Global availability", "Validated multi-region product with pilots, SLA and operational acceptance.", "planned", [
    ["Two design-partner pilots", "external"], ["Multi-region disaster recovery", "external"], ["GA operating acceptance", "external"],
  ]),
]);

export function phaseProgress(phaseValue: ProductPhase): number {
  if (!phaseValue.evidence.length) return 0;
  const done = phaseValue.evidence.filter((item) => item.status === "verified").length;
  return Math.round((done / phaseValue.evidence.length) * 100);
}

export function roadmapSummary(phases: readonly ProductPhase[] = PRODUCT_PHASES): {
  complete: number; active: number; planned: number; externalEvidence: number; verifiedEvidence: number; totalEvidence: number;
} {
  return {
    complete: phases.filter((item) => item.status === "complete").length,
    active: phases.filter((item) => item.status === "active").length,
    planned: phases.filter((item) => item.status === "planned").length,
    externalEvidence: phases.filter((item) => item.status === "external-evidence").length,
    verifiedEvidence: phases.flatMap((item) => item.evidence).filter((item) => item.status === "verified").length,
    totalEvidence: phases.flatMap((item) => item.evidence).length,
  };
}

export function controlPlaneOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const api of CONTROL_PLANE_ENDPOINTS) {
    const path = api.path.replace(CONTROL_PLANE_BASE_PATH, "");
    paths[path] ??= {};
    const requestBody = requestBodyFor(api.operationId);
    paths[path][api.method.toLowerCase()] = {
      operationId: api.operationId,
      summary: api.summary,
      security: [{ oidc: [] }],
      parameters: [
        ...pathParameters(api.path),
        ...(api.idempotencyRequired ? [{
          name: "Idempotency-Key", in: "header", required: true,
          schema: { type: "string", minLength: 16, maxLength: 160 },
          description: "Unique per tenant, actor and operation; retained by the deployment replay window.",
        }] : []),
      ],
      responses: {
        "200": { description: "Success" },
        "400": { description: "Invalid request" },
        "401": { description: "Authentication required" },
        "403": { description: "Tenant or role policy denied the request" },
      },
      "x-kionel-roles": api.roles,
      "x-kionel-mfa-required": api.mutating,
      "x-kionel-two-person-approval": api.twoPersonApproval,
      ...(requestBody ? { requestBody } : {}),
    };
  }
  return {
    openapi: "3.1.1",
    info: {
      title: "Kionel Enterprise Control Plane API",
      version: CONTROL_PLANE_API_VERSION,
      description: "Management metadata only. Optical transfer content is never accepted by this API.",
    },
    servers: [{ url: "https://api.kionel.example/v1", description: "Placeholder; deployments use a region-specific origin." }],
    security: [{ oidc: [] }],
    paths,
    components: {
      securitySchemes: {
        oidc: { type: "openIdConnect", openIdConnectUrl: "https://identity.example/.well-known/openid-configuration" },
      },
    },
  };
}

function requestBodyFor(operationId: string): Record<string, unknown> | undefined {
  const schemas: Record<string, Record<string, unknown>> = {
    createSite: closedSchema(["siteId", "displayName"], {
      siteId: shortString(80), displayName: shortString(160),
    }),
    requestEnrollment: closedSchema(["deviceId", "siteId", "displayName", "roles", "attestation"], {
      deviceId: shortString(120), siteId: shortString(80), displayName: shortString(160),
      roles: { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: { type: "string", enum: ["operator", "lab-terminal", "custody-terminal", "kiosk", "auditor"] } },
      attestation: { type: "object", description: "Platform attestation evidence; never an application private key.", maxProperties: 32 },
    }),
    approveEnrollment: closedSchema([], {}),
    requestRevocation: closedSchema(["kid", "reason", "effectiveAt"], {
      kid: shortString(240), reason: { type: "string", enum: ["key-compromise", "device-lost", "retired", "role-ended", "policy-violation"] },
      effectiveAt: { type: "string", format: "date-time" },
    }),
    approveRevocation: closedSchema([], {}),
    requestPolicy: closedSchema(["version", "allowedProfiles", "requireContext", "maxContentBytes", "transports"], {
      version: { type: "integer", minimum: 1 },
      allowedProfiles: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { type: "string", enum: ["lab", "custody", "personal"] } },
      requireContext: { type: "boolean" }, maxContentBytes: { type: "integer", minimum: 1, maximum: 67108864 },
      transports: { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: shortString(80) },
    }),
    approvePolicy: closedSchema([], {}),
    requestAuditExport: closedSchema(["from", "until", "format"], {
      from: { type: "string", format: "date-time" }, until: { type: "string", format: "date-time" },
      format: { type: "string", enum: ["jsonl", "cef"] },
    }),
  };
  const schema = schemas[operationId];
  return schema ? { required: true, content: { "application/json": { schema } } } : undefined;
}

function closedSchema(required: string[], properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", additionalProperties: false, required, properties };
}

function shortString(maxLength: number): Record<string, unknown> {
  return { type: "string", minLength: 1, maxLength };
}

function endpoint(
  operationId: string,
  method: HttpMethod,
  path: string,
  summary: string,
  roles: readonly ManagementRole[],
  mutating = false,
  twoPersonApproval = false,
): ControlPlaneEndpoint {
  return Object.freeze({
    operationId, method, path, summary, roles: Object.freeze([...roles]), mutating,
    idempotencyRequired: mutating, twoPersonApproval, stability: "implemented-contract",
  });
}

function phase(
  id: string,
  order: number,
  horizon: ProductPhase["horizon"],
  title: string,
  outcome: string,
  status: PhaseStatus,
  evidence: readonly (readonly [string, EvidenceStatus])[],
): ProductPhase {
  return Object.freeze({ id, order, horizon, title, outcome, status, evidence: Object.freeze(evidence.map(([label, evidenceStatus]) => Object.freeze({ label, status: evidenceStatus }))) });
}

function pathParameters(path: string): Record<string, unknown>[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1], in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 160 },
  }));
}

function validIdentifier(value: string, max: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value);
}

function strictIsoDate(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;
}
