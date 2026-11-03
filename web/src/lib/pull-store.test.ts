import { expect, test, vi } from "vitest";
import { createCloudPullStore, createMemoryPullStore } from "./pull-store";
import { pullProblem, pullUpsert, pullSummariesOn, type PullRow } from "./pull-summaries";

const now = new Date("2026-11-02T12:00:00Z");
const pull = (eventId: string, members: PullRow["members"], over: Partial<PullRow> = {}): PullRow => ({
  kind: "pull_summary", installId: "install-1234", eventId, capturedAt: "2026-11-02T11:00:00Z", encounterId: 1144, name: "Rhahk'zor",
  instanceMapId: 36, success: true, realm: "Forever Pioneer", members, ...over,
});
const thrallina = { name: "Thrallina", class: "SHAMAN", healingDone: 25000 } as const;
const myself = { name: "Myself", class: "HUNTER", self: true, damageDone: 30000 } as const;
const names = (store: ReturnType<typeof createMemoryPullStore>) => store.pulls().map((p) => p.members.map((m) => m.name));

test("the switch is off unless set to 1", () => {
  expect(pullSummariesOn({})).toBe(false);
  expect(pullSummariesOn({ EVERLOOT_PULL_SUMMARIES: "true" })).toBe(false);
  expect(pullSummariesOn({ EVERLOOT_PULL_SUMMARIES: "1" })).toBe(true);
});

test("a stored pull keeps its row without the members, and every member gets a realm", () => {
  const stored = pullUpsert(pull("epoch:1", [myself, { ...thrallina, realm: "Elsewhere" }]));
  expect(stored.summary).not.toHaveProperty("members");
  expect(stored.summary).toMatchObject({ encounterId: 1144, realm: "Forever Pioneer" });
  expect(stored.members.map((m) => m.realm)).toEqual(["Forever Pioneer", "Elsewhere"]);
});

test("a pull without an event id, a realm, or a date inside the year is refused", () => {
  expect(pullProblem(pull("epoch:1", [myself]), now)).toBeNull();
  expect(pullProblem(pull("epoch:1", [myself], { eventId: undefined }), now)).toContain("event id");
  expect(pullProblem(pull("epoch:1", [myself], { realm: undefined }), now)).toContain("realm");
  expect(pullProblem(pull("epoch:1", [{ ...myself, realm: "Elsewhere" }], { realm: undefined }), now)).toBeNull();
  expect(pullProblem(pull("epoch:1", [myself], { capturedAt: "2025-10-01T00:00:00Z" }), now)).toContain("365 days");
  expect(pullProblem(pull("epoch:1", [myself], { capturedAt: "2026-11-04T00:00:00Z" }), now)).toContain("1 day ahead");
});

test("a character hidden before the upload is never stored; a pull with only hidden members is not stored at all", async () => {
  const store = createMemoryPullStore(() => now);
  await store.forget("forever-pioneer", "THRALLINA");
  await store.insert([pullUpsert(pull("epoch:1", [myself, thrallina])), pullUpsert(pull("epoch:2", [thrallina]))]);
  expect(names(store)).toEqual([["Myself"]]);
});

test("hiding a character after the upload deletes it from every stored pull, and a pull left empty goes too", async () => {
  const store = createMemoryPullStore(() => now);
  await store.insert([pullUpsert(pull("epoch:1", [myself, thrallina])), pullUpsert(pull("epoch:2", [{ ...thrallina, realm: "Forever  Pioneer" }]))]);
  expect(names(store)).toEqual([["Myself", "Thrallina"], ["Thrallina"]]);
  await store.forget("Forever Pioneer", "Thrallina");
  expect(names(store)).toEqual([["Myself"]]);
  // And it stays out of later uploads.
  await store.insert([pullUpsert(pull("epoch:3", [thrallina, myself]))]);
  expect(names(store)).toEqual([["Myself"], ["Myself"]]);
});

test("a pull sent again changes nothing, and a pull is deleted a year after it was received", async () => {
  let clock = now;
  const store = createMemoryPullStore(() => clock);
  await store.insert([pullUpsert(pull("epoch:1", [myself]))]);
  await store.insert([pullUpsert(pull("epoch:1", [myself, thrallina]))]);
  expect(names(store)).toEqual([["Myself"]]);
  clock = new Date(now.getTime() + 200 * 86_400_000);
  await store.insert([pullUpsert(pull("epoch:2", [thrallina]))]);
  clock = new Date(now.getTime() + 366 * 86_400_000);
  await store.prune();
  expect(names(store)).toEqual([["Thrallina"]]);
});

test("the cloud store sends one call per upload and per hide, and a failed call throws", async () => {
  const doFetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("1", { status: 200 }));
  const store = createCloudPullStore("https://db.example/", "key", doFetch as unknown as typeof fetch);
  await store.insert([]);
  expect(doFetch).not.toHaveBeenCalled();
  await store.insert([pullUpsert(pull("epoch:1", [myself, thrallina]))]);
  await store.forget("Forever Pioneer", "Thrallina");
  await store.prune();
  expect(doFetch.mock.calls.map(([url]) => String(url))).toEqual([
    "https://db.example/rest/v1/rpc/insert_pull_summaries", "https://db.example/rest/v1/rpc/forget_pull_member", "https://db.example/rest/v1/rpc/prune_pull_summaries",
  ]);
  const sent = JSON.parse(String(doFetch.mock.calls[0]![1]!.body));
  expect(sent.p_rows[0]).toMatchObject({ installId: "install-1234", eventId: "epoch:1", members: [{ name: "Myself", realm: "Forever Pioneer" }, { name: "Thrallina", realm: "Forever Pioneer" }] });
  expect(JSON.parse(String(doFetch.mock.calls[1]![1]!.body))).toEqual({ p_realm: "Forever Pioneer", p_name: "Thrallina" });
  doFetch.mockResolvedValueOnce(new Response("", { status: 503 }));
  await expect(store.forget("Forever Pioneer", "Thrallina")).rejects.toThrow("Pull storage unavailable (503)");
});

test("pruning where the migration was never applied does nothing and throws nothing; any other failure still throws", async () => {
  const absent = () => new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.prune_pull_summaries" }), { status: 404 });
  const doFetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => absent());
  const store = createCloudPullStore("https://db.example", "key", doFetch as unknown as typeof fetch);
  await expect(store.prune()).resolves.toBeUndefined();
  expect(String(doFetch.mock.calls[0]![0])).toBe("https://db.example/rest/v1/rpc/prune_pull_summaries");
  // Only retention is excused: a write or a hide against missing tables is still an error.
  await expect(store.forget("Forever", "Thrallina")).rejects.toThrow("Pull storage unavailable (404)");
  doFetch.mockResolvedValueOnce(new Response("", { status: 404 }));
  await expect(store.prune()).rejects.toThrow("Pull storage unavailable (404)");
  doFetch.mockResolvedValueOnce(new Response("{}", { status: 500 }));
  await expect(store.prune()).rejects.toThrow("Pull storage unavailable (500)");
});
