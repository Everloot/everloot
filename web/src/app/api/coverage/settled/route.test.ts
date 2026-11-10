import { beforeEach, expect, test, vi } from "vitest";
import { emptySettledList, encodeIds } from "../../../../../../kb/src/settled-list";

const read = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/settled-store", () => ({ readSettledList: read.list }));
import { GET } from "./route";

const BUILD = "1.60.1.70450";
const req = (query: string, headers: Record<string, string> = {}) => new Request(`https://everloot.app/api/coverage/settled${query}`, { headers });
const LIST = { ...emptySettledList(BUILD), dataAsOf: "2026-10-20T00:00:00.000Z", quest: encodeIds([783, 7, 33]) };

beforeEach(() => { read.list.mockReset().mockResolvedValue(LIST); });

test("serves the build's list with an ETag, and answers a matching If-None-Match with 304", async () => {
  const res = await GET(req(`?build=${BUILD}`));
  expect(res.status).toBe(200);
  expect(read.list).toHaveBeenCalledWith(BUILD);
  expect(await res.json()).toEqual(LIST);
  const etag = res.headers.get("etag")!;
  expect(etag).toMatch(/^"[a-f0-9]{32}"$/);
  expect(res.headers.get("cache-control")).toContain("public");
  const again = await GET(req(`?build=${BUILD}`, { "if-none-match": `W/${etag}` }));
  expect(again.status).toBe(304);
  expect(again.headers.get("etag")).toBe(etag);
});

test("a build the server has not looked at gets the empty list the store returns", async () => {
  read.list.mockResolvedValue(emptySettledList("1.61.0.71000"));
  const body = await (await GET(req("?build=1.61.0.71000"))).json();
  expect(body).toMatchObject({ build: "1.61.0.71000", dataAsOf: null, quest: [] });
});

test("a malformed build is refused before storage is read, and unreachable storage is not an empty list", async () => {
  for (const q of ["", "?build=latest", "?build=../coverage/1", `?build=${"1.".repeat(20)}1`]) {
    const res = await GET(req(q));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  }
  expect(read.list).not.toHaveBeenCalled();
  read.list.mockRejectedValue(new Error("r2 down"));
  const res = await GET(req(`?build=${BUILD}`));
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
});
