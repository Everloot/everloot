import type { DB } from "./db.js";
import { allTerms } from "./search.js";
import { SOURCES, type SourceId } from "./sources.js";

export type Kind =
  | "item" | "npc" | "object" | "quest" | "zone" | "spell" | "lore_page" | "creator" | "realm"
  | "achievement" | "faction" | "title" | "quest_chain" | "mount" | "legacy_perk" | "race" | "instance";
export type GameVersion = "forever" | "classic" | "retail" | "lore";

export const ALL_KINDS: Kind[] = [
  "item", "npc", "object", "quest", "zone", "spell", "lore_page", "creator", "realm",
  "achievement", "faction", "title", "quest_chain", "mount", "legacy_perk", "race", "instance",
];
export const ALL_GAME_VERSIONS: GameVersion[] = ["forever", "classic", "retail", "lore"];

export interface EntityInput {
  kind: Kind;
  extId: string;
  name: string;
  body?: string;
  data?: Record<string, unknown>;
  gameVersion: GameVersion;
  sourceUrl: string;
  retrievedAt: string;
}

/**
 * Atomically replaces every row of `sourceId` whose kind is in `kinds` with `rows`.
 * On any error the previous rows are kept.
 * Single writer: run one import at a time per connection — a second BEGIN while this one awaits
 * rows throws "cannot start a transaction within a transaction".
 */
export async function replaceSourceRows(
  db: DB,
  sourceId: SourceId,
  kinds: Kind[],
  rows: Iterable<EntityInput> | AsyncIterable<EntityInput>,
): Promise<number> {
  const licence = SOURCES[sourceId].licence;
  const countBefore = db.prepare(
    `SELECT count(*) AS n FROM entities WHERE source_id = ? AND kind IN (${kinds.map(() => "?").join(",")})`,
  );
  const del = db.prepare("DELETE FROM entities WHERE source_id = ? AND kind = ?");
  const ins = db.prepare(
    `INSERT INTO entities (kind, ext_id, name, body, data, game_version, source_id, source_url, licence, retrieved_at, name_norm)
     VALUES (@kind, @extId, @name, @body, @data, @gameVersion, @sourceId, @sourceUrl, @licence, @retrievedAt, @nameNorm)`,
  );
  db.exec("BEGIN");
  try {
    const { n: before } = countBefore.get(sourceId, ...kinds) as { n: number };
    for (const k of kinds) del.run(sourceId, k);
    let n = 0;
    for await (const r of rows) {
      if (!kinds.includes(r.kind)) throw new Error(`row kind ${r.kind} is not one of: ${kinds.join(", ")}`);
      ins.run({ ...r, body: r.body ?? "", data: JSON.stringify(r.data ?? {}), sourceId, licence, nameNorm: allTerms(r.name) });
      n++;
    }
    if (n === 0 && before > 0) {
      throw new Error(`refusing to replace ${before} ${sourceId} row(s) with an empty import`);
    }
    db.exec("COMMIT");
    return n;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
