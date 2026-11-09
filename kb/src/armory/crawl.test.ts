import { it, expect, vi } from "vitest";
import { runCrawl } from "./crawl.js";
import profile from "./fixtures/character.json";
import equipment from "./fixtures/equipment.json";
import pvp from "./fixtures/pvp.json";
import guild from "./fixtures/guild.json";
import roster from "./fixtures/roster.json";
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
      body: (path.endsWith("equipment")
        ? equipment
        : path.endsWith("pvp-summary")
          ? pvp
          : profile) as unknown,
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
    if (status !== 404) throw Error(`HTTP ${status}`);
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
        body: path.endsWith("equipment")
          ? equipment
          : path.endsWith("pvp-summary")
            ? pvp
            : profile,
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
    if (path.includes("vale-0")) throw Error("HTTP 500");
    return {
      status: 200,
      body: path.endsWith("equipment")
        ? equipment
        : path.endsWith("pvp-summary")
          ? pvp
          : profile,
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
