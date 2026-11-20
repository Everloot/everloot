import { join } from "node:path";
import { expect, test } from "vitest";
import { unstable_readConfig } from "wrangler";
import { CF_CRONS, SITE_JOBS, cronPaths, cronRequest, runCrons, type CronEnv } from "./cf-crons";

const read = (file: string) => unstable_readConfig({ config: join(__dirname, "..", "..", file) }, {});
const site = read("wrangler.jsonc");
const cron = read("wrangler.cron.jsonc");

test("both Workers' triggers are exactly the schedules this file runs", () => {
  expect([...site.triggers.crons].sort()).toEqual(Object.keys(CF_CRONS).sort());
  expect([...cron.triggers.crons].sort()).toEqual(Object.keys(CF_CRONS).sort());
});

test("the cron Worker serves no visitor and sends its jobs to itself", () => {
  expect(cron.name).toBe("everloot-cron");
  expect(cron.routes ?? []).toEqual([]);
  expect(cron.route).toBeUndefined();
  expect(cron.workers_dev).toBe(false);
  expect(cron.preview_urls).toBe(false);
  expect(cron.services).toEqual([{ binding: "WORKER_SELF_REFERENCE", service: "everloot-cron" }]);
  expect(site.services).toEqual([{ binding: "WORKER_SELF_REFERENCE", service: "everloot-web" }]);
  // The revalidation queue stays the site's Durable Object: the cron Worker binds to it and declares no class.
  expect(cron.durable_objects.bindings).toEqual(site.durable_objects.bindings.map((b: object) => ({ ...b, script_name: "everloot-web" })));
  expect(cron.migrations).toEqual([]);
  // The cron Worker runs every job but the site's own; "1" would make it run only those.
  expect(cron.vars.EVERLOOT_CRON_WORKER).toBe("cron");
});

test("the cron Worker is the site's build with the site's bindings and vars, apart from the lines that must differ", () => {
  // Path, name, the visitor-facing settings, the self-binding, the Durable Object's owner and the log sampling differ;
  // anything else a change adds to one file (a binding, a var, a release id) must be added to the other.
  const differ = new Set(["configPath", "userConfigPath", "topLevelName", "name", "routes", "workers_dev", "preview_urls", "services", "durable_objects", "migrations", "observability"]);
  const rest = (config: Record<string, unknown>, drop: string[] = []) =>
    Object.fromEntries(Object.entries(config).filter(([key]) => !differ.has(key) && !drop.includes(key)));
  const { EVERLOOT_CRON_WORKER: _switch, ...siteVars } = site.vars as Record<string, unknown>;
  const { EVERLOOT_CRON_WORKER: _role, ...cronVars } = cron.vars as Record<string, unknown>;
  expect(rest(cron as unknown as Record<string, unknown>, ["vars"])).toEqual(rest(site as unknown as Record<string, unknown>, ["vars"]));
  expect(cronVars).toEqual(siteVars);
  expect(cron.observability?.enabled).toBe(true);
});

test("a trigger calls its routes with the cron secret, and an unknown schedule runs nothing", () => {
  expect(cronPaths("*/10 * * * *")).toEqual(["/api/cron/snapshot", "/api/cron/blue"]);
  expect(cronPaths("5,15,25,35,45,55 * * * *")).toEqual(["/api/cron/views"]);
  expect(cronPaths("23 * * * *")).toEqual(["/api/cron/indexnow", "/api/cron/ops"]);
  expect(cronPaths("7,37 * * * *")).toEqual(["/api/cron/profiles"]);
  expect(cronPaths("0 0 * * *")).toEqual([]);
  const req = cronRequest("/api/cron/snapshot", "s3cret");
  expect(req.url).toBe("https://everloot.app/api/cron/snapshot");
  expect(req.headers.get("authorization")).toBe("Bearer s3cret");
});

function worker(vars: Partial<CronEnv>, status = 200) {
  const called: { url: string; auth: string | null }[] = [];
  const env: CronEnv = {
    ...vars,
    WORKER_SELF_REFERENCE: {
      fetch: async (req: Request) => {
        called.push({ url: req.url, auth: req.headers.get("authorization") });
        return new Response("done", { status });
      },
    },
  };
  return { env, called };
}

test("a trigger runs its jobs through the self-binding, and a failed job fails the trigger", async () => {
  const { env, called } = worker({ CRON_SECRET: "s3cret" });
  await expect(runCrons("*/10 * * * *", env)).resolves.toEqual(["/api/cron/snapshot", "/api/cron/blue"]);
  expect(called).toEqual([
    { url: "https://everloot.app/api/cron/snapshot", auth: "Bearer s3cret" },
    { url: "https://everloot.app/api/cron/blue", auth: "Bearer s3cret" },
  ]);
  await expect(runCrons("23 * * * *", worker({ CRON_SECRET: "s3cret" }, 500).env)).rejects.toThrow(/\/api\/cron\/indexnow answered 500/);
  await expect(runCrons("*/10 * * * *", worker({}).env)).rejects.toThrow(/CRON_SECRET is not set/);
});

test("the cron Worker runs every job but the site's own, and the site at 1 runs only its own", async () => {
  const all = Object.keys(CF_CRONS).flatMap(cronPaths);
  const ran = async (role: string) => {
    const paths: string[] = [];
    for (const schedule of Object.keys(CF_CRONS)) paths.push(...await runCrons(schedule, worker({ CRON_SECRET: "s3cret", EVERLOOT_CRON_WORKER: role }).env));
    return paths;
  };
  expect(SITE_JOBS).toEqual(new Set(["/api/cron/ops"]));
  expect(await ran("cron")).toEqual(all.filter((path) => !SITE_JOBS.has(path)));
  expect(await ran("1")).toEqual(["/api/cron/ops"]);
  // Between them every job runs exactly once.
  expect([...await ran("cron"), ...await ran("1")].sort()).toEqual([...all].sort());
  // A trigger with nothing left to run needs no secret, so the site stands down on it with nothing else set.
  await expect(runCrons("*/10 * * * *", worker({ EVERLOOT_CRON_WORKER: "1" }).env)).resolves.toEqual([]);
  // Any other value leaves the jobs running.
  const { env, called } = worker({ CRON_SECRET: "s3cret", EVERLOOT_CRON_WORKER: "0" });
  await runCrons("7,37 * * * *", env);
  expect(called).toHaveLength(1);
});
