import clientLayer from "@/data/game-data/client-layer.json";
import routing from "@/data/build-versions.json";
import { GAME_VERSIONS, type GameVersion, type GameVersionId } from "@/lib/game-version";

/**
 * Which version each address shows. The versions themselves are in lib/game-version.ts; this adds where each
 * one lives. The unprefixed pages show the served version, and their URLs never change when it does. /beta and
 * /ptr show that version: the same pages when it is the served one, otherwise a page saying the site holds no
 * snapshot of it. A version is never filled in from another version's files.
 *
 * next.config.js reads data/build-versions.json for its rewrites, so the table is JSON; the tests hold it to
 * the versions here.
 */

/** The version the unprefixed pages show. */
export const SERVED: GameVersion = GAME_VERSIONS.find((v) => v.id === routing.served)!;

/** The prefix a version also answers at; Live has none, because its pages are the unprefixed ones. */
export const PREFIXES = routing.prefixes as Partial<Record<GameVersionId, string>>;

/** Whether the committed client layer is this version's build: the site holds one snapshot, of one build. */
export const hasSnapshot = (v: GameVersion): boolean => v.build !== null && v.build === clientLayer.build.version && v.product === clientLayer.build.product;

/** A version's own address for a page: the served version keeps the unprefixed path, the others carry their prefix. */
export function versionHref(v: GameVersion, path = "/"): string {
  const prefix = v.id === SERVED.id ? undefined : PREFIXES[v.id];
  if (!prefix) return path;
  return path === "/" ? prefix : `${prefix}${path}`;
}

/** A path without the version prefix it starts with, for any prefix the table lists: /beta/guides/x is /guides/x, and
 *  /beta is /. A path that only starts with a prefix's letters, or with none, comes back as it is. */
export function withoutVersionPrefix(path: string): string {
  for (const prefix of Object.values(PREFIXES)) {
    if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) return path.slice(prefix.length) || "/";
  }
  return path;
}

/** The versions with a prefix that has no snapshot: their prefix answers with the notice page. */
export const WITHOUT_SNAPSHOT: GameVersion[] = GAME_VERSIONS.filter((v) => PREFIXES[v.id] && v.id !== SERVED.id);
