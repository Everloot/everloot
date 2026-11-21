import { join } from "node:path";
import { expect, test } from "vitest";
import { unstable_readConfig } from "wrangler";
import { cronWorkerVars } from "./stored-views";

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
