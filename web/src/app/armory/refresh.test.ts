import { afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), quota: vi.fn() }));
vi.mock("@/lib/armory-store", () => ({ armoryStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { form: mocks.quota } }));
import { POST } from "./[region]/[slug]/refresh/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const call = (region = "us", slug = "ember-vale") => POST(new Request("https://everloot.app/armory/us/ember-vale/refresh", { method: "POST" }), { params: Promise.resolve({ region, slug }) });
test("refresh applies the form quota and reports queued versus cooldown", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  mocks.quota.mockResolvedValue({ allowed: true });
  for (const state of ["queued", "cooldown", "queued-already", "unavailable"]) {
    mocks.refresh.mockResolvedValue(state);
    const response = await call();
    expect(new URL(response.headers.get("location")!).searchParams.get("refresh")).toBe(state);
  }
  mocks.refresh.mockClear();
  mocks.quota.mockResolvedValue({ allowed: false });
  expect(new URL((await call()).headers.get("location")!).searchParams.get("refresh")).toBe("limit");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
test("off and malformed identities never write", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "");
  expect((await call()).status).toBe(404);
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  expect((await call("kr")).status).toBe(404);
  expect((await call("us", "../bad")).status).toBe(404);
  expect(mocks.refresh).not.toHaveBeenCalled();
});
