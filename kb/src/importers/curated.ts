import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TALENT_CLASSES } from "@everloot/protocol";
import { parse } from "yaml";
import { z } from "zod";
import { decodeBuild, resolveBuild } from "../../../web/src/lib/talents/share";
import type { DB } from "../db.js";
import { ALL_GAME_VERSIONS, ALL_KINDS, replaceSourceRows, type EntityInput, type GameVersion, type Kind } from "../entities.js";
import { siteCatalog } from "../talents/site-catalogs.js";

const REQUIRED = ["kind", "id", "name", "game_version", "body", "source_url", "retrieved_at"] as const;

export const BUILD_PURPOSES = ["leveling", "dungeon", "raid", "pvp"] as const;

/** A starter build's `data`, as stored. The YAML writes `share_code`; the row carries `shareCode`. */
export const BuildData = z.object({
  class: z.enum(TALENT_CLASSES),
  tree: z.string().min(1),
  purpose: z.enum(BUILD_PURPOSES),
  shareCode: z.string().min(1),
  points: z.number().int().positive(),
  build: z.string().min(1),
  status: z.enum(["draft", "published"]),
});
export type BuildData = z.infer<typeof BuildData>;

function isMissing(value: unknown): boolean {
  return value === undefined || String(value).trim() === "";
}

/** Validates a build entry's data block and its share code against the class's site catalog, or throws. */
function buildData(where: string, raw: unknown): BuildData {
  const { share_code: shareCode, ...rest } = (raw ?? {}) as Record<string, unknown>;
  const parsed = BuildData.safeParse({ ...rest, shareCode });
  if (!parsed.success) {
    throw new Error(`${where} has bad build data: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const data = parsed.data;
  const decoded = decodeBuild(data.shareCode);
  if (!decoded.ok) throw new Error(`${where} share code does not decode (${decoded.error})`);
  const resolved = resolveBuild(siteCatalog(data.class), decoded.build);
  if (!resolved.ok) throw new Error(`${where} share code is for ${decoded.build.classSlug} not ${data.class}`);
  const { unknown, clamped, rejected, ranks } = resolved.build;
  if (unknown.length + clamped.length + rejected.length > 0) {
    throw new Error(`${where} share code does not place whole on the ${data.class} tree`);
  }
  if (decoded.build.build !== data.build) throw new Error(`${where} share code was made on ${decoded.build.build} not ${data.build}`);
  const spent = Object.values(ranks).reduce((sum, r) => sum + r.rank, 0);
  if (spent !== data.points) throw new Error(`${where} share code spends ${spent} points not ${data.points}`);
  return data;
}

/**
 * Reads every `*.yaml`/`*.yml` in `dir`. Each file is a list of entries written in our own words; `source_url`
 * points at the evidence. Replaces all curated rows.
 */
export async function importCurated(db: DB, dir: string): Promise<number> {
  const rows: EntityInput[] = [];
  const seen = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort()) {
    const entries = parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>[] | null;
    if (entries !== null && !Array.isArray(entries)) {
      throw new Error(`${file}: top level must be a list of entries`);
    }
    (entries ?? []).forEach((e, i) => {
      for (const field of REQUIRED) {
        if (isMissing(e[field])) throw new Error(`${file}: entry ${i + 1} is missing ${field}`);
      }
      const kind = e.kind as string;
      if (!ALL_KINDS.includes(kind as Kind)) {
        throw new Error(`${file}: entry ${i + 1} has kind "${kind}"; expected one of: ${ALL_KINDS.join(", ")}`);
      }
      const gameVersion = e.game_version as string;
      if (!ALL_GAME_VERSIONS.includes(gameVersion as GameVersion)) {
        throw new Error(
          `${file}: entry ${i + 1} has game_version "${gameVersion}"; expected one of: ${ALL_GAME_VERSIONS.join(", ")}`,
        );
      }
      const extId = String(e.id);
      // Kebab-case, starting with a letter: a curated id must never read as a wiki page id (digits) in a URL.
      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(extId)) {
        throw new Error(`${file}: entry ${i + 1} has id "${extId}"; use lowercase kebab-case starting with a letter`);
      }
      const key = `${kind}\u0000${extId}`;
      const firstFile = seen.get(key);
      if (firstFile !== undefined) {
        throw new Error(`${file}: entry ${i + 1} duplicates ${kind} id "${extId}" (first defined in ${firstFile})`);
      }
      seen.set(key, file);
      let data: Record<string, unknown> | undefined;
      if (kind === "build") {
        const build = buildData(`${file}: entry ${i + 1}`, e.data);
        // A draft stays in the file until the team publishes it.
        if (build.status === "draft") return;
        data = build;
      } else if (e.data !== undefined) {
        if (typeof e.data !== "object" || e.data === null || Array.isArray(e.data)) throw new Error(`${file}: entry ${i + 1} data must be a mapping`);
        data = e.data as Record<string, unknown>;
      }
      rows.push({
        kind: kind as Kind,
        extId,
        name: String(e.name).trim(),
        body: String(e.body).trim(),
        ...(data ? { data } : {}),
        gameVersion: gameVersion as GameVersion,
        sourceUrl: String(e.source_url),
        retrievedAt: String(e.retrieved_at),
      });
    });
  }
  return replaceSourceRows(db, "curated", ALL_KINDS, rows);
}
