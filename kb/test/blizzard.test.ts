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
