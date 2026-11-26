import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbReadName, installServerTiming, timeRead, withServerTiming } from "./server-timing";
import { authQuery } from "./supabase/server";
import { forgetPrivateReads, forgetSiteAssets, loadSiteAssets, privateStoreFromEnv } from "./game-assets";

beforeAll(() => installServerTiming(new AsyncLocalStorage()));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const page = (path: string) => new Request(`https://everloot.app${path}`);
const timingOf = (res: Response) => res.headers.get("server-timing") ?? "";

describe("Server-Timing on armory pages", () => {
  it("a character or guild page lists each read by name and the total; other pages get no header", async () => {
    const handler = async () => {
      const done = timeRead("db-armory_character");
      await new Promise((r) => setTimeout(r, 5));
      done();
      return new Response("<html>", { status: 200, headers: { "content-type": "text/html", "cache-control": "private, no-store" } });
    };
    for (const path of ["/armory/us/ar-cc", "/armory/eu/guilds/arkham-house"]) {
      const res = await withServerTiming(page(path), handler);
      expect(timingOf(res)).toMatch(/^db-armory_character;dur=\d+, total;dur=\d+, isolate;dur=\d+;desc="request \d+"$/);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.text()).toBe("<html>");
    }
    for (const path of ["/about", "/armory", "/armory/us/ar-cc/refresh", "/database/items"]) {
      expect((await withServerTiming(page(path), handler)).headers.has("server-timing")).toBe(false);
    }
  });

  it("a read still running when the response starts says so", async () => {
    const res = await withServerTiming(page("/armory/us/x"), async () => { timeRead("r2-shard"); return new Response("ok"); });
    expect(timingOf(res)).toMatch(/^r2-shard;dur=\d+;desc="unfinished", total;dur=\d+, isolate;dur=\d+;desc="request \d+"$/);
  });

  it("says how many requests this isolate has served, every path counted, and how long since its first", async () => {
    const ok = async () => new Response("ok");
    const before = Number(/isolate;dur=\d+;desc="request (\d+)"$/.exec(timingOf(await withServerTiming(page("/armory/us/a"), ok)))?.[1]);
    expect(before).toBeGreaterThan(0);
    await withServerTiming(page("/about"), ok);
    const after = timingOf(await withServerTiming(page("/armory/eu/guilds/b"), ok));
    expect(after).toMatch(new RegExp(`^total;dur=\\d+, isolate;dur=\\d+;desc="request ${before + 2}"$`));
  });

  it("outside a timed request nothing is recorded and nothing throws", () => {
    expect(() => timeRead("db-anything")()).not.toThrow();
  });

  it("names carry the function or table only, never the arguments", () => {
    expect(dbReadName("rpc/armory_character")).toBe("db-armory_character");
    expect(dbReadName("users?select=id,bnet_id&id=eq.secret-id&limit=1")).toBe("db-users");
    expect(dbReadName("sessions?token_hash=eq.abc")).toBe("db-sessions");
  });

  it("authQuery, the private bucket and the asset manifest each time their read", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key-for-tests");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })));
    forgetPrivateReads();
    forgetSiteAssets();
    const store = privateStoreFromEnv({
      GAME_DATA_S3_ENDPOINT: "https://r2.example", GAME_DATA_BUCKET: "b", GAME_DATA_ACCESS_KEY_ID: "id", GAME_DATA_SECRET_ACCESS_KEY: "secret",
    }, fetch)!;
    const res = await withServerTiming(page("/armory/us/ar-cc"), async () => {
      await authQuery("rpc/armory_character", { method: "POST", body: "{}" });
      await store.read("70938/items.json");
      await store.read("70938/items/12.json");
      await loadSiteAssets("https://assets.example/build-1", fetch);
      return new Response("ok");
    });
    expect(timingOf(res)).toMatch(/^db-armory_character;dur=\d+, r2-items;dur=\d+, r2-items;dur=\d+, assets-manifest;dur=\d+, total;dur=\d+, isolate;dur=\d+;desc="request \d+"$/);
  });
});
