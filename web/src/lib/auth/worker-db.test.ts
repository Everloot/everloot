import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ binding: { connectionString: "postgres://hyperdrive/request" } as unknown, pools: [] as Array<{ options: unknown; end: ReturnType<typeof vi.fn> }> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { AUTH_DB_HYPERDRIVE: state.binding } }) }));
vi.mock("pg", async () => ({ Pool: class extends (await import("node:events")).EventEmitter {
  end = vi.fn(async () => {});
  constructor(public options: unknown) { super(); state.pools.push(this); }
} }));
beforeEach(() => { state.pools.length = 0; state.binding = { connectionString: "postgres://hyperdrive/request" }; vi.stubEnv("EVERLOOT_PLATFORM", "cloudflare"); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test("Worker operations own separate pools and close each only after its work finishes", async () => {
  const { withAuthDatabase } = await import("./db");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const first = withAuthDatabase(async (pool) => { await pending; return pool; });
  expect(state.pools).toHaveLength(1);
  expect(state.pools[0].end).not.toHaveBeenCalled();
  const second = await withAuthDatabase(async (pool) => pool);
  expect(state.pools).toHaveLength(2);
  expect(state.pools[1].end).toHaveBeenCalledOnce();
  expect(state.pools[0].end).not.toHaveBeenCalled();
  release();
  expect(await first).not.toBe(second);
  expect(state.pools[0].end).toHaveBeenCalledOnce();
  expect(state.pools[0].options).toMatchObject({ connectionString: "postgres://hyperdrive/request", max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  expect(state.pools[0].options).not.toHaveProperty("ssl");
});

test("Worker errors still close the pool", async () => {
  const { withAuthDatabase } = await import("./db");
  await expect(withAuthDatabase(async () => { throw new Error("query failed"); })).rejects.toThrow("query failed");
  expect(state.pools[0].end).toHaveBeenCalledOnce();
});

test("idle Worker connection errors are handled without logging private connection details", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const { withAuthDatabase } = await import("./db");
  await expect(withAuthDatabase(async (pool) => {
    pool.emit("error", Object.assign(new Error("private database connection details"), { code: "57P01" }));
    return "ok";
  })).resolves.toBe("ok");
  expect(log.mock.calls).toEqual([["Authentication storage connection failed", "57P01"]]);
  expect(state.pools[0].end).toHaveBeenCalledOnce();
  log.mockRestore();
});

test("a Worker without Hyperdrive fails closed instead of using a direct URL or another request's pool", async () => {
  state.binding = undefined;
  vi.stubEnv("AUTH_DATABASE_URL", "postgres://private:password@db.example/postgres");
  const { withAuthDatabase, authPool } = await import("./db");
  await expect(withAuthDatabase(async () => "no")).rejects.toThrow("Authentication storage is not configured");
  expect(authPool).toThrow("Authentication storage is not configured");
  expect(state.pools).toEqual([]);
});
