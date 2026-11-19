import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { emptySettledList, encodeIds } from "@kb/settled-list";
import { APP_REFRESH_MS, APP_STALE_MS, appSettledList } from "./settled-cache";

const BUILD = "1.60.1.70450";
const LIST = { ...emptySettledList(BUILD), dataAsOf: "2026-10-20T00:00:00.000Z", vendor: encodeIds([50]) };
const ETAG = "\"v1\"";
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { etag: ETAG } });
const folder = () => mkdtempSync(join(tmpdir(), "everloot-settled-"));
const copyOf = (dir: string) => JSON.parse(readFileSync(join(dir, `settled-${BUILD}.json`), "utf8"));

test("the app fetches the list once a day, keeps it in its data folder, and revalidates with its ETag", async () => {
  const dir = folder();
  let now = 1_000;
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok(LIST));
  const opts = { folder: dir, endpoint: "https://everloot.app", build: BUILD, fetch, now: () => now };
  expect(await appSettledList(opts)).toEqual(LIST);
  expect(fetch.mock.calls[0]![0]).toBe(`https://everloot.app/api/coverage/settled?build=${BUILD}`);
  expect(copyOf(dir)).toMatchObject({ fetchedAt: 1_000, etag: ETAG, list: LIST });
  now += APP_REFRESH_MS - 1;
  await appSettledList(opts);
  expect(fetch).toHaveBeenCalledTimes(1);
  now += 2;
  fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
  expect(await appSettledList(opts)).toEqual(LIST);
  expect(fetch.mock.calls[1]![1]).toMatchObject({ headers: { "if-none-match": ETAG } });
  expect(copyOf(dir).fetchedAt).toBe(now);
});

test("offline, a copy up to a week old is used; past that, or with no build, nothing is skipped", async () => {
  const dir = folder();
  writeFileSync(join(dir, `settled-${BUILD}.json`), JSON.stringify({ fetchedAt: 0, etag: null, list: LIST }));
  const down = vi.fn(async () => { throw new Error("offline"); });
  const opts = { folder: dir, endpoint: "https://everloot.app", fetch: down };
  expect(await appSettledList({ ...opts, build: BUILD, now: () => APP_STALE_MS - 1 })).toEqual(LIST);
  expect(await appSettledList({ ...opts, build: BUILD, now: () => APP_STALE_MS + 1 })).toBeNull();
  expect(await appSettledList({ ...opts, build: undefined })).toBeNull();
  expect(down).toHaveBeenCalledTimes(2);
  // A list for another build is not taken.
  const wrong = vi.fn(async () => ok({ ...LIST, build: "1.61.0.1" }));
  expect(await appSettledList({ folder: folder(), endpoint: "https://everloot.app", build: BUILD, fetch: wrong })).toBeNull();
});
