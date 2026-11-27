import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { unstable_readConfig } from "wrangler";
import { cronWorkerVars, missingVars, REQUIRED } from "./stored-views";

test("the job needs the game files: without them every stored item name but the players' reads \"Item N\"", () => {
  const set = Object.fromEntries(REQUIRED.map((key) => [key, "x"]));
  expect(missingVars(set)).toEqual([]);
  expect(missingVars({ ...set, NEXT_PUBLIC_GAME_ASSETS_URL: " " })).toEqual(["NEXT_PUBLIC_GAME_ASSETS_URL"]);
  expect(REQUIRED).toEqual(expect.arrayContaining([
    "NEXT_PUBLIC_GAME_ASSETS_URL", "GAME_DATA_S3_ENDPOINT", "GAME_DATA_BUCKET", "GAME_DATA_ACCESS_KEY_ID", "GAME_DATA_SECRET_ACCESS_KEY",
  ]));
});

test("the workflow passes every variable the job requires", () => {
  const workflow = readFileSync(join(__dirname, "..", "..", ".github", "workflows", "stored-views.yml"), "utf8");
  const passed = new Set([...workflow.matchAll(/^\s+([A-Z][A-Z0-9_]+):\s*\$\{\{/gm)].map((m) => m[1]));
  expect(REQUIRED.filter((key) => !passed.has(key))).toEqual([]);
});

test("the job takes the cron Worker's switches, not its role or its bundle paths, and a variable already set wins", () => {
  const vars = cronWorkerVars({ EVERLOOT_CRON_WORKER: "cron", EVERLOOT_GUILDS: "1", NEWS_DIR: "/bundle/repo/kb/news", EVERLOOT_DATA_GUARD: "1", COUNT: 3 }, { EVERLOOT_DATA_GUARD: "0" });
  expect(vars).toEqual({ EVERLOOT_GUILDS: "1" });
});

test("against the real wrangler.cron.jsonc it carries the switches the stored views read", () => {
  const config = unstable_readConfig({ config: join(__dirname, "..", "wrangler.cron.jsonc") }, {});
  const vars = cronWorkerVars(config.vars as Record<string, unknown>, {});
  expect(vars).toMatchObject({ EVERLOOT_PLATFORM: "cloudflare", EVERLOOT_DATA_GUARD: "1", EVERLOOT_GUILDS: "1", EVERLOOT_PLAYER_PAGES: "1", EVERLOOT_LEADERBOARDS: "1" });
  expect(vars).not.toHaveProperty("EVERLOOT_CRON_WORKER");
  expect(Object.values(vars).some((v) => v.startsWith("/bundle/"))).toBe(false);
});
