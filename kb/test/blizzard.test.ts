import { expect, test } from "vitest";
import { openDb } from "../src/db.js";
import { BlizzardClient } from "../src/blizzard/client.js";
import { namespace } from "../src/blizzard/namespaces.js";

test("namespace names per game version", () => {
  expect(namespace("retail", "static", "us")).toBe("static-us");
  expect(namespace("classic", "dynamic", "eu")).toBe("dynamic-classic-eu");
  expect(namespace("classic1x", "profile", "us")).toBe("profile-classic1x-us");
  expect(namespace("forever", "static", "us")).toBe("static-forever-us");
  expect(namespace("forever", "dynamic", "eu")).toBe("dynamic-forever-eu");
  expect(namespace("forever", "profile", "eu")).toBe("profile-forever-eu");
  expect(() => namespace("retale" as never, "static", "us")).toThrow();
});

function fakeBlizzard() {
  const calls: string[] = [];
  const impl = async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("https://oauth.battle.net/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 86399 }), { status: 200 });
    }
    return new Response(JSON.stringify({ classes: [{ id: 1, name: "Warrior" }] }), { status: 200 });
  };
  return { calls, impl: impl as typeof fetch };
}

test("fetches a token once and serves repeats from the cache until the TTL passes", async () => {
  const db = openDb(":memory:");
  const { calls, impl } = fakeBlizzard();
  let now = Date.parse("2026-09-27T00:00:00Z");
  const client = new BlizzardClient(db, { clientId: "id", clientSecret: "secret", region: "us", fetchImpl: impl, now: () => now });

  const first = await client.get("/data/wow/playable-class/index", "classic1x", "static", 3600);
  expect(first).toEqual({ classes: [{ id: 1, name: "Warrior" }] });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toBe("https://us.api.blizzard.com/data/wow/playable-class/index?namespace=static-classic1x-us&locale=en_US");

  await client.get("/data/wow/playable-class/index", "classic1x", "static", 3600);
  expect(calls).toHaveLength(2);

  now += 3601 * 1000;
  await client.get("/data/wow/playable-class/index", "classic1x", "static", 3600);
  expect(calls).toHaveLength(3);
});

test("forever requests use the forever namespace", async () => {
  const db = openDb(":memory:");
  const { calls, impl } = fakeBlizzard();
  const client = new BlizzardClient(db, { clientId: "id", clientSecret: "secret", region: "us", fetchImpl: impl });
  await client.get("/data/wow/item/19019", "forever", "static");
  expect(calls[1]).toBe("https://us.api.blizzard.com/data/wow/item/19019?namespace=static-forever-us&locale=en_US");
});

test("API errors name the path and namespace", async () => {
  const db = openDb(":memory:");
  const impl = (async (url: string | URL | Request) =>
    String(url).startsWith("https://oauth.battle.net")
      ? new Response(JSON.stringify({ access_token: "t", expires_in: 100 }), { status: 200 })
      : new Response("{}", { status: 404 })) as typeof fetch;
  const client = new BlizzardClient(db, { clientId: "id", clientSecret: "s", region: "us", fetchImpl: impl });
  await expect(client.get("/data/wow/item/1", "retail", "static")).rejects.toThrow("HTTP 404: /data/wow/item/1 (static-us)");
});

test("a non-JSON 200 response is not cached", async () => {
  const db = openDb(":memory:");
  let body = "<html>maintenance</html>";
  const impl = (async (url: string | URL | Request) =>
    String(url).startsWith("https://oauth.battle.net")
      ? new Response(JSON.stringify({ access_token: "t", expires_in: 100 }), { status: 200 })
      : new Response(body, { status: 200 })) as typeof fetch;
  const client = new BlizzardClient(db, { clientId: "id", clientSecret: "s", region: "us", fetchImpl: impl });
  await expect(client.get("/data/wow/item/1", "retail", "static")).rejects.toThrow();
  expect(db.prepare("SELECT count(*) AS n FROM api_cache").get()).toEqual({ n: 0 });
  body = JSON.stringify({ id: 1 });
  expect(await client.get("/data/wow/item/1", "retail", "static")).toEqual({ id: 1 });
});

// Blizzard Developer API Terms 2(s): refresh at least every 30 days, keep nothing older, and delete a
// character's data once the API no longer has it.
function scripted() {
  let status = 200;
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.startsWith("https://oauth.battle.net")) return new Response(JSON.stringify({ access_token: "t", expires_in: 1e9 }), { status: 200 });
    calls.push(u);
    return status === 200 ? new Response(JSON.stringify({ at: calls.length }), { status }) : new Response("{}", { status });
  }) as typeof fetch;
  return { calls, impl, set: (s: number) => (status = s) };
}
const DAY = 86_400_000;
const rows = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT count(*) AS n FROM api_cache").get() as { n: number }).n;

test("a cached response never outlives 30 days, whatever TTL the caller asks for", async () => {
  const db = openDb(":memory:");
  const api = scripted();
  let now = Date.parse("2026-11-07T00:00:00Z");
  const client = new BlizzardClient(db, { clientId: "id", clientSecret: "s", region: "eu", fetchImpl: api.impl, now: () => now });
  await client.get("/profile/wow/character/joe-gun", "forever", "profile", 90 * 86_400);
  now += 30 * DAY + 1000;
  await client.get("/profile/wow/character/joe-gun", "forever", "profile", 90 * 86_400);
  expect(api.calls).toHaveLength(2);
});

test("rows fetched more than 30 days ago are deleted on the next request", async () => {
  const db = openDb(":memory:");
  const api = scripted();
  let now = Date.parse("2026-11-07T00:00:00Z");
  const client = new BlizzardClient(db, { clientId: "id", clientSecret: "s", region: "eu", fetchImpl: api.impl, now: () => now });
  await client.get("/profile/wow/character/joe-gun", "forever", "profile");
  now += 31 * DAY;
  await client.get("/data/wow/ruleset/index", "forever", "dynamic");
  expect(db.prepare("SELECT key FROM api_cache").all()).toEqual([
    { key: "https://eu.api.blizzard.com/data/wow/ruleset/index?namespace=dynamic-forever-eu&locale=en_US" },
  ]);
});

test("a 404 deletes the cached copy (a deleted or renamed character is not kept)", async () => {
  const db = openDb(":memory:");
  const api = scripted();
  let now = Date.parse("2026-11-07T00:00:00Z");
  const client = new BlizzardClient(db, { clientId: "id", clientSecret: "s", region: "eu", fetchImpl: api.impl, now: () => now });
  await client.get("/profile/wow/character/joe-gun", "forever", "profile", 3600);
  expect(rows(db)).toBe(1);
  now += 2 * 3600 * 1000;
  api.set(404);
  await expect(client.get("/profile/wow/character/joe-gun", "forever", "profile", 3600)).rejects.toThrow("HTTP 404");
  expect(rows(db)).toBe(0);
});
