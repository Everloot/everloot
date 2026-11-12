import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PublicationState } from "../../../kb/src/publication";
const stores = vi.hoisted(() => ({ loadCorpus: vi.fn(), loadState: vi.fn() }));
vi.mock("./upload-store", () => ({ uploadStore: { loadCorpus: stores.loadCorpus }, sharingStore: { loadState: stores.loadState } }));
import { buildGuildRollup } from "./guild-rollup";
import { writeGuildLadder, loadStoredGuildLadder, forgetStoredGuildLadder } from "./guild-ladder-store";
const cloud = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "uploads" };
const at = "2026-11-12T00:00:00.000Z";
const corpus = { uploads: 3, dataAsOf: at, records: [...["a", "b", "c"].flatMap((installId) => [
  { kind: "instance_entrance", installId, instanceMapId: 409, name: "Molten Core", instanceType: "raid", mapId: 1415, x: 30, y: 80, capturedAt: at },
  { kind: "encounter", installId, encounterId: 663, name: "Lucifron", instanceMapId: 409, success: true, capturedAt: at },
  { kind: "guild_kill", installId, guildName: "Night Watch", realm: "Forever Pioneer", faction: "horde", encounterId: 663, name: "Lucifron", instanceMapId: 409, difficulty: 9, size: 40, capturedAt: at },
]), ...["o1", "o2"].map((installId) => ({
  kind: "guild_snapshot", installId, claimToken: "verified-officer-grant", guildName: "Iron Oath", realm: "Forever Pioneer", faction: "alliance", members: [{ name: "Ada", rank: "Officer", level: 60, class: "Mage" }], capturedAt: at,
}))] };
const authority: PublicationState = { suppressions: [], grants: [{ tokenHash: "a".repeat(64), installId: "install-1", realm: "Forever Pioneer", subject: "Night Watch", subjectType: "guild", categories: ["guild"], expiresAt: "2026-11-13T00:00:00.000Z", revokedAt: null, verifiedBy: "owner", evidence: "confirmed by owner" }] };
let body: string;
let stamp: string;
let authorityStamp: string;
const storage = vi.fn(async (input: RequestInfo | URL) => {
  const req = input as Request;
  if (req.method === "PUT") {
    body = await req.text(); stamp = req.headers.get("x-amz-meta-data-as-of")!;
    authorityStamp = req.headers.get("x-amz-meta-authority")!;
    return new Response(null);
  }
  return body ? new Response(req.method === "HEAD" ? null : body, { headers: { "x-amz-meta-data-as-of": stamp, "x-amz-meta-authority": authorityStamp } }) : new Response(null, { status: 404 });
});
beforeEach(() => {
  body = ""; stamp = ""; authorityStamp = "";
  forgetStoredGuildLadder(); storage.mockClear();
  stores.loadCorpus.mockReset().mockResolvedValue(corpus);
  stores.loadState.mockReset().mockResolvedValue(structuredClone(authority));
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const write = (added = 1) => writeGuildLadder({ added, dataAsOf: at }, { cloud, fetch: storage });
const read = () => loadStoredGuildLadder({ cloud, fetch: storage });

test("the cron stores the existing rollup exactly and readers avoid the corpus", async () => {
  expect(await write()).toMatchObject({ written: true });
  const stored = await read();
  expect(stored?.rollup).toEqual({ ...buildGuildRollup(stored!.rollup.key, corpus.records, new Date(at)) });
  expect(stored?.rollup.rows.length).toBe(3);
  expect(stored?.rollup.boards.size).toBe(1);
  stores.loadCorpus.mockClear();
  expect(await read()).toEqual(stored);
  expect(stores.loadCorpus).not.toHaveBeenCalled();
});

test.each(["revoke", "expire", "suppress", "unreadable"])("cached files are not served after publication authority changes: %s", async (change) => {
  await write(); expect(await read()).not.toBeNull();
  const state = structuredClone(authority);
  if (change === "revoke") state.grants[0]!.revokedAt = at;
  if (change === "expire") vi.setSystemTime("2026-11-14T00:00:00Z");
  if (change === "suppress") state.suppressions.push({ realm: "Forever Pioneer", character: "Ada" });
  if (change === "unreadable") stores.loadState.mockRejectedValue(new Error("authority down"));
  else stores.loadState.mockResolvedValue(state);
  expect(await read()).toBeNull();
});

test("an idle cron refreshes changed authority even with an unchanged corpus stamp", async () => {
  await write(); stores.loadCorpus.mockClear();
  expect(await write(0)).toEqual({ written: false });
  expect(stores.loadCorpus).not.toHaveBeenCalled();
  stores.loadState.mockResolvedValue({ ...authority, suppressions: [{ realm: "Forever Pioneer", character: "Ada" }] });
  expect(await write(0)).toMatchObject({ written: true });
});

test("authority changing while the corpus is being read never stamps stale data as current", async () => {
  stores.loadState.mockResolvedValueOnce(authority).mockResolvedValue({ ...authority, grants: [] });
  await expect(write()).rejects.toThrow("authority changed");
  expect(body).toBe("");
});

test("missing or malformed files return no stored ladder; failed publication never writes a file", async () => {
  expect(await read()).toBeNull();
  forgetStoredGuildLadder(); body = "{}";
  expect(await read()).toBeNull();
  stores.loadCorpus.mockResolvedValue({ records: [], uploads: 0, unreachable: true });
  await expect(write()).rejects.toThrow("corpus unreachable");
});
