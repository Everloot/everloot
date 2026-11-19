/**
 * One value a server instance keeps between requests: the stored files the cron writes (aggregates, map pins,
 * professions, the item view, auction history, the guild ladder) and the knowledge release. Each store used to
 * hand-roll the same `let kept = { at, ... }` block; this is that block once.
 *
 * - `get` returns the kept value while it is fresh, and otherwise reads it again with `load`.
 * - `load` receives the last kept entry (fresh or not), so a store can send its ETag or keep a set it already read,
 *   and says how long its answer stays fresh: `keepMs` defaults to `ttlMs`; a failed read usually asks for less.
 * - `share` (default on) lets callers that arrive during a read wait on that read instead of starting their own.
 *   Off where a Worker would cancel one request's work awaited by another (release.ts says why).
 * - `staleWhileRefresh` (default off) answers with the expired value at once and reads again in the background.
 *
 * A `load` that throws keeps nothing and rethrows; the last entry stays for the next `load` to see. The stores
 * that must never throw catch inside their `load`.
 */

export interface Kept<T> {
  value: T;
  /** When the read that produced it started, by the caller's clock. */
  at: number;
  /** Until when it is fresh (exclusive). */
  until: number;
}

export interface Fresh<T> {
  value: T;
  /** How long this answer stays fresh, from when its read started. Defaults to the keeper's `ttlMs`. */
  keepMs?: number;
}

export interface KeepOptions {
  ttlMs: number;
  share?: boolean;
  staleWhileRefresh?: boolean;
}

export interface Keeper<T, A> {
  /** The kept value while fresh, else a new read. `now` is the caller's clock (tests pass their own). */
  get(arg: A, now?: number): Promise<T>;
  /** The kept entry while fresh, else null; reads nothing. */
  fresh(now?: number): Kept<T> | null;
  /** The last entry kept, fresh or not. */
  last(): Kept<T> | null;
  /** For tests: forget the entry and any read in flight. */
  forget(): void;
}

export function keep<T, A = void>(load: (arg: A, last: Kept<T> | null, now: number) => Promise<Fresh<T>>, opts: KeepOptions): Keeper<T, A> {
  const share = opts.share ?? true;
  let kept: Kept<T> | null = null;
  let pending: Promise<T> | null = null;

  const read = (arg: A, now: number): Promise<T> => {
    const run = load(arg, kept, now).then((fresh) => {
      kept = { value: fresh.value, at: now, until: now + (fresh.keepMs ?? opts.ttlMs) };
      return fresh.value;
    });
    if (!share) return run;
    const shared: Promise<T> = run.finally(() => { if (pending === shared) pending = null; });
    pending = shared;
    return shared;
  };

  return {
    get(arg, now = Date.now()) {
      if (kept && now < kept.until) return Promise.resolve(kept.value);
      if (share && pending) return opts.staleWhileRefresh && kept ? Promise.resolve(kept.value) : pending;
      if (opts.staleWhileRefresh && kept) {
        const stale = kept.value;
        read(arg, now).catch(() => {});
        return Promise.resolve(stale);
      }
      return read(arg, now);
    },
    fresh(now = Date.now()) {
      return kept && now < kept.until ? kept : null;
    },
    last: () => kept,
    forget() { kept = null; pending = null; },
  };
}
