import { join } from "node:path";
import { expect, test } from "vitest";
import { unstable_readConfig } from "wrangler";
import { CF_CRONS, cronPaths, cronRequest } from "./cf-crons";

test("the Worker's triggers are exactly the schedules this file runs", () => {
  const config = unstable_readConfig({ config: join(__dirname, "..", "..", "wrangler.jsonc") }, {});
  expect([...config.triggers.crons].sort()).toEqual(Object.keys(CF_CRONS).sort());
});

test("a trigger calls its routes with the cron secret, and an unknown schedule runs nothing", () => {
  expect(cronPaths("*/10 * * * *")).toEqual(["/api/cron/snapshot", "/api/cron/blue"]);
  expect(cronPaths("23 * * * *")).toEqual(["/api/cron/indexnow"]);
  expect(cronPaths("0 0 * * *")).toEqual([]);
  const req = cronRequest("/api/cron/snapshot", "s3cret");
  expect(req.url).toBe("https://everloot.app/api/cron/snapshot");
  expect(req.headers.get("authorization")).toBe("Bearer s3cret");
});
