import { beforeEach, expect, test, vi } from "vitest";
const store = vi.hoisted(() => ({ put: vi.fn(), telemetry: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { putUpload: store.put }, sharingStore: { lookup: vi.fn() } }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { request: async () => ({ allowed: true }), install: async () => ({ allowed: true }), reporter: () => undefined } }));
vi.mock("@/lib/usage-metrics", () => ({ recordUsage: vi.fn() }));
vi.mock("@/lib/ops/telemetry", async importOriginal => ({ ...await importOriginal<typeof import("./telemetry")>(), recordIntakeTelemetry: store.telemetry }));
import { POST } from "@/app/api/intake/route";
beforeEach(() => { vi.clearAllMocks(); store.put.mockResolvedValue(true); });
const request = () => new Request("https://example.test/api/intake", { method: "POST", body: JSON.stringify({ addonVersion: "0.1.0", records: [
  { kind: "loot", installId: "synthetic-install", capturedAt: "2026-10-05T00:00:00.000Z", sourceNpcId: 123, items: [{ itemId: 456, count: 1 }] },
  { kind: "loot", installId: "", capturedAt: "2026-10-05T00:00:00.000Z", sourceNpcId: 123, items: [{ itemId: 456, count: 1 }] },
] }) });
test("emits one final successful outcome with partial row rejection, after persistence", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(store.put).toHaveBeenCalledOnce();
  expect(store.telemetry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: "accepted", records: 1, rejectedRecords: 1 }));
  expect(store.put.mock.invocationCallOrder[0]).toBeLessThan(store.telemetry.mock.invocationCallOrder[0]);
});
test("failed persistence records only a failure outcome and never successful receipt records", async () => {
  store.put.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(503);
  expect(store.telemetry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: "storage_failure", records: 0 }));
});
