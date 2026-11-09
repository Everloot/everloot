import { ApiError, type ForeverApi, type Region } from "./api.js";
import { ZodError } from "zod";
import {
  parseCharacter,
  parseGuild,
  SkippedRow,
  type CharacterRow,
} from "./parse.js";
import {
  StoreError,
  type CrawlStore,
  type Kind,
  type QueueRow,
} from "./store.js";

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
  skipped: { no_surname: number; invalid_slug: number; slug_mismatch: number };
  invalid: number;
  enqueued: number;
  purged: number;
}
const transient = (error: unknown) =>
  (error instanceof ApiError || error instanceof StoreError) && error.transient;
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
    skipped: { no_surname: 0, invalid_slug: 0, slug_mismatch: 0 },
    invalid: 0,
    enqueued: 0,
    purged: 0,
  };
  let fatal: Error | undefined;
  const logged = new Set<string>();
  function fail(error: unknown) {
    if (error === fatal) return;
    const reason =
      error instanceof ApiError || error instanceof StoreError
        ? error.message
        : error instanceof ZodError || error instanceof SyntaxError
          ? "Armory response schema validation failure"
          : "Armory unexpected failure";
    if (error instanceof ZodError || error instanceof SyntaxError)
      summary.invalid++;
    if (!logged.has(reason)) {
      logged.add(reason);
      cfg.log?.(`armory fatal: ${reason}`);
    }
    fatal ??= new Error(reason);
  }
  let reserved = 0;
  const starts: number[] = [];
  let gate = Promise.resolve();
  async function get(path: string, opts?: { ifModifiedSince?: string }) {
    const turn = gate.then(async () => {
      while (!fatal) {
        const time = now();
        while (starts.length && starts[0] <= time - 1000) starts.shift();
        if (starts.length < 50) {
          starts.push(time);
          reserved--;
          summary.calls++;
          return;
        }
        await new Promise((r) =>
          setTimeout(r, Math.max(1, starts[0] + 1000 - time)),
        );
      }
    });
    gate = turn;
    await turn;
    if (fatal) throw fatal;
    return api.get(path, "profile", opts);
  }
  async function retry(kind: Kind, slug: string) {
    if (!dryRun) await store.retry(region, kind, slug, "1 hour");
    summary[kind === "guild" ? "guilds" : "characters"].retried++;
  }
  async function missing(kind: Kind, slug: string) {
    if (!dryRun) await store.missing(region, kind, slug);
    summary[kind === "guild" ? "guilds" : "characters"].missing++;
  }
  async function skip(
    kind: Kind,
    slug: string,
    reason: keyof Summary["skipped"],
  ) {
    summary.skipped[reason]++;
    // Age out the original queue row without scheduling a transient retry.
    if (!dryRun) await store.missing(region, kind, slug);
  }
  const seen = new Set<string>();
  const pending: CharacterRow[] = [],
    touches: string[] = [];
  async function flush() {
    if (!pending.length) return;
    const rows = pending.splice(0, 100);
    try {
      if (!dryRun) await store.upsertCharacters(region, rows);
      summary.characters.fetched += rows.length;
    } catch (error) {
      if (
        !(error instanceof StoreError) ||
        error.status === 401 ||
        error.status === 403
      )
        throw error;
      // A rejected batch must not discard otherwise valid rows.
      for (const row of rows) {
        try {
          if (!dryRun) await store.upsertCharacters(region, [row]);
          summary.characters.fetched++;
        } catch (single) {
          if (transient(single)) await retry("character", row.slug);
          else if (
            single instanceof StoreError &&
            (single.status === 400 || single.status === 422)
          ) {
            summary.invalid++;
            if (!dryRun) await store.missing(region, "character", row.slug);
            if (!logged.has("row constraint")) {
              logged.add("row constraint");
              cfg.log?.("armory skipped: row constraint failure");
            }
          } else throw single;
        }
      }
    }
  }
  async function flushTouches() {
    if (!touches.length) return;
    const slugs = touches.splice(0, 100);
    try {
      if (!dryRun) await store.touch(region, "character", slugs);
      summary.characters.unchanged += slugs.length;
    } catch (error) {
      if (!transient(error)) throw error;
      for (const slug of slugs) await retry("character", slug);
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
        touches.push(q.slug);
        if (touches.length >= 100) await flushTouches();
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
        summary.skipped.no_surname += parsed.skipped.no_surname;
        summary.skipped.invalid_slug += parsed.skipped.invalid_slug;
        if (parsed.guild.slug !== q.slug) {
          await skip(kind, q.slug, "slug_mismatch");
          return;
        }
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
        const parsed = parseCharacter(
          result.body,
          equipment.body,
          pvp.body,
          result.lastModified,
          q.slug,
        );
        if (parsed.slug !== q.slug) {
          await skip(kind, q.slug, "slug_mismatch");
          return;
        }
        if (!seen.has(parsed.slug)) {
          seen.add(parsed.slug);
          pending.push(parsed);
        }
        if (pending.length >= 100) await flush();
      }
    } catch (error) {
      try {
        if (error instanceof SkippedRow) await skip(kind, q.slug, error.reason);
        else if (transient(error)) await retry(kind, q.slug);
        else fail(error);
      } catch (storeError) {
        fail(storeError);
      }
    } finally {
      reserved -= cost - used;
    }
  }
  async function process(kind: Kind, rows: QueueRow[]) {
    let index = 0;
    const cost = kind === "guild" ? 2 : 3;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (!fatal && index < rows.length) {
          if (summary.calls + reserved + cost > cfg.budget) return;
          const q = rows[index++];
          reserved += cost;
          await row(kind, q, cost);
        }
      }),
    );
  }
  try {
    if (!dryRun) summary.enqueued = await store.seedFromPlayers();
    await process(
      "guild",
      await store.take(region, "guild", Math.floor(cfg.budget / 2)),
    );
    if (!fatal)
      await process(
        "character",
        await store.take(region, "character", cfg.budget - summary.calls),
      );
  } catch (error) {
    fail(error);
  } finally {
    try {
      await flush();
    } catch (error) {
      fail(error);
    }
    try {
      await flushTouches();
    } catch (error) {
      fail(error);
    }
    try {
      if (!dryRun) summary.purged = await store.purge();
    } catch (error) {
      fail(error);
    }
  }
  cfg.log?.(JSON.stringify(summary));
  if (fatal) throw fatal;
  return summary;
}
