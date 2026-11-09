import { it, expect, vi } from "vitest";
import { ApiError } from "./api.js";
import { StoreError } from "./store.js";
import { runCrawl } from "./crawl.js";
import profile from "./fixtures/character.json";
import equipment from "./fixtures/equipment.json";
import pvp from "./fixtures/pvp.json";
import guild from "./fixtures/guild.json";
import roster from "./fixtures/roster.json";
function bodyFor(path: string): unknown {
  if (path.endsWith("equipment")) return equipment;
  if (path.endsWith("pvp-summary")) return pvp;
  return { ...profile, slug: decodeURIComponent(path.split("/").at(-1)!) };
}
function setup(count = 1) {
  const store = {
    seedFromPlayers: vi.fn().mockResolvedValue(2),
    take: vi.fn(async (_r: string, k: string) =>
      k === "guild"
        ? []
        : Array.from({ length: count }, (_, i) => ({
            slug: `ember-vale-${i}`,
            tries: 0,
            stored: true,
          })),
    ),
    character: vi.fn().mockResolvedValue([{ last_modified: "date" }]),
    upsertCharacters: vi.fn(async (_r: string, rows: unknown[]) => rows.length),
    upsertGuild: vi.fn().mockResolvedValue(2),
    touch: vi.fn().mockResolvedValue(1),
    missing: vi.fn(),
    retry: vi.fn(),
    purge: vi.fn().mockResolvedValue(3),
  };
  const api = {
    get: vi.fn(async (path: string, ..._args: unknown[]) => ({
      status: 200 as 200 | 304 | 404,
      body: bodyFor(path),
      lastModified: "new" as string | null,
    })),
  };
  return { store, api };
}
it("stops before partial rows at budget", async () => {
  const { store, api } = setup(20);
  const s = await runCrawl({ region: "eu", budget: 7, store, api });
  expect(s.calls).toBe(6);
  expect(api.get).toHaveBeenCalledTimes(6);
  expect(s.characters.fetched).toBe(2);
});
it("touches 304 using stored last_modified", async () => {
  const { store, api } = setup();
  api.get.mockResolvedValue({ status: 304, body: null, lastModified: null });
  const s = await runCrawl({ region: "eu", budget: 3, store, api });
  expect(s.characters.unchanged).toBe(1);
  expect(store.touch).toHaveBeenCalledWith("eu", "character", ["ember-vale-0"]);
  expect(store.upsertCharacters).not.toHaveBeenCalled();
  expect(api.get.mock.calls[0]).toEqual([
    "/profile/wow/character/ember-vale-0",
    "profile",
    { ifModifiedSince: "date" },
  ]);
});
it.each([404, 429, 500])("isolates guild HTTP %i", async (status) => {
  const { store, api } = setup();
  store.take.mockImplementation(async (_r, k) =>
    k === "guild" ? [{ slug: "copper-owls", tries: 0, stored: false }] : [],
  );
  api.get.mockImplementation(async () => {
    if (status !== 404) throw new ApiError(status, "api");
    return { status: 404, body: null, lastModified: null };
  });
  const s = await runCrawl({ region: "eu", budget: 5, store, api });
  if (status === 404) {
    expect(store.missing).toHaveBeenCalledWith("eu", "guild", "copper-owls");
    expect(s.guilds.missing).toBe(1);
  } else {
    expect(store.retry).toHaveBeenCalledWith(
      "eu",
      "guild",
      "copper-owls",
      "1 hour",
    );
    expect(s.guilds.retried).toBe(1);
  }
});
it("guild summary", async () => {
  const { store, api } = setup(0);
  store.take.mockImplementation(async (_r, k) =>
    k === "guild" ? [{ slug: "copper-owls", tries: 0, stored: false }] : [],
  );
  api.get.mockImplementation(async (path) => ({
    status: 200,
    body: path.endsWith("roster") ? roster : guild,
    lastModified: "date",
  }));
  expect(await runCrawl({ region: "eu", budget: 2, store, api })).toEqual({
    region: "eu",
    calls: 2,
    guilds: { fetched: 1, missing: 0, retried: 0 },
    characters: { fetched: 0, unchanged: 0, missing: 0, retried: 0 },
    skipped: { no_surname: 1, invalid_slug: 0, slug_mismatch: 0 },
    invalid: 0,
    enqueued: 4,
    purged: 3,
  });
});
it("batches 100 and caps rate/concurrency", async () => {
  vi.useFakeTimers();
  try {
    const { store, api } = setup(105);
    const starts: number[] = [];
    let active = 0,
      max = 0;
    api.get.mockImplementation(async (path) => {
      starts.push(Date.now());
      max = Math.max(max, ++active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return {
        status: 200,
        body: bodyFor(path),
        lastModified: "date",
      };
    });
    const pending = runCrawl({ region: "eu", budget: 315, store, api });
    await vi.runAllTimersAsync();
    const s = await pending;
    expect(store.upsertCharacters.mock.calls.map((c) => c[1].length)).toEqual([
      100, 5,
    ]);
    expect(s.characters.fetched).toBe(105);
    expect(
      new Set(
        store.upsertCharacters.mock.calls
          .flatMap((c) => c[1])
          .map((r: any) => r.slug),
      ).size,
    ).toBe(105);
    expect(max).toBeLessThanOrEqual(8);
    for (const start of starts)
      expect(
        starts.filter((t) => t >= start && t < start + 1000).length,
      ).toBeLessThanOrEqual(50);
  } finally {
    vi.useRealTimers();
  }
});
it("dry run writes nothing", async () => {
  const { store, api } = setup();
  await runCrawl({ region: "eu", budget: 3, store, api, dryRun: true });
  for (const k of [
    "seedFromPlayers",
    "upsertCharacters",
    "upsertGuild",
    "touch",
    "missing",
    "retry",
    "purge",
  ] as const)
    expect(store[k]).not.toHaveBeenCalled();
});

it("never sends conditional headers for queued characters", async () => {
  const { store, api } = setup();
  store.take.mockImplementation(async (_r, k) =>
    k === "character" ? [{ slug: "ember-vale", tries: 0, stored: false }] : [],
  );
  await runCrawl({ region: "eu", budget: 3, store, api });
  expect(store.character).not.toHaveBeenCalled();
  expect(api.get.mock.calls[0][2]).toBeUndefined();
});
it("deletes a stored character on equipment 404", async () => {
  const { store, api } = setup();
  api.get.mockImplementation(async (path) => ({
    status: path.endsWith("equipment") ? 404 : 200,
    body: profile,
    lastModified: null,
  }));
  const s = await runCrawl({ region: "eu", budget: 3, store, api });
  expect(store.missing).toHaveBeenCalledWith("eu", "character", "ember-vale-0");
  expect(s.characters.missing).toBe(1);
  expect(store.upsertCharacters).not.toHaveBeenCalled();
});
it("one failed character does not stop other rows", async () => {
  const { store, api } = setup(2);
  api.get.mockImplementation(async (path) => {
    if (path.includes("vale-0")) throw new ApiError(500, "api");
    return {
      status: 200,
      body: bodyFor(path),
      lastModified: null,
    };
  });
  const s = await runCrawl({ region: "eu", budget: 6, store, api });
  expect(s.characters).toEqual({
    fetched: 1,
    unchanged: 0,
    missing: 0,
    retried: 1,
  });
  expect(store.retry).toHaveBeenCalledWith(
    "eu",
    "character",
    "ember-vale-0",
    "1 hour",
  );
  expect(store.purge).toHaveBeenCalled();
});
it("zero budget does no Blizzard reads", async () => {
  const { store, api } = setup();
  expect((await runCrawl({ region: "eu", budget: 0, store, api })).calls).toBe(
    0,
  );
  expect(api.get).not.toHaveBeenCalled();
});

it.each([401, 403, 400])(
  "fails closed on HTTP %i without bumping rows",
  async (status) => {
    const { store, api } = setup(30);
    const log = vi.fn();
    api.get.mockRejectedValue(new ApiError(status, "api"));
    await expect(
      runCrawl({ region: "eu", budget: 90, store, api, log }),
    ).rejects.toThrow();
    expect(store.retry).not.toHaveBeenCalled();
    expect(api.get.mock.calls.length).toBeLessThanOrEqual(8);
    expect(log.mock.calls.flat().join(" ")).toContain(`HTTP ${status}`);
    expect(store.purge).toHaveBeenCalled();
  },
);
it("aborts OAuth and zod errors without retry", async () => {
  for (const body of ["oauth", "schema"]) {
    const { store, api } = setup(10);
    const log = vi.fn();
    if (body === "oauth") api.get.mockRejectedValue(new ApiError(500, "oauth"));
    else
      api.get.mockResolvedValue({ status: 200, body: {}, lastModified: null });
    await expect(
      runCrawl({ region: "eu", budget: 30, store, api, log }),
    ).rejects.toThrow();
    expect(store.retry).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).toMatch(/OAuth|schema/);
  }
});
it("retries a network failure and continues", async () => {
  const { store, api } = setup();
  api.get.mockRejectedValue(new ApiError(null, "api"));
  const s = await runCrawl({ region: "eu", budget: 3, store, api });
  expect(s.characters.retried).toBe(1);
  expect(store.retry).toHaveBeenCalled();
});
it("counts and removes skipped profiles without retry", async () => {
  for (const identity of [
    { surname: null },
    { surname: "" },
    { slug: "invalid--slug" },
  ]) {
    const { store, api } = setup();
    api.get.mockImplementation(async (path) => ({
      status: 200,
      body: path.endsWith("equipment")
        ? equipment
        : path.endsWith("pvp-summary")
          ? pvp
          : { ...profile, ...identity },
      lastModified: null,
    }));
    const s = await runCrawl({ region: "eu", budget: 3, store, api });
    expect(s.skipped.no_surname + s.skipped.invalid_slug).toBe(1);
    expect(store.upsertCharacters).not.toHaveBeenCalled();
    expect(store.retry).not.toHaveBeenCalled();
    expect(store.missing).toHaveBeenCalled();
  }
});
it("isolates a rejected batch and preserves 99 good rows", async () => {
  vi.useFakeTimers();
  try {
    const { store, api } = setup(100);
    store.upsertCharacters.mockImplementation(async (_r, rows: any[]) => {
      if (rows.length > 1 || rows[0].slug === "ember-vale-4")
        throw new StoreError(400);
      return rows.length;
    });
    const pending = runCrawl({ region: "eu", budget: 300, store, api });
    await vi.runAllTimersAsync();
    const s = await pending;
    expect(s.characters.fetched).toBe(99);
    expect(s.invalid).toBe(1);
    expect(store.upsertCharacters.mock.calls).toHaveLength(101);
    expect(store.retry).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("counts mismatches and ages the original queue identity", async () => {
  const { store, api } = setup();
  api.get.mockImplementation(async (path) => ({
    status: 200,
    body: path.endsWith("equipment")
      ? equipment
      : path.endsWith("pvp-summary")
        ? pvp
        : { ...profile, slug: "different-name" },
    lastModified: null,
  }));
  const s = await runCrawl({ region: "eu", budget: 3, store, api });
  expect(s.skipped.slug_mismatch).toBe(1);
  expect(store.missing).toHaveBeenCalledWith("eu", "character", "ember-vale-0");
  expect(store.upsertCharacters).not.toHaveBeenCalled();
});
it("batches unchanged touches", async () => {
  const { store, api } = setup(20);
  api.get.mockResolvedValue({ status: 304, body: null, lastModified: null });
  await runCrawl({ region: "eu", budget: 60, store, api });
  expect(store.touch).toHaveBeenCalledTimes(1);
  expect(store.touch.mock.calls[0][2]).toHaveLength(20);
});
