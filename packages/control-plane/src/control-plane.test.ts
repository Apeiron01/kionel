import { describe, expect, it } from "vitest";
import {
  CONTROL_PLANE_ENDPOINTS,
  PRODUCT_PHASES,
  approveRequest,
  authorizeControlPlaneRequest,
  controlPlaneOpenApi,
  phaseProgress,
  roadmapSummary,
  validateManagementPayload,
  type ApprovalRequest,
  type ManagementActor,
} from "./index.js";

const actor = (overrides: Partial<ManagementActor> = {}): ManagementActor => ({
  subject: "user:security-a",
  tenantId: "tenant-a",
  roles: ["security-admin"],
  authenticatedAt: "2026-08-04T09:00:00.000Z",
  mfa: true,
  ...overrides,
});

describe("Kionel control-plane security contract", () => {
  it("denies unknown operations, cross-tenant access and insufficient roles", () => {
    expect(authorizeControlPlaneRequest(actor(), "unknown", "tenant-a")).toMatchObject({ ok: false });
    expect(authorizeControlPlaneRequest(actor(), "listDevices", "tenant-b")).toMatchObject({ ok: false, reason: expect.stringContaining("tenant") });
    expect(authorizeControlPlaneRequest(actor({ roles: ["read-only"] }), "requestRevocation", "tenant-a")).toMatchObject({ ok: false });
    expect(authorizeControlPlaneRequest(actor(), "requestRevocation", "tenant-a")).toMatchObject({ ok: true });
  });

  it("requires MFA for every mutation", () => {
    const mutations = CONTROL_PLANE_ENDPOINTS.filter((endpoint) => endpoint.mutating);
    expect(mutations.length).toBeGreaterThan(0);
    for (const endpoint of mutations) {
      expect(authorizeControlPlaneRequest(actor({ roles: [...endpoint.roles], mfa: false }), endpoint.operationId, "tenant-a"))
        .toMatchObject({ ok: false, reason: expect.stringContaining("MFA") });
    }
  });

  it("requires idempotency for every mutation and explicit approval routes for critical workflows", () => {
    expect(CONTROL_PLANE_ENDPOINTS.filter((endpoint) => endpoint.mutating).every((endpoint) => endpoint.idempotencyRequired)).toBe(true);
    for (const kind of ["Enrollment", "Revocation", "Policy"]) {
      expect(CONTROL_PLANE_ENDPOINTS.some((endpoint) => endpoint.operationId === `approve${kind}` && endpoint.twoPersonApproval)).toBe(true);
    }
    expect(CONTROL_PLANE_ENDPOINTS.some((endpoint) => endpoint.operationId === "publishPolicy")).toBe(false);
  });

  it("rejects file, content, key and binary material recursively", () => {
    expect(validateManagementPayload({ deviceId: "device-1", policy: { version: 2 } })).toEqual({ ok: true });
    for (const value of [
      { content: "secret" },
      { ConTent: "secret" },
      { nested: { sessionKey: "secret" } },
      { nested: { "session-key": "secret" } },
      { cameraFrame: new Uint8Array([1, 2, 3]) },
      { ordinary: new Uint8Array([1, 2, 3]) },
    ]) expect(validateManagementPayload(value)).toMatchObject({ ok: false });
  });

  it("enforces two-person approval and tenant binding", () => {
    const request: ApprovalRequest<{ kid: string }> = {
      id: "request-1", tenantId: "tenant-a", kind: "revocation", requestedBy: "user:security-a",
      requestedAt: "2026-08-04T09:00:00.000Z", state: "pending", value: { kid: "urn:kionel:key:p256:test" },
    };
    expect(() => approveRequest(request, actor())).toThrow("own request");
    expect(() => approveRequest(request, actor({ subject: "user:security-b", tenantId: "tenant-b" }))).toThrow("tenant");
    expect(() => approveRequest(request, actor({ subject: "user:device-b", roles: ["device-admin"] }))).toThrow("cannot approve");
    expect(approveRequest(request, actor({ subject: "user:security-b" }), new Date("2026-08-04T10:00:00.000Z")))
      .toMatchObject({ state: "approved", approvedBy: "user:security-b" });
  });

  it("publishes a tenant-scoped OpenAPI 3.1 contract without upload endpoints", () => {
    const document = controlPlaneOpenApi() as { openapi: string; paths: Record<string, Record<string, { requestBody?: { content: { "application/json": { schema: { additionalProperties: boolean } } } } }>> };
    expect(document.openapi).toBe("3.1.1");
    expect(Object.keys(document.paths).every((path) => path.startsWith("/tenants/{tenantId}/" ) || path === "/tenants/{tenantId}" )).toBe(true);
    const serialized = JSON.stringify(document);
    expect(serialized.toLowerCase()).not.toMatch(/upload|\/files|transfer-content/);
    expect(serialized.match(/Idempotency-Key/g)?.length).toBe(CONTROL_PLANE_ENDPOINTS.filter((endpoint) => endpoint.mutating).length);
    for (const path of Object.values(document.paths)) {
      for (const operation of Object.values(path)) {
        if (operation.requestBody) expect(operation.requestBody.content["application/json"].schema.additionalProperties).toBe(false);
      }
    }
  });
});

describe("Kionel evidence-led roadmap", () => {
  it("keeps phase order unique and derives honest progress from evidence", () => {
    expect(new Set(PRODUCT_PHASES.map((phase) => phase.id)).size).toBe(PRODUCT_PHASES.length);
    expect(PRODUCT_PHASES.map((phase) => phase.order)).toEqual([...PRODUCT_PHASES].map((phase) => phase.order).sort((a, b) => a - b));
    expect(phaseProgress(PRODUCT_PHASES[0])).toBe(100);
    const nativeTrust = PRODUCT_PHASES.find((phase) => phase.id === "native-device-trust")!;
    expect(phaseProgress(nativeTrust)).toBe(57);
    expect(nativeTrust.status).toBe("active");
    const summary = roadmapSummary();
    expect(summary.complete).toBe(2);
    expect(summary.active).toBe(2);
    expect(summary.verifiedEvidence).toBeLessThan(summary.totalEvidence);
  });
});
