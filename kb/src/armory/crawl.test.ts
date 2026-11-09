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
    touch_failed: { character: 0, guild: 0 },
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
    await expect(
      runCrawl({ region: "eu", budget: 36, store, api, log }),
    ).rejects.toThrow("row failures");
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
    expect(store.purge).toHaveBeenCalled();
  },
);
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
