import { beforeEach, expect, test, vi } from "vitest";
import { historyResponse } from "@everloot/protocol";

const history = vi.hoisted(() => ({ readDailyHistory: vi.fn() }));
vi.mock("@/lib/platform-history", () => history);
import { GET } from "./route";

const day = { date: "2026-11-22", source: "snapshot", dataAsOf: "2026-11-23T00:00:12Z", uploads: 1243, records: 9, contributors: 4, kinds: { loot: 9 }, market: null, coverage: null };
const req = (headers: Record<string, string> = {}) => new Request("https://everloot.app/api/history", { headers });

beforeEach(() => { history.readDailyHistory.mockReset(); });

test("the stored days are served as a cacheable public file with an ETag that answers 304 when unchanged", async () => {
  history.readDailyHistory.mockResolvedValue([day]);
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ version: 1, days: [day] });
  // The answer is what the protocol says it is, so /api/openapi.json and the reference page describe it.
  expect(historyResponse.safeParse(body).success).toBe(true);
  expect(res.headers.get("cache-control")).toContain("public");
  const etag = res.headers.get("etag")!;
  expect((await GET(req({ "if-none-match": etag }))).status).toBe(304);
});

test("before the first day the list is empty; unreadable storage is a 503 no cache keeps, never an empty list", async () => {
  history.readDailyHistory.mockResolvedValue([]);
  expect(await (await GET(req())).json()).toEqual({ version: 1, days: [] });
  history.readDailyHistory.mockResolvedValue(null);
  const res = await GET(req());
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
});
