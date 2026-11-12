import { afterEach, expect, test, vi } from "vitest";
vi.mock("@/lib/ops/collector", () => ({ collectOpsSummary: vi.fn() }));
import { collectOpsSummary } from "@/lib/ops/collector";
import { GET } from "./route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
test("does not read private sources when cron authorization is absent", async () => {
  vi.stubEnv("CRON_SECRET", "synthetic-cron-secret");
  const response = await GET(new Request("https://example.test/api/cron/ops"));
  expect(response.status).toBe(401);
  expect(collectOpsSummary).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("no-store");
});
test("fails closed without cron configuration", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(new Request("https://example.test/api/cron/ops"))).status).toBe(503);
  expect(collectOpsSummary).not.toHaveBeenCalled();
});
