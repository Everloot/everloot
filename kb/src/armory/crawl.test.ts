import { it, expect, vi } from "vitest";
import { ApiError } from "./api.js";
import { StoreError } from "./store.js";
import { rowFailureLimit, runCrawl } from "./crawl.js";
import type { ProfileDetails } from "./details.js";
import profile from "./fixtures/character.json";
import equipment from "./fixtures/equipment.json";
import pvp from "./fixtures/pvp.json";
import guild from "./fixtures/guild.json";
import roster from "./fixtures/roster.json";
import achievements from "./fixtures/achievements.json";
import reputations from "./fixtures/reputations.json";
import completed from "./fixtures/quests-completed.json";
function bodyFor(path: string): unknown {
  if (path.endsWith("equipment")) return equipment;
  if (path.endsWith("pvp-summary")) return pvp;
  return { ...profile, slug: decodeURIComponent(path.split("/").at(-1)!) };
}
function setup(count = 1) {
  const store = {
    seedFromPlayers: vi.fn().mockResolvedValue(2),
    spiderGuilds: vi.fn().mockResolvedValue(0),
    recordRun: vi.fn().mockResolvedValue(0),
    take: vi.fn(async (_r: string, k: string, _limit?: number) =>
      k === "guild"
        ? []
        : Array.from({ length: count }, (_, i) => ({
            slug: `ember-vale-${i}`,
            tries: 0,
            stored: true,
          })),
    ),
    character: vi.fn().mockResolvedValue([{ last_modified: "date" }]),
    guild: vi.fn().mockResolvedValue([{ last_modified: "roster-date" }]),
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
it("backfills details without a conditional profile read, counting optional calls", async () => {
  const { store, api } = setup();
  api.get.mockImplementation(async (path) => ({ status: 200, lastModified: "new", body: path.endsWith("statistics") ? { health: 843 } : path.endsWith("ember-vale-0") ? { ...bodyFor(path) as object, statistics: { href: "https://eu.api.blizzard.com/profile/wow/character/ember-vale-0/statistics" } } : bodyFor(path) }));
  const s = await runCrawl({ region: "eu", budget: 10, store, api, details: true });
  expect(api.get.mock.calls[0]?.[2]).toBeUndefined();
  expect(s.calls).toBe(4);
  expect(store.upsertCharacters.mock.calls[0]?.[1][0]).toMatchObject({ details: { revision: 1, statistics: { rows: [{ label: "Health", value: 843 }] } } });
});
it.each([403, 500])("optional endpoint HTTP %i preserves the base character and never deletes it", async (status) => {
  const { store, api } = setup();
  api.get.mockImplementation(async (path) => {
    if (path.endsWith("statistics")) throw new ApiError(status, "api");
    return { status: 200, lastModified: "new", body: path.endsWith("ember-vale-0") ? { ...bodyFor(path) as object, statistics: { href: "https://eu.api.blizzard.com/profile/wow/character/ember-vale-0/statistics" } } : bodyFor(path) };
  });
  const s = await runCrawl({ region: "eu", budget: 10, store, api, details: true });
  expect(s.characters.fetched).toBe(1);
  expect(store.missing).not.toHaveBeenCalled();
  expect(store.upsertCharacters.mock.calls[0]?.[1][0]).toMatchObject({ details: { revision: 1, ...(status === 500 ? { retry: true } : {}) } });
});
const progressLinks = (slug: string) => Object.fromEntries(["achievements", "reputations", "quests"].map((key) =>
  [key, { href: `https://eu.api.blizzard.com/profile/wow/character/${slug}/${key}?namespace=profile-forever-eu` }]));
function progressApi(api: ReturnType<typeof setup>["api"], failing?: string) {
  api.get.mockImplementation(async (path) => {
    if (failing && path.endsWith(failing)) throw new ApiError(500, "api");
    const body = path.endsWith("/achievements") ? achievements : path.endsWith("/reputations") ? reputations
      : path.endsWith("/quests/completed") ? completed
      : path.endsWith("ember-vale-0") ? { ...bodyFor(path) as object, ...progressLinks("ember-vale-0") } : bodyFor(path);
    return { status: 200, lastModified: "new", body };
  });
}
it("reads achievements, reputations and completed quests from advertised links", async () => {
  const { store, api } = setup();
  progressApi(api);
  const s = await runCrawl({ region: "eu", budget: 10, store, api, details: true });
  expect(s.calls).toBe(6);
  expect(api.get.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([
    "/profile/wow/character/ember-vale-0/achievements",
    "/profile/wow/character/ember-vale-0/reputations",
    "/profile/wow/character/ember-vale-0/quests/completed",
  ]));
  expect(api.get.mock.calls.map((c) => c[0])).not.toContain("/profile/wow/character/ember-vale-0/quests");
  const details = (store.upsertCharacters.mock.calls[0]?.[1][0] as { details: ProfileDetails }).details;
  expect(details.achievements?.rows.map((r) => r.id)).toEqual([6, 7]);
  expect(details.reputations?.rows[0]).toEqual({ id: 530, name: "Darkspear Trolls", standing: "Friendly", tier: 4 });
  expect(details.quests?.completed).toEqual([788, 789, 804, 805, 817]);
});
it("a stored character without progress is read in full, not answered with a 304", async () => {
  const { store, api } = setup();
  const asOf = new Date().toISOString();
  store.character.mockResolvedValue([{ last_modified: "date", details: { revision: 1, statistics: { asOf, rows: [] } } }]);
  progressApi(api);
  await runCrawl({ region: "eu", budget: 10, store, api, details: true });
  expect(api.get.mock.calls[0]?.[2]).toBeUndefined();
  store.character.mockResolvedValue([{ last_modified: "date", details: { revision: 1, quests: { asOf, completed: [1] } } }]);
  api.get.mockClear();
  await runCrawl({ region: "eu", budget: 10, store, api, details: true });
  expect(api.get.mock.calls[0]?.[2]).toEqual({ ifModifiedSince: "date" });
});
it("keeps a recent progress section when its endpoint fails, and drops one older than 30 days", async () => {
  for (const [days, kept] of [[2, true], [31, false]] as const) {
    const { store, api } = setup();
    const asOf = new Date(Date.now() - days * 86_400_000).toISOString();
    store.character.mockResolvedValue([{ last_modified: "date", details: { revision: 1, retry: true, quests: { asOf, completed: [42] } } }]);
    progressApi(api, "/quests/completed");
    await runCrawl({ region: "eu", budget: 10, store, api, details: true });
    const details = (store.upsertCharacters.mock.calls[0]?.[1][0] as { details: ProfileDetails }).details;
    expect(details.retry).toBe(true);
    expect(details.achievements?.rows).toHaveLength(2);
    expect(details.quests).toEqual(kept ? { asOf, completed: [42] } : undefined);
  }
});
it("detail mode reserves the entire maximum before starting a character", async () => {
  const { store, api } = setup();
  await runCrawl({ region: "eu", budget: 9, store, api, details: true });
  expect(api.get).not.toHaveBeenCalled();
});
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
    guilds: { fetched: 1, unchanged: 0, missing: 0, retried: 0 },
    characters: { fetched: 0, unchanged: 0, missing: 0, retried: 0 },
    skipped: {
      rows: { no_surname: 0, invalid_slug: 0, slug_mismatch: 0 },
      members: { no_surname: 1, invalid_slug: 0 },
    },
    invalid: 0,
    rejected: 0,
    failures: {},
    touch_failed: { character: 0, guild: 0 },
    enqueued: 4,
    purged: 3,
    zero_runs: 0,
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
    "spiderGuilds",
    "recordRun",
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

it.each([401, 403])(
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
it("aborts OAuth without retry", async () => {
  const { store, api } = setup(10);
  api.get.mockRejectedValue(new ApiError(500, "oauth"));
  await expect(
    runCrawl({ region: "eu", budget: 30, store, api }),
  ).rejects.toThrow("OAuth");
  expect(store.retry).not.toHaveBeenCalled();
  expect(api.get.mock.calls.length).toBeLessThanOrEqual(8);
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
    expect(s.skipped.rows.no_surname + s.skipped.rows.invalid_slug).toBe(1);
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
    const log = vi.fn();
    const pending = runCrawl({ region: "eu", budget: 300, store, api, log });
    const rejection = expect(pending).rejects.toThrow("row failures");
    await vi.runAllTimersAsync();
    await rejection;
    const s = JSON.parse(log.mock.calls.at(-1)![0]);
    expect(s.characters.fetched).toBe(99);
    expect(s.rejected).toBe(1);
    expect(store.upsertCharacters.mock.calls).toHaveLength(101);
    expect(store.retry).toHaveBeenCalledWith(
      "eu",
      "character",
      "ember-vale-4",
      "7 days",
    );
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
  expect(s.skipped.rows.slug_mismatch).toBe(1);
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

it.each(["schema", "href", 400, 410])(
  "ages out row failure %s and still processes later rows",
  async (failure) => {
    const { store, api } = setup(12);
    const log = vi.fn();
    api.get.mockImplementation(async (path) => {
      if (path.includes("vale-0")) {
        if (typeof failure === "number") throw new ApiError(failure, "api");
        if (failure === "schema" && path.endsWith("pvp-summary"))
          return { status: 200, body: {}, lastModified: null };
        if (
          failure === "href" &&
          !path.endsWith("equipment") &&
          !path.endsWith("pvp-summary")
        )
          return {
            status: 200,
            body: {
              ...profile,
              guild: {
                ...profile.guild,
                key: { href: "https://example.test/guild/%broken" },
              },
            },
            lastModified: null,
          };
      }
      return { status: 200, body: bodyFor(path), lastModified: "date" };
    });
    // One bad row among twelve is under the alert line: deferred, warned about, and the job succeeds.
    await expect(
      runCrawl({ region: "eu", budget: 36, store, api, log }),
    ).resolves.toMatchObject({ invalid: 1 });
    expect(store.retry).toHaveBeenCalledWith(
      "eu",
      "character",
      "ember-vale-0",
      "7 days",
    );
    expect(store.retry).toHaveBeenCalledTimes(1);
    const summary = JSON.parse(log.mock.calls.at(-1)![0]);
    expect(summary.invalid).toBe(1);
    expect(summary.rejected).toBe(0);
    expect(summary.characters.fetched).toBe(11);
    expect(summary.characters.fetched + summary.invalid).toBe(12);
    expect(Object.values(summary.failures)).toEqual([1]);
    const warning = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("::warning::"));
    expect(warning).toContain("1 of 12 rows deferred for 7 days, under the alert line of 3");
    // The log names the failure, never the character.
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("ember-vale");
    expect(store.purge).toHaveBeenCalled();
  },
);

it("names the field a schema failure broke, with indices folded, and no value", async () => {
  const { store, api } = setup(1);
  const log = vi.fn();
  api.get.mockImplementation(async (path) => ({
    status: 200,
    body: path.endsWith("pvp-summary") ? { honorable_kills: "Ember Vale" } : bodyFor(path),
    lastModified: null,
  }));
  const s = await runCrawl({ region: "eu", budget: 3, store, api, log });
  expect(Object.keys(s.failures)).toEqual([
    "row failure: Armory response schema validation failure at honorable_kills (invalid_type)",
  ]);
  expect(log.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("Ember Vale");
});

it("fails the job at the alert line: three bad rows, or 1% of the rows read", async () => {
  expect(rowFailureLimit(12)).toBe(3);
  expect(rowFailureLimit(1000)).toBe(10);
  const { store, api } = setup(12);
  const log = vi.fn();
  api.get.mockImplementation(async (path) => {
    if (/vale-[012]\//.test(path + "/") && path.endsWith("pvp-summary"))
      return { status: 200, body: {}, lastModified: null };
    return { status: 200, body: bodyFor(path), lastModified: null };
  });
  await expect(runCrawl({ region: "eu", budget: 36, store, api, log })).rejects.toThrow(
    "3 armory row failures deferred for 7 days",
  );
  expect(log.mock.calls.some((c) => String(c[0]).startsWith("::warning::"))).toBe(false);
  expect(JSON.parse(log.mock.calls.at(-1)![0]).invalid).toBe(3);
});
it("reads stored guild rosters conditionally and touches on 304 without guild GET", async () => {
  const { store, api } = setup(0);
  store.take.mockImplementation(async (_r, k) =>
    k === "guild" ? [{ slug: "copper-owls", tries: 0, stored: true }] : [],
  );
  api.get.mockResolvedValue({ status: 304, body: null, lastModified: null });
  const summary = await runCrawl({ region: "eu", budget: 2, store, api });
  expect(store.guild).toHaveBeenCalledWith("eu", "copper-owls");
  expect(api.get.mock.calls).toEqual([
    [
      "/data/wow/guild/copper-owls/roster",
      "profile",
      { ifModifiedSince: "roster-date" },
    ],
  ]);
  expect(store.touch).toHaveBeenCalledWith("eu", "guild", ["copper-owls"]);
  expect(store.upsertGuild).not.toHaveBeenCalled();
  expect(summary.guilds.unchanged).toBe(1);
});
it("stores the roster last-modified after a changed roster then guild GET", async () => {
  const { store, api } = setup(0);
  store.take.mockImplementation(async (_r, k) =>
    k === "guild" ? [{ slug: "copper-owls", tries: 0, stored: true }] : [],
  );
  api.get.mockImplementation(async (path) => ({
    status: 200,
    body: path.endsWith("roster") ? roster : guild,
    lastModified: path.endsWith("roster") ? "new-roster" : "guild-date",
  }));
  await runCrawl({ region: "eu", budget: 2, store, api });
  expect(api.get.mock.calls.map((c) => c[0])).toEqual([
    "/data/wow/guild/copper-owls/roster",
    "/data/wow/guild/copper-owls",
  ]);
  expect(store.upsertGuild.mock.calls[0][1].last_modified).toBe("new-roster");
});
it("does not count roster skips when the guild identity is discarded", async () => {
  const { store, api } = setup(0);
  store.take.mockImplementation(async (_r, k) =>
    k === "guild" ? [{ slug: "wrong-guess", tries: 0, stored: false }] : [],
  );
  api.get.mockImplementation(async (path) => ({
    status: 200,
    body: path.endsWith("roster") ? roster : guild,
    lastModified: null,
  }));
  const s = await runCrawl({ region: "eu", budget: 2, store, api });
  expect(s.skipped.rows.slug_mismatch).toBe(1);
  expect(s.skipped.members).toEqual({ no_surname: 0, invalid_slug: 0 });
});
it("stops single-row fallback at the first transient storage error", async () => {
  const { store, api } = setup(10);
  store.upsertCharacters
    .mockRejectedValueOnce(new StoreError(400))
    .mockRejectedValueOnce(new StoreError(503));
  const s = await runCrawl({ region: "eu", budget: 30, store, api });
  expect(store.upsertCharacters).toHaveBeenCalledTimes(2);
  expect(store.retry).toHaveBeenCalledTimes(10);
  expect(s.characters.retried).toBe(10);
  expect(s.characters.fetched).toBe(0);
});
it("does not start fallback writes for a transient batch failure", async () => {
  const { store, api } = setup(10);
  store.upsertCharacters.mockRejectedValue(new StoreError(null));
  const s = await runCrawl({ region: "eu", budget: 30, store, api });
  expect(store.upsertCharacters).toHaveBeenCalledTimes(1);
  expect(store.retry).toHaveBeenCalledTimes(10);
  expect(s.characters.retried).toBe(10);
});

it("reads a queued guild roster without a stored lookup or conditional header", async () => {
  const { store, api } = setup(0);
  store.take.mockImplementation(async (_r, k) =>
    k === "guild" ? [{ slug: "copper-owls", tries: 0, stored: false }] : [],
  );
  api.get.mockImplementation(async (path) => ({
    status: 200,
    body: path.endsWith("roster") ? roster : guild,
    lastModified: "roster-date",
  }));
  const s = await runCrawl({ region: "eu", budget: 2, store, api });
  expect(store.guild).not.toHaveBeenCalled();
  expect(api.get.mock.calls[0]).toEqual([
    "/data/wow/guild/copper-owls/roster",
    "profile",
    undefined,
  ]);
  expect(
    s.guilds.fetched +
      s.guilds.unchanged +
      s.guilds.missing +
      s.guilds.retried +
      s.invalid +
      s.rejected +
      Object.values(s.skipped.rows).reduce((a, b) => a + b, 0),
  ).toBe(1);
  expect(s.skipped.members.no_surname).toBe(1);
});
it("deletes a stored guild on roster 404 without fetching guild details", async () => {
  const { store, api } = setup(0);
  store.take.mockImplementation(async (_r, k) =>
    k === "guild" ? [{ slug: "copper-owls", tries: 0, stored: true }] : [],
  );
  api.get.mockResolvedValue({ status: 404, body: null, lastModified: null });
  const s = await runCrawl({ region: "eu", budget: 2, store, api });
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(store.missing).toHaveBeenCalledWith("eu", "guild", "copper-owls");
  expect(s.guilds.missing).toBe(1);
});
it("stops fallback and the run if deferring an outage also fails", async () => {
  const { store, api } = setup(10);
  store.upsertCharacters
    .mockRejectedValueOnce(new StoreError(400))
    .mockRejectedValueOnce(new StoreError(null));
  store.retry.mockRejectedValue(new StoreError(null));
  await expect(
    runCrawl({ region: "eu", budget: 30, store, api }),
  ).rejects.toThrow("network failure");
  expect(store.upsertCharacters).toHaveBeenCalledTimes(2);
  expect(store.retry).toHaveBeenCalledTimes(1);
  expect(store.purge).toHaveBeenCalled();
});

it("stops after ten non-transient row failures without deferring in-flight rows", async () => {
  const { store, api } = setup(40);
  const log = vi.fn();
  api.get.mockRejectedValue(new ApiError(400, "api"));
  await expect(
    runCrawl({ region: "eu", budget: 120, store, api, log }),
  ).rejects.toThrow("10 non-transient row failures");
  expect(store.retry).toHaveBeenCalledTimes(10);
  expect(store.retry.mock.calls.every((c) => c[3] === "7 days")).toBe(true);
  expect(api.get.mock.calls.length).toBeLessThanOrEqual(17);
  expect(store.purge).toHaveBeenCalled();
  expect(log.mock.calls.flat().join(" ")).toContain(
    "10 non-transient row failures",
  );
  const s = JSON.parse(log.mock.calls.at(-1)![0]);
  expect(s.invalid).toBe(10);
});
it("stops a rejected-batch fallback after ten failures, leaving the rest untouched", async () => {
  vi.useFakeTimers();
  try {
    const { store, api } = setup(100);
    const log = vi.fn();
    store.upsertCharacters.mockRejectedValue(new StoreError(400));
    const pending = runCrawl({ region: "eu", budget: 300, store, api, log });
    const rejection = expect(pending).rejects.toThrow(
      "10 non-transient row failures",
    );
    await vi.runAllTimersAsync();
    await rejection;
    expect(store.upsertCharacters).toHaveBeenCalledTimes(11);
    expect(store.retry).toHaveBeenCalledTimes(10);
    const s = JSON.parse(log.mock.calls.at(-1)![0]);
    expect(s.rejected).toBe(10);
    expect(store.purge).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it.each(["character", "guild"] as const)(
  "fails at the end for a rejected %s touch batch without deferring or deleting rows",
  async (kind) => {
    const { store, api } = setup(kind === "character" ? 20 : 0);
    if (kind === "guild")
      store.take.mockImplementation(async (_r, k) =>
        k === "guild" ? [{ slug: "copper-owls", tries: 0, stored: true }] : [],
      );
    const log = vi.fn();
    api.get.mockResolvedValue({ status: 304, body: null, lastModified: null });
    store.touch.mockRejectedValue(new StoreError(400));
    await expect(
      runCrawl({ region: "eu", budget: 60, store, api, log }),
    ).rejects.toThrow("touch updates failed");
    const s = JSON.parse(log.mock.calls.at(-1)![0]);
    expect(store.retry).not.toHaveBeenCalled();
    expect(store.missing).not.toHaveBeenCalled();
    expect(s[kind === "guild" ? "guilds" : "characters"].unchanged).toBe(0);
    expect(s.invalid + s.rejected).toBe(0);
    expect(s.touch_failed[kind]).toBe(kind === "guild" ? 1 : 20);
    expect(log.mock.calls.flat().join(" ")).toContain("touch batch skipped");
    expect(store.purge).toHaveBeenCalled();
  },
);

it("reserves each bad-row count before awaiting slow retry storage", async () => {
  vi.useFakeTimers();
  try {
    const { store, api } = setup(40);
    const log = vi.fn();
    let completed = 0;
    api.get.mockRejectedValue(new ApiError(400, "api"));
    store.retry.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      completed++;
    });
    const pending = runCrawl({ region: "eu", budget: 120, store, api, log });
    const rejection = expect(pending).rejects.toThrow(
      "10 non-transient row failures",
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(store.retry).toHaveBeenCalledTimes(8);
    expect(completed).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(store.retry).toHaveBeenCalledTimes(10);
    expect(completed).toBe(8);
    expect(log.mock.calls.flat().join(" ")).toContain(
      "10 non-transient row failures",
    );
    await vi.runAllTimersAsync();
    await rejection;
    expect(store.retry).toHaveBeenCalledTimes(10);
    expect(completed).toBe(10);
    expect(store.retry.mock.calls.every((c) => c[3] === "7 days")).toBe(true);
    expect(JSON.parse(log.mock.calls.at(-1)![0]).invalid).toBe(10);
    expect(store.purge).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("spiders guilds, then reads each roster and queues its members", async () => {
  const { store, api } = setup(0);
  store.spiderGuilds.mockResolvedValue(3);
  store.take.mockImplementation(async (_r, k) =>
    k === "guild" ? [{ slug: "copper-owls", tries: 0, stored: false }] : [],
  );
  api.get.mockImplementation(async (path) => ({
    status: 200,
    body: path.endsWith("roster") ? roster : guild,
    lastModified: "date",
  }));
  const s = await runCrawl({ region: "eu", budget: 80, store, api });
  expect(store.spiderGuilds).toHaveBeenCalledWith("eu", 10);
  expect(store.take).toHaveBeenCalledWith("eu", "guild", 10);
  const [, , members] = store.upsertGuild.mock.calls[0]!;
  expect(members.map((m: { character_slug: string }) => m.character_slug)).toEqual(["ember-vale", "willow-stone"]);
  // 2 from the players table, 3 spidered guilds, 2 roster members.
  expect(s.enqueued).toBe(7);
});
it("guild rosters get at most a quarter of the budget, characters the rest", async () => {
  const { store, api } = setup(100);
  store.take.mockImplementation(async (_r, k, limit = 0) =>
    k === "guild"
      ? Array.from({ length: limit }, (_, i) => ({ slug: `guild-${i}`, tries: 0, stored: false }))
      : Array.from({ length: limit }, (_, i) => ({ slug: `ember-vale-${i}`, tries: 0, stored: false })),
  );
  api.get.mockImplementation(async (path) => ({
    status: 200,
    body: path.endsWith("roster") ? roster : path.includes("/data/wow/guild/") ? { ...guild, name: decodeURIComponent(path.split("/").at(-1)!) } : bodyFor(path),
    lastModified: "date",
  }));
  const s = await runCrawl({ region: "eu", budget: 40, store, api });
  const guildCalls = api.get.mock.calls.filter((c) => c[0].startsWith("/data/wow/guild/")).length;
  expect(store.take).toHaveBeenCalledWith("eu", "guild", 5);
  expect(guildCalls).toBe(10);
  expect(store.take).toHaveBeenCalledWith("eu", "character", 30);
  expect(s.calls).toBeLessThanOrEqual(40);
  expect(s.characters.fetched).toBe(10);
});
it("counts zero-call runs and fails on the sixth in a row", async () => {
  for (const [streak, fails] of [[5, false], [6, true]] as const) {
    const { store, api } = setup(0);
    store.recordRun.mockResolvedValue(streak);
    const run = runCrawl({ region: "us", budget: 12_000, store, api });
    if (fails) await expect(run).rejects.toThrow(/no Blizzard calls for 6 runs in a row/);
    else expect((await run).zero_runs).toBe(5);
    expect(store.recordRun).toHaveBeenCalledWith("us", 0);
  }
});
it("records the call count of a run that read something", async () => {
  const { store, api } = setup(1);
  const s = await runCrawl({ region: "eu", budget: 3, store, api });
  expect(store.recordRun).toHaveBeenCalledWith("eu", 3);
  expect(s.zero_runs).toBe(0);
});
it("still crawls without the discovery migration, then fails naming it", async () => {
  const { store, api } = setup(1);
  store.spiderGuilds.mockRejectedValue(new StoreError(404));
  await expect(runCrawl({ region: "eu", budget: 3, store, api })).rejects.toThrow(/20261117160000_armory_discovery\.sql/);
  expect(store.upsertCharacters).toHaveBeenCalledTimes(1);
  expect(store.recordRun).not.toHaveBeenCalled();
});
