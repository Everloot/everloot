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
  guilds: {
    fetched: number;
    unchanged: number;
    missing: number;
    retried: number;
  };
  characters: {
    fetched: number;
    unchanged: number;
    missing: number;
    retried: number;
  };
  skipped: {
    rows: { no_surname: number; invalid_slug: number; slug_mismatch: number };
    members: { no_surname: number; invalid_slug: number };
  };
  invalid: number;
  rejected: number;
  touch_failed: Record<Kind, number>;
  enqueued: number;
  purged: number;
}
const transient = (error: unknown) =>
  (error instanceof ApiError || error instanceof StoreError) && error.transient;
/** Stored rows need an extra armory_character/armory_guild read; a future armory_take last_modified column could remove it. */
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
    guilds: { fetched: 0, unchanged: 0, missing: 0, retried: 0 },
    characters: { fetched: 0, unchanged: 0, missing: 0, retried: 0 },
    skipped: {
      rows: { no_surname: 0, invalid_slug: 0, slug_mismatch: 0 },
      members: { no_surname: 0, invalid_slug: 0 },
    },
    invalid: 0,
    rejected: 0,
    touch_failed: { character: 0, guild: 0 },
    enqueued: 0,
    purged: 0,
  };
  let fatal: Error | undefined;
  let nonTransientFailures = 0;
  const logged = new Set<string>();
  function reason(error: unknown): string {
    return error instanceof ApiError || error instanceof StoreError
      ? error.message
      : error instanceof ZodError || error instanceof SyntaxError
        ? "Armory response schema validation failure"
        : error instanceof URIError
          ? "Armory malformed guild href"
          : "Armory unexpected failure";
  }
  function logError(prefix: string, error: unknown) {
    const message = reason(error);
    if (!logged.has(`${prefix}:${message}`)) {
      logged.add(`${prefix}:${message}`);
      cfg.log?.(`armory ${prefix}: ${message}`);
    }
  }
  function fail(error: unknown) {
    if (error === fatal) return;
    logError("fatal", error);
    fatal ??= new Error(reason(error));
  }
  const authenticationFailure = (error: unknown) =>
    (error instanceof ApiError && error.phase === "oauth") ||
    ((error instanceof ApiError || error instanceof StoreError) &&
      (error.status === 401 || error.status === 403));
  async function defer(
    kind: Kind,
    slug: string,
    error: unknown,
    rejected = false,
  ) {
    // Reserve the failure before awaiting storage, so concurrent workers stop at ten exactly.
    if (fatal || nonTransientFailures >= 10) return;
    nonTransientFailures++;
    if (rejected) summary.rejected++;
    else summary.invalid++;
    logError(rejected ? "storage row rejected" : "row failure", error);
    if (nonTransientFailures === 10) {
      fatal = new Error("Stopped after 10 non-transient row failures");
      cfg.log?.("armory stopped: 10 non-transient row failures");
    }
    if (!dryRun) await store.retry(region, kind, slug, "7 days");
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
    reason: keyof Summary["skipped"]["rows"],
  ) {
    summary.skipped.rows[reason]++;
    // Age out the original queue row without scheduling a transient retry.
    if (!dryRun) await store.missing(region, kind, slug);
  }
  const pending: CharacterRow[] = [];
  const touches: Record<Kind, string[]> = { character: [], guild: [] };
  async function retryRows(rows: CharacterRow[]) {
    for (const row of rows) await retry("character", row.slug);
  }
  async function flush() {
    if (!pending.length) return;
    const rows = pending.splice(0, 100);
    try {
      try {
        if (!dryRun) await store.upsertCharacters(region, rows);
        summary.characters.fetched += rows.length;
        return;
      } catch (error) {
        if (authenticationFailure(error) || !(error instanceof StoreError))
          throw error;
        if (transient(error)) {
          await retryRows(rows);
          return;
        }
      }
      // Split only a row-rejected batch. Stop sending single writes if storage fails.
      for (let index = 0; index < rows.length; index++) {
        if (fatal) break;
        const row = rows[index];
        try {
          if (!dryRun) await store.upsertCharacters(region, [row]);
          summary.characters.fetched++;
        } catch (error) {
          if (authenticationFailure(error)) throw error;
          if (transient(error)) {
            await retryRows(rows.slice(index));
            return;
          }
          await defer("character", row.slug, error, true);
        }
      }
    } catch (error) {
      fail(error);
    }
  }
  async function flushTouches(kind: Kind) {
    if (!touches[kind].length) return;
    const slugs = touches[kind].splice(0, 100);
    try {
      if (!dryRun) await store.touch(region, kind, slugs);
      summary[kind === "guild" ? "guilds" : "characters"].unchanged +=
        slugs.length;
    } catch (error) {
      if (authenticationFailure(error)) throw error;
      summary.touch_failed[kind] += slugs.length;
      logError("touch batch skipped", error);
      // Keep the rows stale for the next run; a batch-level error says nothing about individual rows.
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
      const stored = q.stored
        ? kind === "character"
          ? await store.character(region, q.slug)
          : await store.guild(region, q.slug)
        : [];
      const modified = stored[0]?.last_modified;
      const result = await read(
        kind === "guild" ? `${base}/roster` : base,
        modified ? { ifModifiedSince: modified } : undefined,
      );
      if (result.status === 404) {
        await missing(kind, q.slug);
        return;
      }
      if (result.status === 304) {
        if (!q.stored) throw Error("unexpected 304");
        touches[kind].push(q.slug);
        if (touches[kind].length >= 100) await flushTouches(kind);
        return;
      }
      if (kind === "guild") {
        const guild = await read(base);
        if (guild.status === 404) {
          await missing(kind, q.slug);
          return;
        }
        if (guild.status !== 200) throw Error("unexpected guild status");
        const parsed = parseGuild(guild.body, result.body, result.lastModified);
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
        summary.skipped.members.no_surname += parsed.skipped.no_surname;
        summary.skipped.members.invalid_slug += parsed.skipped.invalid_slug;
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
        // armory_take returns distinct queued identities; the equality check above preserves that.
        pending.push(parsed);
        if (pending.length >= 100) await flush();
      }
    } catch (error) {
      if (error === fatal) return; // A worker cancelled by authentication failure is not a bad row.
      try {
        if (error instanceof SkippedRow) await skip(kind, q.slug, error.reason);
        else if (authenticationFailure(error)) fail(error);
        else if (transient(error)) await retry(kind, q.slug);
        else await defer(kind, q.slug, error, error instanceof StoreError);
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
      await flushTouches("character");
      await flushTouches("guild");
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
  if (summary.invalid + summary.rejected)
    throw Error(
      `${summary.invalid + summary.rejected} armory row failures deferred for 7 days`,
    );
  return summary;
}
