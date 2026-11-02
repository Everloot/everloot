import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { LuaParseError, parseEverlootLua, type EverlootFile } from "../../../web/src/lib/sv-parse";
import type { SaveFacts } from "./save-facts";

/**
 * The save reader: one worker thread that parses the account files, so a logout on a large save does not freeze the
 * app. It sends back only small results (the facts the pages and jobs read, the event ids, the rows still unsent):
 * taking a whole parse back across threads would cost the main thread almost as much as the parse. When it cannot
 * start, stops or does not answer, every read falls back to the main thread as before, and one line says so.
 */

/** An error as it crosses from the worker: enough to throw the same message, type and code on this side. */
export interface WireError { lua: boolean; name: string; message: string; stack?: string; code?: string; errno?: number; syscall?: string; path?: string }

export type ReaderRequest =
  | { id: number; op: "facts"; file: string }
  | { id: number; op: "upload"; file: string }
  | { id: number; op: "records"; file: string; key: string; indices: number[] };

export type ReaderReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: WireError };

/** A facts read: the write it belongs to and the facts, or the parse error saveFacts would keep for that write. */
export type FactsValue = { key: string; facts: SaveFacts } | { key: string; error: WireError };

/** An upload read without the rows: the file's header and each record's eventId (null when it has none). */
export interface UploadHead { key: string; version: string; installId: string; clientBuild?: string; eventIds: (string | null)[] }

export function toWire(err: unknown): WireError {
  const e = err instanceof Error ? err : new Error(String(err));
  const { code, errno, syscall, path } = e as Partial<Pick<WireError, "code" | "errno" | "syscall" | "path">>;
  return { lua: e instanceof LuaParseError, name: e.name, message: e.message, stack: e.stack, code, errno, syscall, path };
}

const BUILT_IN: Record<string, ErrorConstructor> = { RangeError, TypeError, SyntaxError };

/** The error the main thread would have thrown: a LuaParseError stays one, a read error keeps its code. */
export function fromWire(w: WireError): Error {
  const err = w.lua ? new LuaParseError(w.message) : new (BUILT_IN[w.name] ?? Error)(w.message);
  if (err.name !== w.name) err.name = w.name;
  if (w.stack) err.stack = w.stack;
  for (const k of ["code", "errno", "syscall", "path"] as const) if (w[k] !== undefined) Object.assign(err, { [k]: w[k] });
  return err;
}

export interface ReaderSetup {
  /** The worker's bundled code (dist/parse-worker.cjs), read with fs so a path inside app.asar works. */
  code(): string;
  /** One line for the Log page when the reader stops and the main thread takes over. */
  log(text: string): void;
  /** How long one read may take before the reader counts as stuck. */
  timeoutMs?: number;
}

let setup: ReaderSetup | null = null;
let worker: Worker | null = null;
/** Set once the reader has failed: the rest of the session reads on the main thread. */
let stopped = false;
let nextId = 0;
const waiting = new Map<number, { done(reply: ReaderReply | null): void; timer: ReturnType<typeof setTimeout> }>();
const factsInFlight = new Map<string, Promise<{ key: string; facts: SaveFacts | Error } | null>>();

/** Sets up the save reader (it starts at the first read), or with null stops it. Without one, every read is on the main thread. */
export function useSaveReader(next: ReaderSetup | null): void {
  const w = worker;
  worker = null;
  void w?.terminate();
  for (const p of waiting.values()) { clearTimeout(p.timer); p.done(null); }
  waiting.clear();
  factsInFlight.clear();
  setup = next;
  stopped = false;
}

function fail(why: string): void {
  if (stopped) return;
  stopped = true;
  const w = worker;
  worker = null;
  void w?.terminate();
  for (const p of waiting.values()) { clearTimeout(p.timer); p.done(null); }
  waiting.clear();
  try { setup?.log(`The background save reader stopped (${why}); save files are read on the main thread until the app restarts.`); } catch { /* the line is best effort */ }
}

function started(): Worker | null {
  if (worker || stopped || !setup) return worker;
  let w: Worker;
  try { w = new Worker(setup.code(), { eval: true }); }
  catch (err) { fail(`it could not start: ${err instanceof Error ? err.message : String(err)}`); return null; }
  // An idle reader does not keep a command-line process open; a read in progress has its timer.
  w.unref();
  w.on("message", (reply: ReaderReply) => {
    const p = waiting.get(reply.id);
    if (!p) return;
    waiting.delete(reply.id);
    clearTimeout(p.timer);
    p.done(reply);
  });
  w.on("error", (err) => { if (worker === w) fail(err instanceof Error ? err.message : String(err)); });
  w.on("exit", (code) => { if (worker === w) fail(`it exited with code ${code}`); });
  worker = w;
  return w;
}

type Op = ReaderRequest extends infer R ? R extends { id: number } ? Omit<R, "id"> : never : never;

/** One request to the reader: its reply, or null when there is no reader and the caller reads on the main thread. */
function ask(request: Op): Promise<ReaderReply | null> {
  const w = started();
  if (!w) return Promise.resolve(null);
  const id = ++nextId;
  const ms = setup?.timeoutMs ?? 60_000;
  return new Promise((done) => {
    const timer = setTimeout(() => fail(`no answer in ${Math.round(ms / 1000)} s`), ms);
    waiting.set(id, { done, timer });
    w.postMessage({ ...request, id });
  });
}

/**
 * The file's facts from the reader, for readyFacts: null when the reader is not there or the file could not be read
 * (saveFacts then reads it itself and throws its own error). A parse error comes back as that write's error.
 */
export function readFacts(file: string): Promise<{ key: string; facts: SaveFacts | Error } | null> {
  let p = factsInFlight.get(file);
  if (!p) {
    p = ask({ op: "facts", file }).then((reply) => {
      if (!reply || !reply.ok) return null;
      const v = reply.value as FactsValue;
      return { key: v.key, facts: "error" in v ? fromWire(v.error) : v.facts };
    }).finally(() => { factsInFlight.delete(file); });
    factsInFlight.set(file, p);
  }
  return p;
}

/**
 * The upload's read (UploadOptions.read): parseEverlootLua's result, with only the records `sent` does not name taken
 * across. The reader parses; this side picks the unsent rows by their event ids, so a steady logout moves the new rows
 * and the ones the upload keeps here (never marked sent), not the whole file. A read or parse error is thrown as
 * parseEverlootLua(readFileSync(file)) throws it.
 */
export async function readForUpload(file: string, sent: (installId: string, eventId: string) => boolean): Promise<EverlootFile & { eventIds: Array<string | null> }> {
  const onMain = () => {
    const parsed = parseEverlootLua(readFileSync(file, "utf8"));
    return { ...parsed, eventIds: parsed.records.map((r) => (typeof r.eventId === "string" ? r.eventId : null)) };
  };
  const head = await ask({ op: "upload", file });
  if (!head) return onMain();
  if (!head.ok) throw fromWire(head.error);
  const { key, version, installId, clientBuild, eventIds } = head.value as UploadHead;
  const indices: number[] = [];
  eventIds.forEach((id, i) => { if (id === null || !sent(installId, id)) indices.push(i); });
  const rows = await ask({ op: "records", file, key, indices });
  // The reader drops its parse only for a newer upload of the file; the engine never runs two at once, but if so, read here.
  if (!rows || (rows.ok && rows.value === null)) return onMain();
  if (!rows.ok) throw fromWire(rows.error);
  // Taking the rows off the message is a turn of its own; the upload's checks over them run in the next one.
  await new Promise((resolve) => setImmediate(resolve));
  return { version, installId, ...(clientBuild !== undefined ? { clientBuild } : {}), records: rows.value as Array<Record<string, unknown>>, eventIds };
}
