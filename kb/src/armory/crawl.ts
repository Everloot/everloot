import type { ForeverApi, Region } from "./api.js";
import { parseCharacter, parseGuild, type CharacterRow } from "./parse.js";
import type { CrawlStore, Kind, QueueRow } from "./store.js";

export interface Summary {
  region: Region;
  calls: number;
  guilds: { fetched: number; missing: number; retried: number };
  characters: {
    fetched: number;
    unchanged: number;
    missing: number;
    retried: number;
  };
  enqueued: number;
  purged: number;
}
export async function runCrawl(cfg: {
  region: Region;
  budget: number;
  api: Pick<ForeverApi, "get">;
  store: CrawlStore;
  now?: () => number;
  log?: (line: string) => void;
  dryRun?: boolean;
}): Promise<Summary> {
  if (!Number.isSafeInteger(cfg.budget) || cfg.budget < 0)
    throw Error("budget must be a nonnegative integer");
  const { region, api, store, dryRun } = cfg,
    now = cfg.now ?? Date.now;
  const summary: Summary = {
    region,
    calls: 0,
    guilds: { fetched: 0, missing: 0, retried: 0 },
    characters: { fetched: 0, unchanged: 0, missing: 0, retried: 0 },
    enqueued: 0,
    purged: 0,
  };
  let reserved = 0;
  const starts: number[] = [];
  // One rolling-second start gate is shared by all eight workers.
  let gate = Promise.resolve();
  async function get(path: string, opts?: { ifModifiedSince?: string }) {
    const turn = gate.then(async () => {
      while (true) {
        const time = now();
        while (starts.length && starts[0] <= time - 1000) starts.shift();
        if (starts.length < 50) {
          starts.push(time);
          break;
        }
        await new Promise((r) =>
          setTimeout(r, Math.max(1, starts[0] + 1000 - time)),
        );
      }
      reserved--;
      summary.calls++;
    });
    gate = turn;
    await turn;
    return api.get(path, "profile", opts);
  }
  async function retry(kind: Kind, slug: string) {
    summary[kind === "guild" ? "guilds" : "characters"].retried++;
    if (!dryRun)
      try {
        await store.retry(region, kind, slug, "1 hour");
      } catch {
        cfg.log?.("armory retry write failed");
      }
  }
  async function missing(kind: Kind, slug: string) {
    if (!dryRun) await store.missing(region, kind, slug);
    summary[kind === "guild" ? "guilds" : "characters"].missing++;
  }
  const pending: CharacterRow[] = [];
  async function flush() {
    if (!pending.length) return;
    const rows = pending.splice(0, 100);
    try {
      if (!dryRun) await store.upsertCharacters(region, rows);
      summary.characters.fetched += rows.length;
    } catch {
      for (const row of rows) await retry("character", row.slug);
    }
  }
  async function row(kind: Kind, q: QueueRow, cost: number) {
    let used = 0;
    const read = async (path: string, opts?: { ifModifiedSince?: string }) => {
      used++;
      return get(path, opts);
    };
    try {
      const base =
        kind === "guild"
          ? `/data/wow/guild/${encodeURIComponent(q.slug)}`
          : `/profile/wow/character/${encodeURIComponent(q.slug)}`;
      const stored =
        kind === "character" && q.stored
          ? await store.character(region, q.slug)
          : [];
      const modified = stored[0]?.last_modified;
      const result = await read(
        base,
        modified ? { ifModifiedSince: modified } : undefined,
      );
      if (result.status === 404) {
        await missing(kind, q.slug);
        return;
      }
      if (result.status === 304) {
        if (kind !== "character" || !q.stored) throw Error("unexpected 304");
        if (!dryRun) await store.touch(region, kind, [q.slug]);
        summary.characters.unchanged++;
        return;
      }
      if (kind === "guild") {
        const roster = await read(`${base}/roster`);
        if (roster.status === 404) {
          await missing(kind, q.slug);
          return;
        }
        if (roster.status !== 200) throw Error("unexpected roster status");
        const parsed = parseGuild(
          result.body,
          roster.body,
          result.lastModified,
        );
        if (!dryRun)
          summary.enqueued += await store.upsertGuild(
            region,
            parsed.guild,
            parsed.members,
          );
        summary.guilds.fetched++;
      } else {
        const equipment = await read(`${base}/equipment`);
        if (equipment.status === 404) {
          await missing(kind, q.slug);
          return;
        }
        if (equipment.status !== 200)
          throw Error("unexpected equipment status");
        const pvp = await read(`${base}/pvp-summary`);
        if (pvp.status === 404) {
          await missing(kind, q.slug);
          return;
        }
        if (pvp.status !== 200) throw Error("unexpected pvp status");
        pending.push(
          parseCharacter(
            result.body,
            equipment.body,
            pvp.body,
            result.lastModified,
          ),
        );
        if (pending.length >= 100) await flush();
      }
    } catch {
      await retry(kind, q.slug);
    } finally {
      reserved -= cost - used;
    }
  }
  async function process(kind: Kind, rows: QueueRow[]) {
    let index = 0;
    const cost = kind === "guild" ? 2 : 3;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (index < rows.length) {
          if (summary.calls + reserved + cost > cfg.budget) return;
          const q = rows[index++];
          reserved += cost;
          await row(kind, q, cost);
        }
      }),
    );
  }
  if (!dryRun) summary.enqueued = await store.seedFromPlayers();
  try {
    await process(
      "guild",
      await store.take(region, "guild", Math.floor(cfg.budget / 2)),
    );
    await process(
      "character",
      await store.take(region, "character", cfg.budget - summary.calls),
    );
    await flush();
  } finally {
    if (!dryRun) summary.purged = await store.purge();
  }
  cfg.log?.(JSON.stringify(summary));
  return summary;
}
