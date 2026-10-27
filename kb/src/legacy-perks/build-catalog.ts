/**
 * Builds the Legacy perk catalog from the raw rows of one client snapshot. The builder is pure: it takes a table
 * reader, so tests run on small made-up tables, and `writeLegacyPerkCatalog` runs it on a snapshot file. From kb/:
 *
 *   npx tsx src/legacy-perks/build-catalog.ts <snapshot.sqlite> [--out ../web/src/data/game-data/legacy-perks.json]
 *
 * The file already at the output path is the previous catalog: the ids it lists that this build lacks stay, as
 * withdrawn. See docs/LEGACY_PERKS.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { parseArgs } from "../args.js";
import { tableHash } from "../build-watch/client-digests.js";
import { readClientManifest, readClientMeta, readClientRows, readClientTables } from "../client-snapshot.js";
import type { Row, Rows, TableReader } from "../talents/build-catalog.js";
import { LABEL, type BuildStamp } from "../talents/catalog.js";
import {
  LEGACY_PERKS_SCHEMA, LEGACY_TRAIT_SYSTEM_ID, LegacyPerkCatalog,
  type Entry, type Gate, type Node, type Tree, type Withdrawn,
} from "./catalog.js";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
/** Rows in id order, whatever order the reader holds them in. */
const list = (rows: Rows | undefined): Row[] => [...(rows ?? new Map<number, Row>())].sort(([a], [b]) => a - b).map(([, r]) => r);
const byId = (a: number, b: number) => a - b;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function group<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

/** Tables the catalog cannot be built without; each must hold rows. */
const CORE_TABLES = ["TraitTree", "TraitNode", "TraitNodeXTraitNodeEntry", "TraitNodeEntry", "TraitDefinition", "SpellName"];
/** Tables that must have been read, though a build may ship them empty (the cost overrides are, in 70634). */
const RULE_TABLES = [
  "TraitEdge", "TraitNodeGroupXTraitNode", "TraitCond", "TraitNodeGroupXTraitCond", "TraitNodeXTraitCond", "TraitNodeEntryXTraitCond",
  "TraitTreeXTraitCurrency", "TraitCurrency", "TraitTreeXTraitCost", "TraitCost", "TraitNodeXTraitCost", "TraitNodeGroupXTraitCost",
  "TraitNodeEntryXTraitCost",
];

const KINDS: Record<number, NonNullable<Node["kind"]> | undefined> = { 0: "single", 1: "tiered", 2: "choice" };
/** TraitEdge.Type 2 (SufficientForAvailability) and 3 (RequiredForAvailability); type 0 is drawn and asks nothing. */
const RULES: Record<number, "any" | "all" | undefined> = { 2: "any", 3: "all" };
const EDGE_NOTES: Record<number, string> = {
  1: "which WoWDBDefs marks deprecated",
  4: "which makes two nodes mutually exclusive, a rule this catalog does not model",
  5: "which WoWDBDefs marks deprecated",
};
/** The columns that make a condition ask for more than points spent. */
const OTHER_REQUIREMENTS = ["CondType", "TraitNodeID", "TraitNodeEntryID", "GrantedRanks", "QuestID", "AchievementID", "SpecSetID", "RequiredLevel", "TraitCondAccountElementID", "Flags"];

export interface LegacyCatalogInput {
  get: TableReader;
  build: BuildStamp;
  /** The catalog this one replaces: the ids it lists that this build lacks are kept as withdrawn. */
  previous?: LegacyPerkCatalog;
}

export function buildLegacyPerkCatalog({ get, build, previous }: LegacyCatalogInput): LegacyPerkCatalog {
  for (const table of [...CORE_TABLES, ...RULE_TABLES]) {
    const rows = get(table);
    if (!rows) throw new Error(`${table} is not in this snapshot; without it perks or their rules would go missing, so no catalog is built`);
    if (!rows.size && CORE_TABLES.includes(table)) throw new Error(`${table} has no rows in this snapshot; no catalog is built`);
  }
  if (previous && previous.build.buildId > build.buildId) {
    throw new Error(`the previous catalog is from build ${previous.build.version}, newer than ${build.version}; withdrawals would run backwards, so no catalog is built`);
  }
  const warnings: string[] = [];

  const systemTrees = list(get("TraitTree")).filter((r) => num(r.TraitSystemID) === LEGACY_TRAIT_SYSTEM_ID).map((r) => num(r.ID));
  const nodeRows = list(get("TraitNode")).filter((r) => systemTrees.includes(num(r.TraitTreeID)));
  const treeIds = systemTrees.filter((id) => nodeRows.some((r) => num(r.TraitTreeID) === id));
  if (!treeIds.length) {
    throw new Error(`no Legacy trees: trait system ${LEGACY_TRAIT_SYSTEM_ID} has no tree with nodes in this build. The system may have moved or gone; a maintainer decides which, so nothing is withdrawn and no catalog is built`);
  }
  const legacy = new Map(nodeRows.map((r) => [num(r.ID), r]));
  const treeOf = (nodeId: number) => num(legacy.get(nodeId)?.TraitTreeID);

  // Entries, in buy order, named like the talent catalog names them.
  const spellName = new Map(list(get("SpellName")).map((r) => [num(r.ID), text(r.Name_lang)]));
  const definitions = new Map(list(get("TraitDefinition")).map((r) => [num(r.ID), r]));
  const entryRows = get("TraitNodeEntry")!;
  const entryLinks = group(list(get("TraitNodeXTraitNodeEntry")).filter((l) => legacy.has(num(l.TraitNodeID))), (l) => num(l.TraitNodeID));
  const entryNode = new Map([...entryLinks].flatMap(([nodeId, ls]) => ls.map((l) => [num(l.TraitNodeEntryID), nodeId] as const)));
  const entriesOf = (nodeId: number): Entry[] => [...(entryLinks.get(nodeId) ?? [])]
    .sort((a, b) => num(a.Index) - num(b.Index) || num(a.ID) - num(b.ID))
    .flatMap((link) => {
      const id = num(link.TraitNodeEntryID);
      const entry = entryRows.get(id);
      if (!entry) {
        warnings.push(`node ${nodeId} lists entry ${id}, which is not in TraitNodeEntry; left out`);
        return [];
      }
      const def = definitions.get(num(entry.TraitDefinitionID));
      const spellId = num(def?.SpellID);
      const name = text(def?.OverrideName_lang) ?? spellName.get(num(def?.VisibleSpellID) || spellId) ?? null;
      return [{ id, definitionId: num(entry.TraitDefinitionID), spellId, name, maxRanks: num(entry.MaxRanks) }];
    });

  // Prerequisites: edges between two Legacy nodes. Others are counted and reported, never read as a rule.
  const prereqs = new Map<number, Node["prereqs"]>();
  const otherTypes = new Map<number, number>();
  let outside = 0;
  for (const e of list(get("TraitEdge"))) {
    const from = num(e.LeftTraitNodeID);
    const to = num(e.RightTraitNodeID);
    if (!legacy.has(from) && !legacy.has(to)) continue;
    if (!legacy.has(from) || !legacy.has(to)) { outside += 1; continue; }
    const type = num(e.Type);
    const rule = RULES[type];
    if (rule) {
      const known = prereqs.get(to) ?? [];
      if (!known.some((p) => p.nodeId === from && p.rule === rule)) prereqs.set(to, [...known, { nodeId: from, rule, confidence: "stored" }]);
    } else if (type !== 0) otherTypes.set(type, (otherTypes.get(type) ?? 0) + 1);
  }
  for (const [type, n] of [...otherTypes].sort(([a], [b]) => a - b)) {
    warnings.push(`${plural(n, "edge", "edges")} left out: TraitEdge type ${type}, ${EDGE_NOTES[type] ?? "which WoWDBDefs does not name"}`);
  }
  if (outside) warnings.push(`${plural(outside, "edge", "edges")} left out: ${outside === 1 ? "it leads" : "they lead"} outside the Legacy trees`);

  // Gates: conditions on node groups that hold Legacy nodes. Only a plain spend condition becomes a gate.
  const groupLinks = list(get("TraitNodeGroupXTraitNode"));
  const membersOf = (groupId: number) => [...new Set(groupLinks.filter((l) => num(l.TraitNodeGroupID) === groupId).map((l) => num(l.TraitNodeID)))]
    .filter((id) => legacy.has(id)).sort(byId);
  const conds = new Map(list(get("TraitCond")).map((r) => [num(r.ID), r]));
  const isSpendGate = (c: Row) => num(c.SpentAmountRequired) > 0 && OTHER_REQUIREMENTS.every((k) => num(c[k]) === 0);
  const asked = (c: Row) => OTHER_REQUIREMENTS.filter((k) => num(c[k]) !== 0).map((k) => `${k} ${num(c[k])}`).join(", ") || "SpentAmountRequired 0";
  const attached = new Set<number>();
  const gates = new Map<number, Gate[]>();
  for (const link of list(get("TraitNodeGroupXTraitCond"))) {
    const groupId = num(link.TraitNodeGroupID);
    const guards = membersOf(groupId);
    if (!guards.length) continue;
    const condId = num(link.TraitCondID);
    attached.add(condId);
    const c = conds.get(condId);
    if (!c) {
      warnings.push(`group ${groupId} (nodes ${guards.join(", ")}) names condition ${condId}, which is not in TraitCond; what it asks is not known`);
      continue;
    }
    if (!isSpendGate(c)) {
      warnings.push(`condition ${condId} on group ${groupId} (nodes ${guards.join(", ")}) is not a plain spend gate (${asked(c)}); not modelled, so the nodes it guards have a rule this catalog does not show`);
      continue;
    }
    const named = num(c.TraitNodeGroupID);
    const counted = named ? membersOf(named) : [];
    if (named && !counted.length) warnings.push(`gate ${condId} counts points in group ${named}, which holds no Legacy node`);
    const treeId = treeIds.includes(num(c.TraitTreeID)) ? num(c.TraitTreeID) : treeOf(guards[0]);
    gates.set(treeId, [...(gates.get(treeId) ?? []), {
      condId, amount: num(c.SpentAmountRequired), currencyId: num(c.TraitCurrencyID), guardedGroupId: groupId, guards,
      countedGroupId: named || null, counted, confidence: named ? "inferred" : "unknown",
      from: named ? "TraitCond.TraitNodeGroupID" : "TraitCond.TraitNodeGroupID is 0",
    }]);
  }
  for (const [table, column] of [["TraitNodeXTraitCond", "TraitNodeID"], ["TraitNodeEntryXTraitCond", "TraitNodeEntryID"]] as const) {
    for (const link of list(get(table))) {
      const target = num(link[column]);
      const nodeId = column === "TraitNodeID" ? target : entryNode.get(target);
      if (nodeId === undefined || !legacy.has(nodeId)) continue;
      const condId = num(link.TraitCondID);
      attached.add(condId);
      const c = conds.get(condId);
      warnings.push(`condition ${condId} on ${column === "TraitNodeID" ? "node" : "entry"} ${target} (${c ? asked(c) : "not in TraitCond"}) is not modelled, so that node has a rule this catalog does not show`);
    }
  }
  for (const [condId, c] of conds) {
    if (treeIds.includes(num(c.TraitTreeID)) && !attached.has(condId)) warnings.push(`condition ${condId} names Legacy tree ${num(c.TraitTreeID)} and guards no Legacy node; left out`);
  }

  // Cost per tree, unless something overrides it for part of the tree.
  const costLinks = group(list(get("TraitTreeXTraitCost")), (r) => num(r.TraitTreeID));
  const costs = get("TraitCost")!;
  const overrides: { treeId: number; label: string }[] = [
    ...list(get("TraitNodeXTraitCost")).filter((r) => legacy.has(num(r.TraitNodeID)))
      .map((r) => ({ treeId: treeOf(num(r.TraitNodeID)), label: `TraitNodeXTraitCost row ${num(r.ID)} (node ${num(r.TraitNodeID)})` })),
    ...list(get("TraitNodeGroupXTraitCost")).flatMap((r) => [...new Set(membersOf(num(r.TraitNodeGroupID)).map(treeOf))]
      .map((treeId) => ({ treeId, label: `TraitNodeGroupXTraitCost row ${num(r.ID)} (group ${num(r.TraitNodeGroupID)})` }))),
    ...list(get("TraitNodeEntryXTraitCost")).filter((r) => entryNode.has(num(r.TraitNodeEntryID)))
      .map((r) => ({ treeId: treeOf(entryNode.get(num(r.TraitNodeEntryID))!), label: `TraitNodeEntryXTraitCost row ${num(r.ID)} (entry ${num(r.TraitNodeEntryID)})` })),
  ];
  const costOf = (treeId: number): Tree["cost"] => {
    const links = costLinks.get(treeId) ?? [];
    if (links.length !== 1) {
      const why = links.length ? `${links.length} TraitTreeXTraitCost rows` : "no TraitTreeXTraitCost row";
      warnings.push(`tree ${treeId} has ${why}; its cost is unknown`);
      return { value: null, confidence: "unknown", from: why, traitCostId: null, currencyId: null };
    }
    const traitCostId = num(links[0].TraitCostID);
    const over = overrides.filter((o) => o.treeId === treeId).map((o) => o.label);
    if (over.length) {
      warnings.push(`${over.join(", ")} ${over.length === 1 ? "overrides" : "override"} the cost of part of tree ${treeId}; this catalog does not resolve overrides, so the tree's cost is unknown`);
      return { value: null, confidence: "unknown", from: `overridden by ${over.join(", ")}`, traitCostId, currencyId: null };
    }
    const cost = costs.get(traitCostId);
    const amount = num(cost?.Amount);
    if (!cost || amount <= 0 || num(cost.CurveID)) {
      const why = !cost ? `TraitCost ${traitCostId} is not in TraitCost` : num(cost.CurveID) ? `TraitCost ${traitCostId} follows curve ${num(cost.CurveID)}, which is not read` : `TraitCost ${traitCostId} has Amount ${amount}`;
      warnings.push(`tree ${treeId}: ${why}; its cost is unknown`);
      return { value: null, confidence: "unknown", from: why, traitCostId, currencyId: null };
    }
    return { value: amount, confidence: "inferred", from: "TraitTreeXTraitCost, TraitCost.Amount", traitCostId, currencyId: num(cost.TraitCurrencyID) || null };
  };

  const currencyLinks = group(list(get("TraitTreeXTraitCurrency")), (r) => num(r.TraitTreeID));
  const currencyOf = (treeId: number): number | null => {
    const ids = [...new Set((currencyLinks.get(treeId) ?? []).map((r) => num(r.TraitCurrencyID)))].sort(byId);
    if (!ids.length) warnings.push(`tree ${treeId} lists no currency (TraitTreeXTraitCurrency)`);
    if (ids.length > 1) warnings.push(`tree ${treeId} lists ${ids.length} currencies (${ids.join(", ")}); which one it spends is not known, so none is kept`);
    return ids.length === 1 ? ids[0] : null;
  };

  const trees: Tree[] = treeIds.map((treeId) => {
    const nodes = nodeRows.filter((r) => num(r.TraitTreeID) === treeId).map((r): Node => {
      const id = num(r.ID);
      const entries = entriesOf(id);
      const kind = KINDS[num(r.Type)] ?? null;
      if (!kind) warnings.push(`node ${id} has TraitNode type ${num(r.Type)}, which WoWDBDefs does not name; its kind and ranks are left unknown`);
      return {
        id, x: num(r.PosX), y: num(r.PosY), kind, flags: num(r.Flags), ranks: ranksOf(kind, entries), entries,
        prereqs: [...(prereqs.get(id) ?? [])].sort((a, b) => a.nodeId - b.nodeId || a.rule.localeCompare(b.rule)),
      };
    });
    return { id: treeId, currencyId: currencyOf(treeId), cost: costOf(treeId), nodes, gates: [...(gates.get(treeId) ?? [])].sort((a, b) => a.condId - b.condId) };
  });

  // What the files store and nothing here interprets: nodes whose flags differ, and nodes that share a spell.
  const nodes = trees.flatMap((t) => t.nodes);
  const byFlags = group(nodes, (n) => n.flags);
  if (byFlags.size > 1) {
    const common = [...byFlags].sort(([a, x], [b, y]) => y.length - x.length || a - b)[0][0];
    const parts = [...byFlags].sort(([a], [b]) => a - b)
      .map(([flags, ns]) => (flags === common ? `${flags} on ${ns.length} nodes` : `${flags} on ${ns.length} (${ns.map((n) => n.id).join(", ")})`));
    warnings.push(`TraitNode.Flags differs between Legacy nodes: ${parts.join(", ")}. WoWDBDefs names only bit 1 (ShowMultipleIcons), so what the difference means is not known`);
  }
  const bySpell = new Map<number, number[]>();
  for (const n of nodes) for (const spellId of new Set(n.entries.map((e) => e.spellId))) bySpell.set(spellId, [...(bySpell.get(spellId) ?? []), n.id]);
  for (const [spellId, ids] of [...bySpell].sort(([a], [b]) => a - b)) {
    if (ids.length > 1) warnings.push(`nodes ${ids.join(", ")} carry the same spell (${spellId}) and are all kept`);
  }

  const currencyRows = get("TraitCurrency")!;
  const currencies = [...new Set(trees.map((t) => t.currencyId).filter((id): id is number => id !== null))].sort(byId).map((id) => {
    const row = currencyRows.get(id);
    if (!row) return { id, cap: { value: null, confidence: "unknown" as const, from: `TraitCurrency ${id} is not in TraitCurrency` } };
    const max = num(row.SourcedMax);
    return { id, cap: max > 0 ? { value: max, confidence: "inferred" as const, from: "TraitCurrency.SourcedMax" } : { value: null, confidence: "unknown" as const, from: "TraitCurrency.SourcedMax is 0" } };
  });

  return LegacyPerkCatalog.parse({
    schema: LEGACY_PERKS_SCHEMA, label: LABEL, credit: GAME_DATA_CREDIT, build, traitSystemId: LEGACY_TRAIT_SYSTEM_ID,
    currencies, trees, emptyTreeIds: systemTrees.filter((id) => !treeIds.includes(id)),
    withdrawn: withdrawals(previous, trees, systemTrees, build),
    tables: [...CORE_TABLES, ...RULE_TABLES].sort().map((table) => ({ table, rows: get(table)!.size, hash: tableHash(get(table)!) })),
    warnings,
  });
}

function ranksOf(kind: Node["kind"], entries: Entry[]): Node["ranks"] {
  const unknown = (from: string): Node["ranks"] => ({ value: null, confidence: "unknown", from });
  if (!kind) return unknown("TraitNode.Type is not one WoWDBDefs names");
  if (!entries.length) return unknown("the node has no entries");
  if (kind === "single" && entries.length > 1) return unknown("a single node with several entries");
  const ranks = entries.map((e) => e.maxRanks);
  const value = kind === "tiered" ? ranks.reduce((a, b) => a + b, 0) : Math.max(...ranks);
  return value > 0 ? { value, confidence: "stored", from: "TraitNodeEntry.MaxRanks" } : unknown("TraitNodeEntry.MaxRanks is 0");
}

const KIND_ORDER = { tree: 0, node: 1, entry: 2 } as const;

/**
 * The ids the previous catalog listed that this build lacks, added to the ones it had already withdrawn. An id
 * that is back in the files leaves the list. A tree still in the trait system, even with no nodes, is not withdrawn.
 */
function withdrawals(previous: LegacyPerkCatalog | undefined, trees: Tree[], systemTrees: number[], build: BuildStamp): Withdrawn[] {
  if (!previous) return [];
  const present = new Set([
    ...systemTrees.map((id) => `tree ${id}`),
    ...trees.flatMap((t) => t.nodes.flatMap((n) => [`node ${n.id}`, ...n.entries.map((e) => `entry ${e.id}`)])),
  ]);
  const seen = { lastSeen: previous.build.version, withdrawnIn: build.version };
  const now: Withdrawn[] = previous.trees.flatMap((t) => [
    { kind: "tree" as const, id: t.id, treeId: t.id, name: null, ...seen },
    ...t.nodes.flatMap((n) => [
      { kind: "node" as const, id: n.id, treeId: t.id, name: n.entries[0]?.name ?? null, ...seen },
      ...n.entries.map((e) => ({ kind: "entry" as const, id: e.id, treeId: t.id, nodeId: n.id, name: e.name, ...seen })),
    ]),
  ]);
  const out = new Map<string, Withdrawn>();
  for (const w of [...previous.withdrawn, ...now]) {
    const key = `${w.kind} ${w.id}`;
    if (!present.has(key) && !out.has(key)) out.set(key, w);
  }
  return [...out.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id);
}

/** Two-space JSON in the schema's key order, ending in a newline: the same catalog always gives the same bytes. */
export function serializeLegacyPerkCatalog(catalog: LegacyPerkCatalog): string {
  return `${JSON.stringify(LegacyPerkCatalog.parse(catalog), null, 2)}\n`;
}

/** Builds the catalog from a snapshot file and writes it to `outPath`; the file already there is the previous catalog. */
export function writeLegacyPerkCatalog(snapshotPath: string, outPath: string, previousPath = outPath): LegacyPerkCatalog {
  const meta = readClientMeta(snapshotPath);
  const build: BuildStamp = {
    product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig,
    definitions: meta.definitions, extractedAt: meta.extractedAt,
  };
  // An empty table leaves no rows in the snapshot; the manifest beside it says which tables were read.
  const manifest = readClientManifest(snapshotPath);
  const read = new Set(manifest ? manifest.tables.map((t) => t.table) : readClientTables(snapshotPath));
  const cache = new Map<string, Rows>();
  const get: TableReader = (table) => {
    if (!read.has(table)) return undefined;
    if (!cache.has(table)) cache.set(table, readClientRows(snapshotPath, table));
    return cache.get(table);
  };
  const previous = existsSync(previousPath) ? LegacyPerkCatalog.parse(JSON.parse(readFileSync(previousPath, "utf8"))) : undefined;
  const catalog = buildLegacyPerkCatalog({ get, build, previous });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serializeLegacyPerkCatalog(catalog));
  return catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { flags, args } = parseArgs(process.argv.slice(2));
  try {
    if (!args[0]) throw new Error("usage: npx tsx src/legacy-perks/build-catalog.ts <snapshot.sqlite> [--out ../web/src/data/game-data/legacy-perks.json]");
    const out = flags.get("out") || "../web/src/data/game-data/legacy-perks.json";
    const c = writeLegacyPerkCatalog(args[0], out);
    const nodes = c.trees.flatMap((t) => t.nodes);
    console.log(`${c.build.product} ${c.build.version}: ${c.trees.length} trees, ${nodes.length} nodes, ${nodes.reduce((n, x) => n + x.entries.length, 0)} entries, `
      + `${c.withdrawn.length} withdrawn, ${c.warnings.length} warnings -> ${out}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
