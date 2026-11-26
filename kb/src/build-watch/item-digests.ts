/**
 * Digests of the items the site reads: for every item id in the client's Item or ItemSparse table, a short hash of
 * each part of the item record the site builds (assets/items.ts), never the values. `item-digests.json` is committed
 * and overwritten per build, like client-digests.json, so the build watch can say which items a new build added,
 * removed or changed, and which parts changed, without keeping a snapshot.
 *
 * An item's digest is a string of 4-hex-digit hashes, one per ITEM_PARTS entry in that order. An item the Item
 * table lists with no named ItemSparse row (the server sends those) has only the icon part. A hash is the first 4
 * hex digits of a sha256 over the part's canonical JSON; two different values can share one (1 in 65536), which
 * hides that change, never invents one.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { buildItemSet, type ItemRecord } from "../assets/items.js";
import { BuildStamp, LABEL } from "../talents/catalog.js";
import type { TableReader } from "../talents/build-catalog.js";
import type { ItemChanges } from "./changes.js";
import { canonicalJson } from "./client-digests.js";

export const ITEM_DIGEST_SCHEMA = "everloot.item-digests/1";
export const ITEM_DIGESTS_REL = "web/src/data/game-data/item-digests.json";

/**
 * The parts of an item record, in digest order, with the record keys each covers. The Use and Equip lines (`fx`)
 * need spell descriptions the build watch does not resolve, so they are not compared.
 */
export const ITEM_PARTS = [
  ["name", ["n"]], ["quality", ["q"]], ["itemLevel", ["l"]], ["requiredLevel", ["r"]], ["binding", ["b"]],
  ["category", ["s", "c", "sc"]], ["stats", ["st"]], ["weapon", ["d", "w"]], ["sellPrice", ["sp"]],
  ["lines", ["u", "lc", "t", "is", "cr", "rq", "qs"]], ["icon", ["i"]],
] as const satisfies readonly (readonly [string, readonly (keyof ItemRecord)[]])[];
export type ItemPart = (typeof ITEM_PARTS)[number][0];
/** The item tables whose encrypted blocks decide whether an id seen for the first time is new. */
export const ITEM_TABLES = ["Item", "ItemSparse"] as const;

const HEX = 4;

export const ItemDigests = z.object({
  schema: z.literal(ITEM_DIGEST_SCHEMA),
  label: z.literal(LABEL),
  build: BuildStamp,
  /** Encrypted blocks skipped in the item tables: items in them are not read, so are not in `items`. */
  encryptedBlocks: z.object({ Item: z.number().int().nonnegative(), ItemSparse: z.number().int().nonnegative() }),
  /** Item id to its digest: ITEM_PARTS.length hashes, or the icon hash alone. */
  items: z.record(z.string(), z.string().regex(new RegExp(`^(?:[0-9a-f]{${HEX}}|[0-9a-f]{${HEX * ITEM_PARTS.length}})$`))),
});
export type ItemDigests = z.infer<typeof ItemDigests>;

const hash = (v: unknown) => createHash("sha256").update(canonicalJson(v ?? null)).digest("hex").slice(0, HEX);

/** One item's digest from its record (null for an icon-only item) and its icon file id. */
export function itemDigest(record: ItemRecord | null, icon: number | null): string {
  if (!record) return hash(icon);
  return ITEM_PARTS.map(([part, keys]) => (part === "icon" ? hash(icon) : hash(keys.map((k) => record[k] ?? null)))).join("");
}

/** Digests of every item the tables give, read with the same builder as the site's item files. */
export function itemDigestsOf(build: BuildStamp, get: TableReader, encryptedBlocks: { Item: number; ItemSparse: number }): ItemDigests {
  const set = buildItemSet(get);
  const items: Record<string, string> = {};
  const ids = new Set<number>([...set.records.keys(), ...(get("Item")?.keys() ?? [])]);
  for (const id of [...ids].filter((x) => x > 0).sort((a, b) => a - b)) {
    items[String(id)] = itemDigest(set.records.get(id) ?? null, set.iconOf.get(id) ?? set.iconOnly.get(id) ?? null);
  }
  return ItemDigests.parse({ schema: ITEM_DIGEST_SCHEMA, label: LABEL, build, encryptedBlocks, items });
}

/** One item per line, so a diff between builds reads item by item. */
export function writeItemDigests(root: string, digests: ItemDigests): string {
  const path = join(root, ITEM_DIGESTS_REL);
  mkdirSync(dirname(path), { recursive: true });
  const ids = Object.keys(digests.items).sort((a, b) => Number(a) - Number(b));
  const lines = ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(digests.items[id])}`).join(",\n");
  const { items: _i, ...head } = digests;
  writeFileSync(path, `${JSON.stringify(head).slice(0, -1)},"items":{\n${lines}\n}}\n`);
  return path;
}

export function readItemDigests(root: string): ItemDigests | null {
  const path = join(root, ITEM_DIGESTS_REL);
  return existsSync(path) ? ItemDigests.parse(JSON.parse(readFileSync(path, "utf8"))) : null;
}

const parts = (d: string) => Array.from({ length: d.length / HEX }, (_, i) => d.slice(i * HEX, (i + 1) * HEX));

/** The parts that differ between two digests of one item, or the tooltip coming or going. */
function changedParts(before: string, after: string): string[] {
  const [x, y] = [parts(before), parts(after)];
  if (x.length !== y.length) return [x.length < y.length ? "tooltip-added" : "tooltip-removed", ...(x.at(-1) !== y.at(-1) ? ["icon"] : [])];
  if (x.length === 1) return x[0] === y[0] ? [] : ["icon"];
  return ITEM_PARTS.flatMap(([part], i) => (x[i] === y[i] ? [] : [part]));
}

export interface ItemDiff { items: ItemChanges | null; warnings: string[] }

/**
 * Items added, removed and changed between two builds. When the item tables skip a different number of encrypted
 * blocks, an id read for the first time may have been in a block before, so nothing is listed.
 */
export function diffItemDigests(before: ItemDigests, after: ItemDigests, spoiler: boolean): ItemDiff {
  const moved = ITEM_TABLES.filter((t) => before.encryptedBlocks[t] !== after.encryptedBlocks[t]);
  const warnings: string[] = [];
  if (moved.length) {
    // The site reads every warning the watch writes (web/src/lib/talents/freshness-records.ts); its test finds them by `warnings.push`.
    warnings.push(`the item tables skip a different number of encrypted blocks than before (${moved.join(", ")}), so new and changed items are not listed`);
    return { items: null, warnings };
  }
  const added: number[] = [], removed: number[] = [], changed: ItemChanges["changed"] = [];
  for (const [key, d] of Object.entries(after.items)) {
    const old = before.items[key];
    if (old === undefined) added.push(Number(key));
    else {
      const fields = changedParts(old, d);
      if (fields.length) changed.push({ id: Number(key), fields });
    }
  }
  for (const key of Object.keys(before.items)) if (!(key in after.items)) removed.push(Number(key));
  const byNumber = (a: number, b: number) => a - b;
  return {
    items: { spoiler, comparedTo: before.build.buildId, added: added.sort(byNumber), removed: removed.sort(byNumber), changed: changed.sort((a, b) => a.id - b.id) },
    warnings,
  };
}
