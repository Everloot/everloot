import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INTERFACE } from "../../../companion/src/bridge/answers";
import { luaString } from "../../../companion/src/bridge/lua";
import { decodeBuild, decodeOrder } from "../../../web/src/lib/talents/share";
import type { BuildsStatus } from "../shared/types";
import { keySiteOrigin, readAccountKey, readKeyOrigin, writeKeyOrigin } from "./account";
export { keySiteOrigin } from "./account";

/**
 * The player's saved talent builds into the game: read from everloot.app/api/me/builds with the
 * account key (it needs the "Read my saved builds" permission) and written into the EverlootBuilds
 * slot addon, which `/everloot plan` lists after the next /reload. Nothing goes the other way.
 * Design: docs/design/specs/2026-10-20-saved-builds-design.md, "Desktop App and addon (step 2)".
 */

export const BUILDS_ADDON = "EverlootBuilds";
export const BUILDS_DATA = "data.lua";
/** How often the app syncs while it runs. */
export const BUILDS_EVERY_MS = 15 * 60 * 1000;
/** The site's caps: 200 builds per account, names up to 60 characters, codes up to 400. */
const MAX_BUILDS = 200;
const MAX_NAME = 60;
const MAX_CHARACTER = 24;
const MAX_REALM = 32;
const MAX_CODE = 400;
/** The share code's shape, as the site's save_build checks it; the first group is the class. */
const CODE = /^EL1-([a-z]+)-\d+-[0-9.]+-[A-Za-z0-9_-]+$/;
const CLASS_SLUG = /^[a-z-]{1,24}$/;
const GAME_BUILD = /^\d+(\.\d+)+$/;
/** A code the addon can load for this class: the right shape, length and class. */
const codeFor = (code: unknown, slug: string): code is string => str(code) && code.length <= MAX_CODE && CODE.exec(code)?.[1] === slug;

/** One build as the file carries it: what the addon needs to list it and load it, nothing more. */
export interface GameBuild { name: string; character: string | null; realm: string | null; class: string; code: string; code2: string | null; order?: string | null; order2?: string | null; active: boolean; gameBuild: string }

const str = (v: unknown): v is string => typeof v === "string";
const clip = (s: string, n: number) => [...s].slice(0, n).join("");

/** Order is optional metadata: a damaged or unsupported token never changes the ranks. Reuse the
 * transport codec (including its exact whitespace set); no catalog or generated order is needed. */
function gameOrder(token: unknown, code: string | null): string | null {
  if (!str(token) || !code) return null;
  const build = decodeBuild(code);
  return build.ok && decodeOrder(token, build.build.ranks).ok ? token.trim() : null;
}

/**
 * The builds from the site's answer, joined with their character labels. Anything malformed is left
 * out rather than failing the sync: a build the addon could not load is no use in the game.
 */
export function gameBuilds(body: unknown): GameBuild[] {
  const b = (body && typeof body === "object" ? body : {}) as { characters?: unknown; builds?: unknown };
  if (!Array.isArray(b.builds)) throw new Error("everloot.app sent an answer without builds");
  const labels = new Map<string, { name: string; realm: string | null }>();
  for (const c of Array.isArray(b.characters) ? b.characters : []) {
    const { id, name, realm } = (c ?? {}) as { id?: unknown; name?: unknown; realm?: unknown };
    if (str(id) && str(name) && name.trim()) labels.set(id, { name: clip(name.trim(), MAX_CHARACTER), realm: str(realm) && realm.trim() ? clip(realm.trim(), MAX_REALM) : null });
  }
  const rows = (b.builds as unknown[]).flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (!str(r.name) || !str(r.classSlug) || !CLASS_SLUG.test(r.classSlug)) return [];
    if (!str(r.gameBuild) || r.gameBuild.length > 32 || !GAME_BUILD.test(r.gameBuild)) return [];
    if (!codeFor(r.code, r.classSlug)) return [];
    const code2 = codeFor(r.code2, r.classSlug) ? r.code2 : null;
    const label = str(r.characterId) ? labels.get(r.characterId) : undefined;
    const build: GameBuild = {
      name: clip(r.name.trim(), MAX_NAME) || "Untitled build",
      character: label?.name ?? null,
      realm: label?.realm ?? null,
      class: r.classSlug,
      code: r.code,
      code2,
      order: gameOrder(r.order, r.code),
      order2: gameOrder(r.order2, code2),
      active: r.active === true,
      gameBuild: r.gameBuild,
    };
    return [{ build, updatedAt: str(r.updatedAt) ? r.updatedAt : "" }];
  });
  // Newest first, so the numbers in game start with what the player worked on last.
  rows.sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0));
  return rows.slice(0, MAX_BUILDS).map((r) => r.build);
}

/** The slot addon: a TOC and `data.lua`, which sets the one global `EverlootBuildsData`. Every string goes through luaString. */
export function renderBuildsAddon(builds: GameBuild[], syncedAt: string): { toc: string; lua: string } {
  const toc = [
    `## Interface: ${INTERFACE}`,
    "## Title: Everloot Builds",
    "## Notes: Written by the Everloot Desktop App. /everloot plan after /reload. Spend order needs an updated Everloot addon; older addons load ranks only.",
    "## Author: Everloot",
    "",
    BUILDS_DATA,
    "",
  ].join("\n");
  const rows = builds.map((b) => {
    const fields = [
      `name = ${luaString(b.name)}`,
      b.character !== null ? `character = ${luaString(b.character)}` : null,
      b.character !== null && b.realm !== null ? `realm = ${luaString(b.realm)}` : null,
      `class = ${luaString(b.class)}`,
      `code = ${luaString(b.code)}`,
      b.code2 !== null ? `code2 = ${luaString(b.code2)}` : null,
      b.order ? `order = ${luaString(b.order)}` : null,
      b.code2 !== null && b.order2 ? `order2 = ${luaString(b.order2)}` : null,
      `active = ${b.active ? "true" : "false"}`,
      `gameBuild = ${luaString(b.gameBuild)}`,
    ].filter((f) => f !== null);
    return `    { ${fields.join(", ")} },`;
  });
  const lua = [
    "-- Written by the Everloot Desktop App. Do not edit: the next sync replaces this file.",
    "EverlootBuildsData = {",
    "  version = 1,",
    `  syncedAt = ${luaString(syncedAt)},`,
    "  builds = {",
    ...rows,
    "  },",
    "}",
    "",
  ].join("\n");
  return { toc, lua };
}

/** The file without its sync time, so a sync that brings the same builds is seen as no change. */
const withoutTime = (lua: string) => lua.replace(/^ {2}syncedAt = .*$/m, "");

/**
 * Writes the slot addon, each file through a temp file and a rename, so the game never loads half a
 * file. A file whose content is already there is not written again. Returns whether anything changed.
 */
export function writeBuildsAddon(addonsDir: string, rendered: { toc: string; lua: string }): boolean {
  const dir = join(addonsDir, BUILDS_ADDON);
  const read = (name: string) => { try { return readFileSync(join(dir, name), "utf8"); } catch { return null; } };
  const files: [string, string, (s: string) => string][] = [
    [`${BUILDS_ADDON}.toc`, rendered.toc, (s) => s],
    [BUILDS_DATA, rendered.lua, withoutTime],
  ];
  let changed = false;
  for (const [name, text, same] of files) {
    const old = read(name);
    if (old !== null && same(old) === same(text)) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.tmp`), text);
    renameSync(join(dir, `${name}.tmp`), join(dir, name));
    changed = true;
  }
  return changed;
}

/** Why a sync did not write anything, in words the page shows as they are. */
export class BuildsError extends Error {
  readonly retryAfterMs: number;
  /** 401: the key is unknown or revoked; the builds it brought are taken out of the game. */
  readonly revoked: boolean;
  constructor(readonly kind: "error" | "forbidden" | "unavailable", message: string, extra: { retryAfterMs?: number; revoked?: boolean } = {}) {
    super(message);
    this.retryAfterMs = extra.retryAfterMs ?? 0;
    this.revoked = extra.revoked ?? false;
  }
}

/** GET /api/me/builds with the key. Only this request carries it, and it does not follow redirects. */
export async function fetchBuilds(endpoint: string, key: string, send: typeof fetch = fetch): Promise<GameBuild[]> {
  const origin = keySiteOrigin(endpoint);
  if (!origin) throw new BuildsError("error", "The site address must use https before your key is sent to it.");
  let res: Response;
  try {
    res = await send(`${origin}/api/me/builds`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": "everloot-desktop" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BuildsError("error", "Could not reach everloot.app to sync your builds. Trying again later.");
  }
  if (res.status === 401) throw new BuildsError("error", "everloot.app does not know your key, or it was revoked. Paste a new one under Settings > Account.", { revoked: true });
  if (res.status === 403) throw new BuildsError("forbidden", "This key can't read your saved builds.");
  if (res.status === 404) throw new BuildsError("unavailable", "Saved builds aren't available yet.");
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : BUILDS_EVERY_MS;
    throw new BuildsError("error", `Your key has used its requests for now. Trying again in ${Math.max(1, Math.round(wait / 60_000))} min.`, { retryAfterMs: wait });
  }
  if (!res.ok) throw new BuildsError("error", `everloot.app could not send your builds (${res.status}). Trying again later.`);
  let body: unknown;
  try { body = await res.json(); } catch { throw new BuildsError("error", "everloot.app sent an answer the app could not read."); }
  try { return gameBuilds(body); } catch (err) { throw new BuildsError("error", err instanceof Error ? err.message : String(err)); }
}

export interface BuildsSyncOptions {
  dataFolder: string;
  endpoint(): string;
  /** Interface/AddOns, or null before a game folder is set. */
  addonsDir(): string | null;
  /** Nothing runs before the player pressed Start; the timer also skips while the app is paused. */
  ready(): boolean;
  paused(): boolean;
  onChange(): void;
  log(level: "info" | "error", text: string): void;
  send?: typeof fetch;
  now?: () => Date;
}

/**
 * The sync: on demand, after a key is saved, and every 15 minutes from `start`. Never without a key,
 * and in the background only to the site the key was signed in on. A refused key (401, 403) stops the
 * timer until the key changes or the player presses Sync builds. Each sign-in or sign-out starts a new
 * generation: a sync from an older one writes nothing and changes no state.
 */
export function createBuildsSync(o: BuildsSyncOptions) {
  const now = o.now ?? (() => new Date());
  let status: BuildsStatus = { state: "off", message: "", syncedAt: null, builds: null };
  let generation = 0;
  let inflight: { generation: number; done: Promise<BuildsStatus> } | null = null;
  let halted = false;
  let notBefore = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  /** The last refusal logged, so the same one is not logged again until something else happens. */
  let lastRefusal: string | null = null;

  const set = (next: Partial<BuildsStatus>) => { status = { ...status, ...next }; o.onChange(); };
  /** A refusal is shown every time but logged only when it is new, so a key without the permission does not fill the log. */
  const refuse = (state: BuildsStatus["state"], message: string, level: "info" | "error") => {
    set({ state, message });
    if (lastRefusal === `${state}:${message}`) return;
    lastRefusal = `${state}:${message}`;
    o.log(level, `builds: ${message}`);
  };
  const clearRetry = () => { if (retry) clearTimeout(retry); retry = null; };

  /** Takes the builds out of the game: an empty list through the same writer, only where a file is already there. */
  const emptyFile = () => {
    const dir = o.addonsDir();
    if (!dir) return;
    try { readFileSync(join(dir, BUILDS_ADDON, BUILDS_DATA)); } catch { return; }
    try { writeBuildsAddon(dir, renderBuildsAddon([], now().toISOString())); } catch (err) { o.log("error", `builds: could not clear the builds file: ${err instanceof Error ? err.message : String(err)}`); }
  };

  async function run(g: number): Promise<BuildsStatus> {
    if (g !== generation) return status;
    const key = readAccountKey(o.dataFolder);
    if (!key) { set({ state: "off", message: "" }); return status; }
    const dir = o.addonsDir();
    if (!dir) { set({ state: "error", message: "Pick the game folder first." }); return status; }
    const origin = keySiteOrigin(o.endpoint());
    if (!origin) { refuse("error", "The site address must use https before your key is sent to it.", "error"); return status; }
    if (origin !== readKeyOrigin(o.dataFolder)) { refuse("error", "The site address changed since you signed in. Sign in again, or press Sync builds to use this site.", "info"); return status; }
    set({ state: "running", message: "Syncing…" });
    let builds: GameBuild[];
    try {
      builds = await fetchBuilds(origin, key, o.send);
    } catch (err) {
      if (g !== generation) return status;
      const e = err instanceof BuildsError ? err : new BuildsError("error", String(err));
      if (e.retryAfterMs) {
        notBefore = now().getTime() + e.retryAfterMs;
        clearRetry();
        retry = setTimeout(() => { retry = null; void tick(); }, e.retryAfterMs);
      }
      if (e.kind === "forbidden" || e.revoked) halted = true;
      if (e.revoked) emptyFile();
      refuse(e.kind, e.message, e.kind === "error" && !e.revoked ? "error" : "info");
      return status;
    }
    if (g !== generation) return status;
    const at = now().toISOString();
    try {
      const changed = writeBuildsAddon(dir, renderBuildsAddon(builds, at));
      notBefore = 0;
      lastRefusal = null;
      set({ state: "ok", message: changed ? `${builds.length} build(s) written` : `${builds.length} build(s), no change`, syncedAt: at, builds: builds.length });
      if (changed) o.log("info", `builds: ${builds.length} saved build(s) written; /reload in game to see them`);
    } catch (err) {
      refuse("error", `Could not write the builds file: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
    return status;
  }

  /** One sync per generation at a time; a new generation's sync starts after the older one settles. */
  const begin = (): Promise<BuildsStatus> => {
    if (inflight && inflight.generation === generation) return inflight.done;
    const g = generation;
    const before = inflight?.done ?? Promise.resolve(status);
    const done: Promise<BuildsStatus> = before.catch(() => status).then(() => run(g)).finally(() => { if (inflight?.done === done) inflight = null; });
    inflight = { generation: g, done };
    return done;
  };

  /** The timer's turn: skipped before Start, while paused, after a refused key, and until a 429's Retry-After has passed. */
  const tick = (): Promise<BuildsStatus> | null => {
    if (!o.ready() || o.paused() || halted || now().getTime() < notBefore) return null;
    return begin();
  };

  /** Back to a clean slate for a new key or none: a new generation, the timer free again, no retry pending. */
  const fresh = () => { generation++; halted = false; notBefore = 0; lastRefusal = null; clearRetry(); set({ state: "off", message: "", syncedAt: null, builds: null }); };

  return {
    status: () => status,
    /** Sync builds pressed: also the player's go-ahead for the site in Settings and for a key the timer stopped on. */
    sync(): Promise<BuildsStatus> {
      halted = false;
      const origin = keySiteOrigin(o.endpoint());
      if (origin && readAccountKey(o.dataFolder)) writeKeyOrigin(o.dataFolder, origin);
      return begin();
    },
    tick,
    /** After a sign-in: a fresh generation, then a sync of the new key. */
    signedIn(): Promise<BuildsStatus> { fresh(); return begin(); },
    /** After a sign-out: a fresh generation, and the builds the old key brought are taken out of the game. */
    signedOut() { fresh(); emptyFile(); },
    start() { timer ??= setInterval(() => { void tick(); }, BUILDS_EVERY_MS); },
    stop() { if (timer) clearInterval(timer); timer = null; clearRetry(); },
  };
}
