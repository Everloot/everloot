/**
 * A `Server-Timing` header on the armory character and guild pages: how long each storage read took while the page
 * was drawn, so the live page's time can be read from a browser's network panel. Names only (the database function,
 * table or file kind), never arguments, slugs or data.
 *
 * The Worker entry (scripts/cf-entry.mjs) installs one AsyncLocalStorage and runs those pages inside it; the reads
 * (authQuery, the private bucket, the asset manifest) call `timeRead`. The store sits on globalThis because the entry
 * and the Next server code are bundled apart, so each holds its own copy of this module. Outside a timed request,
 * `timeRead` does nothing, and this file imports nothing Node-only, so client code can import a module that times.
 */

interface Entry { name: string; start: number; end: number | null }
interface Timings { start: number; entries: Entry[] }
interface Storage { run<R>(store: Timings, fn: () => R): R; getStore(): Timings | undefined }

const KEY = Symbol.for("everloot.server-timing");
const MAX_ENTRIES = 40;
const slot = globalThis as { [KEY]?: Storage };

/** The entry calls this once with a `new AsyncLocalStorage()`. */
export function installServerTiming(storage: Storage): void {
  slot[KEY] = storage;
}

/** Character pages (`/armory/us/<slug>`) and guild pages (`/armory/us/guilds/<slug>`), nothing below them. */
const TIMED_PATH = /^\/armory\/[a-z]{2}\/(?:guilds\/)?[^/]+$/;

/** A Server-Timing name is a token: letters, digits, `-` and `_`, here at most 48 of them. */
const token = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 48) || "read";

/**
 * The name for a PostgREST path: `db-<function>` for `rpc/<function>`, `db-<table>` for a table; the query string,
 * which holds the arguments, is dropped.
 */
export function dbReadName(path: string): string {
  const bare = path.split("?")[0];
  return `db-${token(bare.startsWith("rpc/") ? bare.slice(4) : bare)}`;
}

/** Starts timing a read; call the returned function when it is done. Outside a timed request it records nothing. */
export function timeRead(name: string): () => void {
  const timings = slot[KEY]?.getStore();
  if (!timings) return () => {};
  if (timings.entries.length >= MAX_ENTRIES) return () => {};
  const entry: Entry = { name: token(name), start: performance.now(), end: null };
  timings.entries.push(entry);
  return () => { entry.end ??= performance.now(); };
}

/** The header value: each read in the order it started, then the whole request so far as `total`. */
export function serverTimingHeader(timings: Timings, now: number): string {
  const ms = (n: number) => Math.max(0, Math.round(n));
  const reads = timings.entries.map((e) => `${e.name};dur=${ms((e.end ?? now) - e.start)}${e.end === null ? ';desc="unfinished"' : ""}`);
  return [...reads, `total;dur=${ms(now - timings.start)}`].join(", ");
}

/**
 * Runs `handler` for the request; on an armory character or guild page, with its reads timed and the header added
 * to the response. Reads still running when the response starts (a section that streams in later) say "unfinished".
 */
export async function withServerTiming(request: Request, handler: () => Promise<Response>): Promise<Response> {
  const storage = slot[KEY];
  if (!storage || !TIMED_PATH.test(new URL(request.url).pathname)) return handler();
  const timings: Timings = { start: performance.now(), entries: [] };
  const res = await storage.run(timings, handler);
  const headers = new Headers(res.headers);
  headers.set("server-timing", serverTimingHeader(timings, performance.now()));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
