/**
 * Builds the Legacy perk catalog from the raw rows of one client snapshot. The builder is pure: it takes a table
 * reader, so tests run on small made-up tables, and `writeLegacyPerkCatalog` runs it on a snapshot file. From kb/:
 *
 *   npx tsx src/legacy-perks/build-catalog.ts <snapshot.sqlite> [--out ../web/src/data/game-data/legacy-perks.json]
 *
 * The file already at the output path is the previous catalog: the ids it lists that this build lacks stay, as
 * withdrawn. Nothing is read into a gap: a column a row lacks is not a 0, and a row another row names, or a table
 * with encrypted blocks, refuses the build rather than leave a perk or a rule out. See docs/LEGACY_PERKS.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { parseArgs } from "../args.js";
import { tableHash } from "../build-watch/client-digests.js";
import { readClientManifest, readClientMeta, readClientRows } from "../client-snapshot.js";
import type { Row, Rows, TableReader } from "../talents/build-catalog.js";
import { LABEL, type BuildStamp } from "../talents/catalog.js";
import {
  LEGACY_PERKS_SCHEMA, LEGACY_TRAIT_SYSTEM_ID, LegacyPerkCatalog,
  type Entry, type Gate, type Node, type Tree, type Withdrawn,
} from "./catalog.js";

/** A column's number; null when the row does not have the column. An absent column is never read as 0. */
const val = (row: Row | undefined, column: string): number | null => {
  const v = row?.[column];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** A column the catalog cannot do without: a row that lacks it refuses the build. */
function need(table: string, row: Row, column: string): number {
  const v = val(row, column);
  if (v === null) throw new Error(`${table} ${String(row.ID ?? "?")} has no ${column}; an absent column is not read as 0, so no catalog is built`);
  return v;
}

/** The row an id points at. A table that lacks it refuses the build, so a perk or a rule never goes missing quietly. */
function resolve(rows: Rows, id: number, table: string, by: string): Row {
  const row = rows.get(id);
  if (!row) throw new Error(`${by} ${id}, which is not in ${table}; no catalog is built`);
  return row;
}

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
/** The one table whose encrypted blocks only hide names: a name that may sit in one is left unknown, nothing else. */
const NAMES_TABLE = "SpellName";

/**
 * Columns every row of a table must have. They tie a row to a tree, node, entry, group, condition or cost, and which
 * rows are Legacy rows is worked out over all of them, so one row without one leaves the inventory unknown.
 */
const JOINS: [string, string[]][] = [
  ["TraitTree", ["ID", "TraitSystemID"]], ["TraitNode", ["ID", "TraitTreeID"]],
  ["TraitNodeXTraitNodeEntry", ["ID", "TraitNodeID", "TraitNodeEntryID", "Index"]], ["TraitEdge", ["ID", "LeftTraitNodeID", "RightTraitNodeID"]],
  ["TraitNodeGroupXTraitNode", ["TraitNodeGroupID", "TraitNodeID"]], ["TraitNodeGroupXTraitCond", ["TraitNodeGroupID", "TraitCondID"]],
  ["TraitNodeXTraitCond", ["TraitNodeID", "TraitCondID"]], ["TraitNodeEntryXTraitCond", ["TraitNodeEntryID", "TraitCondID"]],
  ["TraitCond", ["ID", "TraitTreeID"]], ["TraitTreeXTraitCurrency", ["TraitTreeID", "TraitCurrencyID"]],
  ["TraitTreeXTraitCost", ["TraitTreeID", "TraitCostID"]], ["TraitNodeXTraitCost", ["ID", "TraitNodeID"]],
  ["TraitNodeGroupXTraitCost", ["ID", "TraitNodeGroupID"]], ["TraitNodeEntryXTraitCost", ["ID", "TraitNodeEntryID"]],
];

const KINDS: Record<number, NonNullable<Node["kind"]> | undefined> = { 0: "single", 1: "tiered", 2: "choice" };
/** TraitEdge.Type 2 (SufficientForAvailability) and 3 (RequiredForAvailability); type 0 is drawn and asks nothing. */
const RULES: Record<number, "any" | "all" | undefined> = { 2: "any", 3: "all" };
/** Edge types WoWDBDefs names that are no prerequisite: left out, with a warning. */
const EDGE_NOTES: Record<number, string> = {
  1: "which WoWDBDefs marks deprecated",
  4: "which makes two nodes mutually exclusive, a rule this catalog does not model",
  5: "which WoWDBDefs marks deprecated",
};
/** The columns that make a condition ask for more than points spent. */
const OTHER_REQUIREMENTS = ["CondType", "TraitNodeID", "TraitNodeEntryID", "GrantedRanks", "QuestID", "AchievementID", "SpecSetID", "RequiredLevel", "TraitCondAccountElementID", "Flags"];
/** Every column a condition on a Legacy group, node or entry is read by; one it lacks refuses the build. */
const COND_COLUMNS = ["SpentAmountRequired", "TraitCurrencyID", "TraitNodeGroupID", ...OTHER_REQUIREMENTS];

export interface LegacyCatalogInput {
  get: TableReader;
  /** Encrypted blocks skipped in each table read, from the manifest beside the snapshot. A table it does not name was not read. */
  encryptedBlocks: ReadonlyMap<string, number>;
  build: BuildStamp;
  /** The catalog this one replaces: the ids it lists that this build lacks are kept as withdrawn. */
  previous?: LegacyPerkCatalog;
}

export function buildLegacyPerkCatalog({ get, encryptedBlocks, build, previous }: LegacyCatalogInput): LegacyPerkCatalog {
  for (const table of [...CORE_TABLES, ...RULE_TABLES]) {
    const rows = get(table);
    const blocks = encryptedBlocks.get(table);
    if (!rows || blocks === undefined) throw new Error(`${table} is not in this snapshot; without it perks or their rules would go missing, so no catalog is built`);
    if (!rows.size && CORE_TABLES.includes(table)) throw new Error(`${table} has no rows in this snapshot; no catalog is built`);
    if (blocks > 0 && table !== NAMES_TABLE) {
      throw new Error(`${table} has ${plural(blocks, "encrypted block", "encrypted blocks")}; the rows in them are not read, so perks or rules could be missing and none may be withdrawn. No catalog is built`);
    }
  }
  if (previous && previous.build.buildId > build.buildId) {
    throw new Error(`the previous catalog is from build ${previous.build.version}, newer than ${build.version}; withdrawals would run backwards, so no catalog is built`);
  }
  for (const [table, columns] of JOINS) for (const row of list(get(table))) for (const column of columns) need(table, row, column);
  const warnings: string[] = [];

  const systemTrees = list(get("TraitTree")).filter((r) => need("TraitTree", r, "TraitSystemID") === LEGACY_TRAIT_SYSTEM_ID).map((r) => need("TraitTree", r, "ID"));
  const nodeRows = list(get("TraitNode")).filter((r) => systemTrees.includes(need("TraitNode", r, "TraitTreeID")));
  const treeIds = systemTrees.filter((id) => nodeRows.some((r) => need("TraitNode", r, "TraitTreeID") === id));
  if (!treeIds.length) {
    throw new Error(`no Legacy trees: trait system ${LEGACY_TRAIT_SYSTEM_ID} has no tree with nodes in this build. The system may have moved or gone; a maintainer decides which, so nothing is withdrawn and no catalog is built`);
  }
  const legacy = new Map(nodeRows.map((r) => [need("TraitNode", r, "ID"), r]));
  const treeOf = (nodeId: number) => need("TraitNode", legacy.get(nodeId)!, "TraitTreeID");

  // Entries, in buy order, named like the talent catalog names them.
  const spellName = new Map(list(get("SpellName")).map((r) => [need("SpellName", r, "ID"), text(r.Name_lang)]));
  const nameBlocks = encryptedBlocks.get(NAMES_TABLE)!;
  const definitions = get("TraitDefinition")!;
  const entryRows = get("TraitNodeEntry")!;
  const LINKS = "TraitNodeXTraitNodeEntry";
  const entryLinks = group(list(get(LINKS)).filter((l) => legacy.has(need(LINKS, l, "TraitNodeID"))), (l) => need(LINKS, l, "TraitNodeID"));
  const entryNode = new Map([...entryLinks].flatMap(([nodeId, ls]) => ls.map((l) => [need(LINKS, l, "TraitNodeEntryID"), nodeId] as const)));
  const nameOf = (entryId: number, definitionId: number, def: Row, spellId: number): string | null => {
    const override = text(def.OverrideName_lang);
    if (override) return override;
    const visible = val(def, "VisibleSpellID");
    if (visible === null) {
      warnings.push(`definition ${definitionId} has no VisibleSpellID, so which spell's name entry ${entryId} shows is not known; its name is left empty`);
      return null;
    }
    const shown = visible || spellId;
    const name = spellName.get(shown) ?? null;
    if (name === null) {
      warnings.push(`entry ${entryId}: spell ${shown} has no name row${nameBlocks ? `; SpellName has ${plural(nameBlocks, "encrypted block", "encrypted blocks")}, so the name may sit in one` : ""}`);
    }
    return name;
  };
  const entriesOf = (nodeId: number): Entry[] => [...(entryLinks.get(nodeId) ?? [])]
    .sort((a, b) => need(LINKS, a, "Index") - need(LINKS, b, "Index") || need(LINKS, a, "ID") - need(LINKS, b, "ID"))
    .map((link) => {
      const id = need(LINKS, link, "TraitNodeEntryID");
      const entry = resolve(entryRows, id, "TraitNodeEntry", `node ${nodeId} lists entry`);
      const definitionId = need("TraitNodeEntry", entry, "TraitDefinitionID");
      const def = resolve(definitions, definitionId, "TraitDefinition", `entry ${id} names definition`);
      const spellId = need("TraitDefinition", def, "SpellID");
      return { id, definitionId, spellId, name: nameOf(id, definitionId, def, spellId), maxRanks: val(entry, "MaxRanks") };
    });

  // Prerequisites: edges between two Legacy nodes. One whose rule cannot be read stays, unresolved.
  const prereqs = new Map<number, Node["prereqs"]>();
  const leftOut = new Map<number, number>();
  let outside = 0;
  for (const e of list(get("TraitEdge"))) {
    const from = need("TraitEdge", e, "LeftTraitNodeID");
    const to = need("TraitEdge", e, "RightTraitNodeID");
    if (!legacy.has(from) && !legacy.has(to)) continue;
    if (!legacy.has(from) || !legacy.has(to)) { outside += 1; continue; }
    const type = val(e, "Type");
    if (type === 0) continue;
    if (type !== null && EDGE_NOTES[type]) { leftOut.set(type, (leftOut.get(type) ?? 0) + 1); continue; }
    const rule = type === null ? null : RULES[type] ?? null;
    if (!rule) {
      const edge = `edge ${need("TraitEdge", e, "ID")} (node ${from} to ${to})`;
      warnings.push(`${edge} ${type === null ? "has no TraitEdge.Type" : `has TraitEdge type ${type}, which WoWDBDefs does not name`}; node ${to} keeps a prerequisite on node ${from} whose rule is unresolved`);
    }
    const known = prereqs.get(to) ?? [];
    if (!known.some((p) => p.nodeId === from && p.rule === rule)) prereqs.set(to, [...known, rule ? { nodeId: from, rule, confidence: "stored" } : { nodeId: from, rule: null, confidence: "unknown" }]);
  }
  for (const [type, n] of [...leftOut].sort(([a], [b]) => a - b)) warnings.push(`${plural(n, "edge", "edges")} left out: TraitEdge type ${type}, ${EDGE_NOTES[type]}`);
  if (outside) warnings.push(`${plural(outside, "edge", "edges")} left out: ${outside === 1 ? "it leads" : "they lead"} outside the Legacy trees`);

  // Gates: conditions on node groups that hold Legacy nodes. Only a plain spend condition becomes a gate.
  const GROUP_NODES = "TraitNodeGroupXTraitNode";
  const groupLinks = list(get(GROUP_NODES));
  const membersOf = (groupId: number) => [...new Set(groupLinks.filter((l) => need(GROUP_NODES, l, "TraitNodeGroupID") === groupId)
    .map((l) => need(GROUP_NODES, l, "TraitNodeID")))].filter((id) => legacy.has(id)).sort(byId);
  const conds = get("TraitCond")!;
  const condition = (condId: number, by: string): Row => {
    const c = resolve(conds, condId, "TraitCond", by);
    for (const column of COND_COLUMNS) need("TraitCond", c, column);
    return c;
  };
  const isSpendGate = (c: Row) => val(c, "SpentAmountRequired")! > 0 && OTHER_REQUIREMENTS.every((k) => val(c, k) === 0);
  const asked = (c: Row) => OTHER_REQUIREMENTS.filter((k) => val(c, k) !== 0).map((k) => `${k} ${val(c, k)}`).join(", ") || "SpentAmountRequired 0";
  const attached = new Set<number>();
  const gates = new Map<number, Gate[]>();
  for (const link of list(get("TraitNodeGroupXTraitCond"))) {
    const groupId = need("TraitNodeGroupXTraitCond", link, "TraitNodeGroupID");
    const guards = membersOf(groupId);
    if (!guards.length) continue;
    const condId = need("TraitNodeGroupXTraitCond", link, "TraitCondID");
    attached.add(condId);
    const c = condition(condId, `group ${groupId} names condition`);
    if (!isSpendGate(c)) {
      warnings.push(`condition ${condId} on group ${groupId} (nodes ${guards.join(", ")}) is not a plain spend gate (${asked(c)}); not modelled, so the nodes it guards have a rule this catalog does not show`);
      continue;
    }
    const named = val(c, "TraitNodeGroupID")!;
    const counted = named ? membersOf(named) : [];
    if (named && !counted.length) warnings.push(`gate ${condId} counts points in group ${named}, which holds no Legacy node`);
    const treeId = treeIds.includes(val(c, "TraitTreeID")!) ? val(c, "TraitTreeID")! : treeOf(guards[0]);
    gates.set(treeId, [...(gates.get(treeId) ?? []), {
      condId, amount: val(c, "SpentAmountRequired")!, currencyId: val(c, "TraitCurrencyID")!, guardedGroupId: groupId, guards,
      countedGroupId: named || null, counted, confidence: named ? "inferred" : "unknown",
      from: named ? "TraitCond.TraitNodeGroupID" : "TraitCond.TraitNodeGroupID is 0",
    }]);
  }
  for (const [table, column] of [["TraitNodeXTraitCond", "TraitNodeID"], ["TraitNodeEntryXTraitCond", "TraitNodeEntryID"]] as const) {
    for (const link of list(get(table))) {
      const target = need(table, link, column);
      const nodeId = column === "TraitNodeID" ? target : entryNode.get(target);
      if (nodeId === undefined || !legacy.has(nodeId)) continue;
      const condId = need(table, link, "TraitCondID");
      attached.add(condId);
      const on = `${column === "TraitNodeID" ? "node" : "entry"} ${target}`;
      const c = condition(condId, `${on} names condition`);
      warnings.push(`condition ${condId} on ${on} (${asked(c)}) is not modelled, so that node has a rule this catalog does not show`);
    }
  }
  for (const [condId, c] of conds) {
    if (treeIds.includes(need("TraitCond", c, "TraitTreeID")) && !attached.has(condId)) warnings.push(`condition ${condId} names Legacy tree ${val(c, "TraitTreeID")} and guards no Legacy node; left out`);
  }

  // Cost per tree, unless something overrides it for part of the tree.
  const costLinks = group(list(get("TraitTreeXTraitCost")), (r) => need("TraitTreeXTraitCost", r, "TraitTreeID"));
  const costs = get("TraitCost")!;
  const overrides: { treeId: number; label: string }[] = [
    ...list(get("TraitNodeXTraitCost")).filter((r) => legacy.has(val(r, "TraitNodeID")!))
      .map((r) => ({ treeId: treeOf(val(r, "TraitNodeID")!), label: `TraitNodeXTraitCost row ${val(r, "ID")} (node ${val(r, "TraitNodeID")})` })),
    ...list(get("TraitNodeGroupXTraitCost")).flatMap((r) => [...new Set(membersOf(val(r, "TraitNodeGroupID")!).map(treeOf))]
      .map((treeId) => ({ treeId, label: `TraitNodeGroupXTraitCost row ${val(r, "ID")} (group ${val(r, "TraitNodeGroupID")})` }))),
    ...list(get("TraitNodeEntryXTraitCost")).filter((r) => entryNode.has(val(r, "TraitNodeEntryID")!))
      .map((r) => ({ treeId: treeOf(entryNode.get(val(r, "TraitNodeEntryID")!)!), label: `TraitNodeEntryXTraitCost row ${val(r, "ID")} (entry ${val(r, "TraitNodeEntryID")})` })),
  ];
  const costOf = (treeId: number): Tree["cost"] => {
    const links = costLinks.get(treeId) ?? [];
    if (links.length !== 1) {
      const why = links.length ? `${links.length} TraitTreeXTraitCost rows` : "no TraitTreeXTraitCost row";
      warnings.push(`tree ${treeId} has ${why}; its cost is unknown`);
      return { value: null, confidence: "unknown", from: why, traitCostId: null, currencyId: null };
    }
    const traitCostId = need("TraitTreeXTraitCost", links[0], "TraitCostID");
    const cost = resolve(costs, traitCostId, "TraitCost", `tree ${treeId} names cost`);
    const over = overrides.filter((o) => o.treeId === treeId).map((o) => o.label);
    if (over.length) {
      warnings.push(`${over.join(", ")} ${over.length === 1 ? "overrides" : "override"} the cost of part of tree ${treeId}; this catalog does not resolve overrides, so the tree's cost is unknown`);
      return { value: null, confidence: "unknown", from: `overridden by ${over.join(", ")}`, traitCostId, currencyId: null };
    }
    const absent = ["Amount", "CurveID", "TraitCurrencyID"].find((column) => val(cost, column) === null);
    const amount = val(cost, "Amount")!;
    const curve = val(cost, "CurveID")!;
    const currencyId = val(cost, "TraitCurrencyID")!;
    const why = absent ? `TraitCost ${traitCostId} has no ${absent}`
      : curve ? `TraitCost ${traitCostId} follows curve ${curve}, which is not read`
        : amount <= 0 ? `TraitCost ${traitCostId} has Amount ${amount}`
          : !currencyId ? `TraitCost ${traitCostId} names no currency` : null;
    if (why) {
      warnings.push(`tree ${treeId}: ${why}; its cost is unknown`);
      return { value: null, confidence: "unknown", from: why, traitCostId, currencyId: null };
    }
    return { value: amount, confidence: "inferred", from: "TraitTreeXTraitCost, TraitCost.Amount", traitCostId, currencyId };
  };

  const currencyLinks = group(list(get("TraitTreeXTraitCurrency")), (r) => need("TraitTreeXTraitCurrency", r, "TraitTreeID"));
  const currencyRows = get("TraitCurrency")!;
  const currencyOf = (treeId: number): number | null => {
    const ids = [...new Set((currencyLinks.get(treeId) ?? []).map((r) => need("TraitTreeXTraitCurrency", r, "TraitCurrencyID")))].sort(byId);
    if (!ids.length) warnings.push(`tree ${treeId} lists no currency (TraitTreeXTraitCurrency)`);
    if (ids.length > 1) warnings.push(`tree ${treeId} lists ${ids.length} currencies (${ids.join(", ")}); which one it spends is not known, so none is kept`);
    if (ids.length !== 1) return null;
    resolve(currencyRows, ids[0], "TraitCurrency", `tree ${treeId} names currency`);
    return ids[0];
  };

  const trees: Tree[] = treeIds.map((treeId) => {
    const nodes = nodeRows.filter((r) => need("TraitNode", r, "TraitTreeID") === treeId).map((r): Node => {
      const id = need("TraitNode", r, "ID");
      const entries = entriesOf(id);
      const type = val(r, "Type");
      const kind = type === null ? null : KINDS[type] ?? null;
      if (type === null) warnings.push(`node ${id} has no TraitNode.Type; its kind and ranks are left unknown`);
      else if (!kind) warnings.push(`node ${id} has TraitNode type ${type}, which WoWDBDefs does not name; its kind and ranks are left unknown`);
      for (const column of ["PosX", "PosY", "Flags"]) if (val(r, column) === null) warnings.push(`node ${id} has no TraitNode.${column}; it is left empty`);
      return {
        id, x: val(r, "PosX"), y: val(r, "PosY"), kind, flags: val(r, "Flags"),
        ranks: ranksOf(kind, entries, type === null ? "TraitNode.Type is absent" : `TraitNode.Type ${type} is not one WoWDBDefs names`),
        entries,
        prereqs: [...(prereqs.get(id) ?? [])].sort((a, b) => a.nodeId - b.nodeId || (a.rule ?? "").localeCompare(b.rule ?? "")),
      };
    });
    return { id: treeId, currencyId: currencyOf(treeId), cost: costOf(treeId), nodes, gates: [...(gates.get(treeId) ?? [])].sort((a, b) => a.condId - b.condId) };
  });

  // What the files store and nothing here interprets: nodes whose flags differ, and nodes that share a spell.
  const nodes = trees.flatMap((t) => t.nodes);
  const byFlags = group(nodes.filter((n) => n.flags !== null), (n) => n.flags!);
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

  const currencies = [...new Set(trees.map((t) => t.currencyId).filter((id): id is number => id !== null))].sort(byId).map((id) => {
    const max = val(currencyRows.get(id), "SourcedMax");
    return {
      id,
      cap: max === null ? { value: null, confidence: "unknown" as const, from: `TraitCurrency ${id} has no SourcedMax` }
        : max > 0 ? { value: max, confidence: "inferred" as const, from: "TraitCurrency.SourcedMax" }
          : { value: null, confidence: "unknown" as const, from: "TraitCurrency.SourcedMax is 0" },
    };
  });

  return LegacyPerkCatalog.parse({
    schema: LEGACY_PERKS_SCHEMA, label: LABEL, credit: GAME_DATA_CREDIT, build, traitSystemId: LEGACY_TRAIT_SYSTEM_ID,
    currencies, trees, emptyTreeIds: systemTrees.filter((id) => !treeIds.includes(id)),
    withdrawn: withdrawals(previous, trees, systemTrees, build),
    tables: [...CORE_TABLES, ...RULE_TABLES].sort()
      .map((table) => ({ table, rows: get(table)!.size, hash: tableHash(get(table)!), encryptedBlocks: encryptedBlocks.get(table)! })),
    warnings,
  });
}

function ranksOf(kind: Node["kind"], entries: Entry[], typeProblem: string): Node["ranks"] {
  const unknown = (from: string): Node["ranks"] => ({ value: null, confidence: "unknown", from });
  if (!kind) return unknown(typeProblem);
  if (!entries.length) return unknown("the node has no entries");
  const absent = entries.find((e) => e.maxRanks === null);
  if (absent) return unknown(`TraitNodeEntry ${absent.id} has no MaxRanks`);
  const none = entries.find((e) => e.maxRanks! <= 0);
  if (none) return unknown(`TraitNodeEntry ${none.id} has MaxRanks ${none.maxRanks}`);
  if (kind === "single" && entries.length > 1) return unknown("a single node with several entries");
  const ranks = entries.map((e) => e.maxRanks!);
  return { value: kind === "tiered" ? ranks.reduce((a, b) => a + b, 0) : Math.max(...ranks), confidence: "stored", from: "TraitNodeEntry.MaxRanks" };
}

const KIND_ORDER = { tree: 0, node: 1, entry: 2 } as const;

/**
 * The ids the previous catalog listed that this build lacks, added to the ones it had already withdrawn. An id
 * that is back in the files leaves the list. A tree still in the trait system, even with no nodes, is not withdrawn.
 * The builder refuses an incomplete inventory before it gets here, so an id is withdrawn only when the files lack it.
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

/** The catalog a new one replaces. One that does not read as this schema refuses the build: its withdrawn ids would be lost. */
function readPrevious(path: string): LegacyPerkCatalog {
  const parsed = LegacyPerkCatalog.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`the previous catalog at ${path} does not read as ${LEGACY_PERKS_SCHEMA}, so what it withdrew cannot be carried over; no catalog is built`);
  return parsed.data;
}

/** Builds the catalog from a snapshot file and writes it to `outPath`; the file already there is the previous catalog. */
export function writeLegacyPerkCatalog(snapshotPath: string, outPath: string, previousPath = outPath): LegacyPerkCatalog {
  const meta = readClientMeta(snapshotPath);
  const build: BuildStamp = {
    product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig,
    definitions: meta.definitions, extractedAt: meta.extractedAt,
  };
  // The manifest says which tables were read, an empty one included, and how many encrypted blocks each skipped.
  const manifest = readClientManifest(snapshotPath);
  if (!manifest) throw new Error(`${snapshotPath} has no manifest beside it, so which tables were read and which blocks were encrypted is not known; no catalog is built`);
  const encryptedBlocks = new Map(manifest.tables.map((t) => [t.table, t.encryptedBlocks]));
  const cache = new Map<string, Rows>();
  const get: TableReader = (table) => {
    if (!encryptedBlocks.has(table)) return undefined;
    if (!cache.has(table)) cache.set(table, readClientRows(snapshotPath, table));
    return cache.get(table);
  };
  const catalog = buildLegacyPerkCatalog({ get, encryptedBlocks, build, previous: existsSync(previousPath) ? readPrevious(previousPath) : undefined });
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
