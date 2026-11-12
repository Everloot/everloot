import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorizeOps: vi.fn(), readOpsSummary: vi.fn() }));
vi.mock("@/lib/ops/access", () => ({ authorizeOps: mocks.authorizeOps }));
vi.mock("@/lib/ops/store", () => ({ readOpsSummary: mocks.readOpsSummary }));
import { GET } from "./route";
const request = () => new Request("https://everloot.app/api/ops/summary");
beforeEach(() => vi.resetAllMocks());

test("denial happens before private reads and responses are private no-store", async () => {
  mocks.authorizeOps.mockResolvedValue(null);
  const res = await GET(request());
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "Operations access denied." });
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.readOpsSummary).not.toHaveBeenCalled();
  expect(mocks.authorizeOps).toHaveBeenCalledWith(expect.any(Request), "summary");
});

test.each(["human", "agent"])("%s receives shared aggregate snapshot without contributor identities", async (kind) => {
  mocks.authorizeOps.mockResolvedValue({ kind, id: "operator" });
  mocks.readOpsSummary.mockResolvedValue({
    version: 1, generatedAt: "2026-11-12T12:00:00Z", exclusionVersion: "v1", excludedInstalls: 2,
    sources: {}, activity: { today: 3 }, daily: [{ day: "2026-11-12", contributors: 3 }],
    historical: null, health: {}, costs: {}, usage: {},
    contributors: [{ alias: "private-alias", name: "private-name" }], secret: "never-return",
  });
  const res = await GET(request());
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.activity.today).toBe(3);
  expect(body.generatedAt).toBe("2026-11-12T12:00:00Z");
  expect(body.contributors).toBeUndefined();
  expect(body.secret).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain("private-alias");
  expect(res.headers.get("cache-control")).toBe("private, no-store");
});

test.each([null, new Error("private provider URL with credential")])("unavailable snapshot returns generic no-store failure", async (result) => {
  mocks.authorizeOps.mockResolvedValue({ kind: "human", id: "operator" });
  if (result instanceof Error) mocks.readOpsSummary.mockRejectedValue(result);
  else mocks.readOpsSummary.mockResolvedValue(result);
  const res = await GET(request());
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "Operations data unavailable." });
  expect(res.headers.get("cache-control")).toBe("private, no-store");
});
