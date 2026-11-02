import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createSharingStore } from "./sharing-store";
import { createUploadStore } from "./upload-store";
import type { CloudConfig } from "./upload-store";
import { authorizeRecord } from "../../../kb/src/publication";
import { goldSnapshot } from "@everloot/protocol";
const now = () => new Date("2026-10-07T00:00:00Z");
const grantInput = { installId: "install-one", realm: "Moon Guard", subjectType: "character" as const,
  subject: "Thrall", categories: ["gold" as const], expiresAt: "2026-11-01T00:00:00Z",
  verifiedBy: "operator", evidence: "Character owner verified in client" };
const row = goldSnapshot.parse({ kind: "gold_snapshot", installId: "install-one", eventId: "epoch:1", capturedAt: now().toISOString(),
  character: "Thrall", realm: "Moon Guard", currentCopper: 50, peakCopper: 50 });
test("cloud opt-out preserves request headers alongside server authentication", async () => {
  const cloud: CloudConfig = { r2AccountId: "acct", r2AccessKeyId: "key", r2SecretAccessKey: "secret",
    r2Bucket: "bucket", supabaseUrl: "https://sb.example", supabaseServiceKey: "service" };
  const calls: Request[] = [];
  const issuedToken = "a".repeat(64);
  const store = createSharingStore({ cloud, localDir: "unused", now, fetch: (async (url, init) => {
    const request = new Request(url, init); calls.push(request);
    return request.method === "GET"
      ? Response.json([{ token_hash: "b".repeat(64), grant: grantInput, revoked_at: null }])
      : new Response(null, { status: 201 });
  }) as typeof fetch });
  expect(await store.optOut(issuedToken)).toBe(true);
  expect(calls[1].headers.get("prefer")).toBe("resolution=ignore-duplicates");
  expect(calls[1].headers.get("authorization")).toBe("Bearer service");
});
test("cloud publication state is read to its exact count, and a list that cannot be shown complete is an error", async () => {
  const cloud: CloudConfig = { r2AccountId: "acct", r2AccessKeyId: "key", r2SecretAccessKey: "secret",
    r2Bucket: "bucket", supabaseUrl: "https://sb.example", supabaseServiceKey: "service" };
  const stateFrom = (suppressions: (offset: number) => Response) => {
    const calls: Request[] = [];
    const store = createSharingStore({ cloud, localDir: "unused", now, fetch: (async (url, init) => {
      const request = new Request(url, init); calls.push(request);
      if (request.url.includes("publication_grants")) return Response.json([], { headers: { "content-range": "*/0" } });
      return suppressions(Number(new URL(request.url).searchParams.get("offset")));
    }) as typeof fetch });
    return { calls, state: store.loadState() };
  };
  const row = (character: string) => ({ realm: "moon guard", character });
  const paged = stateFrom((offset) => offset === 0
    ? Response.json([row("a"), row("b")], { status: 206, headers: { "content-range": "0-1/3" } })
    : Response.json([row("c")], { status: 206, headers: { "content-range": "2-2/3" } }));
  expect((await paged.state).suppressions.map((s) => s.character)).toEqual(["a", "b", "c"]);
  expect(paged.calls.every((c) => c.headers.get("prefer") === "count=exact")).toBe(true);
  expect(paged.calls.some((c) => c.url.endsWith("offset=2"))).toBe(true);
  await expect(stateFrom(() => Response.json([row("a")])).state).rejects.toThrow(/count missing/);
  await expect(stateFrom((offset) => offset === 0
    ? Response.json([row("a")], { status: 206, headers: { "content-range": "0-0/2" } })
    : new Response("", { status: 503 })).state).rejects.toThrow(/unavailable/);
});
test("grants are random, stored only as hashes and scoped by verified evidence", async () => {
  const localDir = mkdtempSync(join(tmpdir(), "sharing-"));
  const store = createSharingStore({ cloud: null, localDir, now });
  const issued = await store.issue(grantInput);
  expect(issued.token).toMatch(/^[a-f0-9]{64}$/);
  const file = readdirSync(join(localDir, "grants"))[0];
  expect(readFileSync(join(localDir, "grants", file), "utf8")).not.toContain(issued.token);
  expect(await store.lookup("pending-officer-claim")).toBeNull();
  expect(authorizeRecord(row, [issued.tokenHash], await store.loadState(), now())).toEqual(row);
  await expect(store.issue({ ...grantInput, evidence: "" })).rejects.toThrow();
});
test("revocation and global character opt-out apply to cached corpus and later replay", async () => {
  const localDir = mkdtempSync(join(tmpdir(), "sharing-revoke-"));
  const grants = createSharingStore({ cloud: null, localDir, now });
  const first = await grants.issue(grantInput);
  const store = createUploadStore({ cloud: null, localDir, cacheMs: 60_000,
    publication: (state) => grants.publish(state) });
  await store.putUpload("one", "install-one", { addonVersion: "0.2.0", records: [row] }, [first.tokenHash]);
  expect((await store.loadCorpus()).records).toHaveLength(1);
  await grants.revoke(first.token);
  expect((await store.loadCorpus()).records).toEqual([]);
  const second = await grants.issue(grantInput);
  await store.putUpload("two", "install-one", { addonVersion: "0.2.0", records: [row] }, [second.tokenHash]);
  expect((await store.loadCorpus()).records).toHaveLength(1);
  await grants.optOut(second.token);
  expect((await store.loadCorpus()).records).toEqual([]);
  await store.putUpload("three", "install-one", { addonVersion: "0.2.0", records: [row] }, [second.tokenHash]);
  expect((await store.loadCorpus()).records).toEqual([]);
});
