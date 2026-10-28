import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CF_CRONS, cronPaths, cronRequest } from "./cf-crons";

const vercel = JSON.parse(readFileSync(join(__dirname, "..", "..", "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };

test("the Worker runs exactly vercel.json's crons, on the same schedules", () => {
  const fromVercel = vercel.crons.map((c) => `${c.schedule} ${c.path}`).sort();
  const fromWorker = Object.entries(CF_CRONS).flatMap(([cron, paths]) => paths.map((p) => `${cron} ${p}`)).sort();
  expect(fromWorker).toEqual(fromVercel);
});

test("a trigger calls its routes with the cron secret, and an unknown schedule runs nothing", () => {
  expect(cronPaths("*/10 * * * *")).toEqual(["/api/cron/snapshot", "/api/cron/blue"]);
  expect(cronPaths("0 0 * * *")).toEqual([]);
  const req = cronRequest("/api/cron/snapshot", "s3cret");
  expect(req.url).toBe("https://everloot.app/api/cron/snapshot");
  expect(req.headers.get("authorization")).toBe("Bearer s3cret");
});
