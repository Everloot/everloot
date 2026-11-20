import { beforeEach, expect, test, vi } from "vitest";
import { computeSettled, emptySettledList } from "@kb/settled-list";

const corpus = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./upload-store", () => ({ cloudConfig: () => null, uploadStore: { loadCorpus: corpus.load } }));
import { createSettledTally, readSettledFile, readSettledList, settledForIntake, settledKey, settledTallyOn, writeSettled } from "./settled-store";

const CLOUD = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "everloot-uploads", supabaseUrl: "https://db.test", supabaseServiceKey: "service" };
const BUILD = "1.60.1.70450";
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
const records = Array.from({ length: 5 }, (_, i) => ({
  kind: "npc_sighting", installId: `install-${i}`, capturedAt: day(0), npcId: 1, name: "Marshal Dughan", mapId: 1429, x: 42, y: 65, positionKind: "npc",
}));
const WEEK = "2026-W03";
const FILE = computeSettled({ records, asOf: day(30), build: BUILD, week: WEEK });
const answer = (status: number, body?: unknown) => vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

beforeEach(() => { corpus.load.mockReset().mockResolvedValue({ uploads: 1, records, dataAsOf: day(29) }); });

test("the cron writes the list and its values beside the score, dated by the snapshot, only after a change", async () => {
  const fetch = vi.fn(async (_req: string | URL | Request) => new Response(null, { status: 200 }));
  expect(await writeSettled({ added: 0, dataAsOf: day(30) }, { cloud: CLOUD, fetch })).toEqual({ written: false });
  expect(fetch).not.toHaveBeenCalled();
  const out = await writeSettled({ added: 2, dataAsOf: day(30) }, { cloud: CLOUD, fetch, build: BUILD, recheck: [], week: WEEK });
  expect(out).toEqual({ written: true, key: `coverage/settled-${BUILD}.json`, facts: 1, week: WEEK });
  const put = fetch.mock.calls[0]![0] as Request;
  expect(put.method).toBe("PUT");
  expect(put.url).toBe(`https://acct.r2.cloudflarestorage.com/everloot-uploads/${settledKey(BUILD)}`);
  expect(JSON.parse(await put.text())).toEqual(FILE);
  const forced = await writeSettled({ added: 0, dataAsOf: day(30), force: true, week: WEEK }, { cloud: CLOUD, fetch, build: BUILD, recheck: [] });
  expect(forced).toEqual({ written: true, key: `coverage/settled-${BUILD}.json`, facts: 1, week: WEEK });
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(writeSettled({ added: 1, dataAsOf: null }, { cloud: null })).rejects.toThrow(/cloud/);
});

test("reading: a missing file is no list, a list of another build is refused, and the public list drops the values", async () => {
  expect(await readSettledFile(BUILD, { cloud: CLOUD, fetch: answer(404) })).toBeNull();
  expect(await readSettledFile(BUILD, { cloud: CLOUD, fetch: answer(200, FILE) })).toEqual(FILE);
  expect(await readSettledFile("1.61.0.1", { cloud: CLOUD, fetch: answer(200, FILE) })).toBeNull();
  expect(await readSettledFile("../x", { cloud: CLOUD, fetch: answer(200, FILE) })).toBeNull();
  await expect(readSettledFile(BUILD, { cloud: CLOUD, fetch: answer(500) })).rejects.toThrow();
  const list = await readSettledList(BUILD, { cloud: CLOUD, fetch: answer(200, FILE) });
  expect("values" in list).toBe(false);
  expect(await readSettledList(BUILD, { cloud: CLOUD, fetch: answer(404) })).toEqual(emptySettledList(BUILD));
});

test("the intake reads the file at most every 10 minutes and keeps the last one when storage fails", async () => {
  let now = 0;
  const fetch = answer(200, FILE);
  expect(await settledForIntake(BUILD, { cloud: CLOUD, fetch, now: () => now })).toEqual(FILE);
  now = 9 * 60_000;
  await settledForIntake(BUILD, { cloud: CLOUD, fetch, now: () => now });
  expect(fetch).toHaveBeenCalledTimes(1);
  now = 11 * 60_000;
  expect(await settledForIntake(BUILD, { cloud: CLOUD, fetch: answer(500), now: () => now })).toEqual(FILE);
});

test("the tally is off unless the switch is exactly 1, keeps installs as keyed hashes, and counts each once locally", async () => {
  expect(settledTallyOn({})).toBe(false);
  expect(settledTallyOn({ EVERLOOT_SETTLED_TALLY: "true" })).toBe(false);
  expect(settledTallyOn({ EVERLOOT_SETTLED_TALLY: "1" })).toBe(true);
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("1", { status: 200 }));
  await createSettledTally({ env: { SUPABASE_URL: "https://db.test/", SUPABASE_SERVICE_ROLE_KEY: "service" }, fetch }).add(BUILD, "install-1234", ["npc:1@1429", "npc:1@1429"]);
  const [url, init] = fetch.mock.calls[0]! as [string, RequestInit];
  expect(url).toBe("https://db.test/rest/v1/rpc/tally_settled_facts");
  expect(JSON.parse(String(init.body))).toEqual({ p_build: BUILD, p_voter: expect.stringMatching(/^[a-f0-9]{64}$/), p_facts: ["npc:1@1429"] });
  expect(String(init.body)).not.toContain("install-1234");
  const failing = createSettledTally({ env: { SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "service" }, fetch: answer(500) });
  await expect(failing.add(BUILD, "install-1234", ["quest:1"])).rejects.toThrow();
  const local = createSettledTally({ env: {} });
  await local.add(BUILD, "install-1234", ["quest:1"]);
  await local.add(BUILD, "install-1234", ["quest:1"]);
  await local.add(BUILD, "install-5678", ["quest:1"]);
  expect(local.local.get(`${BUILD}|quest:1`)?.size).toBe(2);
  await expect(createSettledTally({ env: { NODE_ENV: "production" } }).add(BUILD, "install-1234", ["quest:1"])).rejects.toThrow(/not configured/);
});
