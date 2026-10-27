import { GAME_DATA_CREDIT, SITE, TALENT_CLASSES, type McpToolArgs, type TalentClass, type TalentNodeOut } from "@everloot/protocol";
import { DECODE_MESSAGES, extractCode, importCode } from "../../web/src/lib/talents/import";
import { decodeBuild } from "../../web/src/lib/talents/share";
import { nodeMap, pointsByTree } from "../../web/src/lib/talents/rules";
import type { TalentCatalog, TalentNode } from "../../web/src/lib/talents/types";
import { moreLine, talentBuildUrl, talentsUrl } from "./page-urls.js";
import { siteCatalog } from "./talents/site-catalogs.js";

/**
 * talent_tree and talent_plan: the calculator's trees and share codes, answered from the same catalog
 * and rules the page uses (web/src/lib/talents). Game-file data, found in game files, unconfirmed; every
 * answer carries the build and ends with Blizzard's credit, like item_categories.
 */

type Answer = { text: string; structured: object };

const isTalentClass = (slug: string): slug is TalentClass => (TALENT_CLASSES as readonly string[]).includes(slug);

function nodeOut(n: TalentNode): TalentNodeOut {
  return {
    id: n.id, treeId: n.treeId, row: n.row, col: n.col, kind: n.kind, maxRanks: n.maxRanks,
    talents: n.entries.map((e) => ({ name: e.name, spellId: e.spellId, ...(e.maxRanks !== undefined ? { maxRanks: e.maxRanks } : {}) })),
    prereqs: n.prereqs,
    ...(n.anyOf ? { anyOf: n.anyOf } : {}),
    ...(n.unlock ? { gate: n.unlock } : {}),
  };
}

const stampOf = (catalog: TalentCatalog) => `${catalog.label}; build ${catalog.build}`;

function nodeLine(n: TalentNode, nodes: Map<number, TalentNode>): string {
  const name = n.kind === "choice" ? n.entries.map((e) => e.name).join(" / ") : n.entries[0].name;
  const parts = [`${name} (${n.maxRanks})`];
  const needs = [...n.prereqs, ...(n.anyOf ?? [])].map((id) => nodes.get(id)?.entries[0].name).filter(Boolean);
  if (needs.length > 0) parts.push(`after ${needs.join(n.anyOf?.length ? " or " : " and ")}`);
  if (n.unlock?.pointsInTree) parts.push(`needs ${n.unlock.pointsInTree} in tree${n.unlock.scope === "unconfirmed" ? ", unconfirmed" : ""}`);
  if (n.unlock?.pointsTotal) parts.push(`needs ${n.unlock.pointsTotal} spent`);
  for (const r of n.unlock?.ranksInNodes ?? []) parts.push(`needs ${r.ranks} in ${nodes.get(r.nodeId)?.entries[0].name ?? `node ${r.nodeId}`}`);
  return parts.join(", ");
}

export function handleTalentTree(args: McpToolArgs<"talent_tree">): Answer {
  const catalog = siteCatalog(args.class);
  const wanted = args.tree?.trim().toLowerCase();
  const trees = wanted ? catalog.trees.filter((t) => t.name.toLowerCase() === wanted) : catalog.trees;
  const nodes = nodeMap(catalog);
  const picked = catalog.nodes.filter((n) => trees.some((t) => t.id === n.treeId));
  const lines = [`${catalog.className} talents (${stampOf(catalog)}). Points: ${catalog.rules.pointLevels?.length ?? 0} by level ${catalog.rules.maxLevel}. First point at level ${catalog.rules.firstPointLevel} (Talented moves it as early as 5); ${catalog.rules.pointLevels?.length ?? 0} points either way.`];
  if (wanted && trees.length === 0) {
    lines.push(`No tree named ${args.tree} for ${catalog.className}. Trees: ${catalog.trees.map((t) => t.name).join(", ")}.`);
  }
  for (const tree of trees) {
    const own = picked.filter((n) => n.treeId === tree.id);
    lines.push("", `${tree.name} (${own.length} nodes)`);
    const rows = [...new Set(own.map((n) => n.row))].sort((a, b) => a - b);
    for (const row of rows) lines.push(`  row ${row}: ${own.filter((n) => n.row === row).map((n) => nodeLine(n, nodes)).join("; ")}`);
  }
  // The calculator shows the node ids a share code names.
  const url = talentsUrl(args.class);
  lines.push(moreLine(url), GAME_DATA_CREDIT);
  return {
    text: lines.join("\n"),
    structured: {
      label: catalog.label, build: catalog.build, class: args.class, className: catalog.className, specId: catalog.specId,
      points: { firstPointLevel: catalog.rules.firstPointLevel, maxLevel: catalog.rules.maxLevel, total: catalog.rules.pointLevels?.length ?? 0, pointLevels: catalog.rules.pointLevels ?? [] },
      trees: trees.map((t) => ({ id: t.id, name: t.name, nodes: picked.filter((n) => n.treeId === t.id).length })),
      nodes: picked.map(nodeOut),
      credit: GAME_DATA_CREDIT,
      url,
    },
  };
}

const LABEL = "found in game files, unconfirmed";

export function handleTalentPlan(args: McpToolArgs<"talent_plan">): Answer {
  const fail = (message: string): Answer => ({ text: `${message}\n${GAME_DATA_CREDIT}`, structured: { ok: false, message, label: LABEL, credit: GAME_DATA_CREDIT } });
  const code = extractCode(args.code);
  // The value must read as a code whole, in the calculator's words when it does not. importCode reads links too, and
  // would find a code inside a value that is not one.
  const decoded = decodeBuild(code);
  if (!decoded.ok) return fail(DECODE_MESSAGES[decoded.error]);
  if (!isTalentClass(decoded.build.classSlug)) {
    return fail(`The code names a class without a talent catalog: ${decoded.build.classSlug}. Classes: ${TALENT_CLASSES.join(", ")}.`);
  }
  const catalog = siteCatalog(decoded.build.classSlug as TalentClass);
  const result = importCode(catalog, code);
  if (!result.ok) return fail(result.message);
  const nodes = nodeMap(catalog);
  const talents = Object.entries(result.ranks)
    .map(([id, r]) => ({ id: Number(id), r, node: nodes.get(Number(id))! }))
    .sort((a, b) => a.node.treeId - b.node.treeId || a.node.row - b.node.row || a.node.col - b.node.col)
    .map(({ id, r, node }) => ({
      id, treeId: node.treeId, name: node.kind === "choice" ? node.entries[r.choice ?? 0]?.name ?? node.entries[0].name : node.entries[0].name,
      rank: r.rank, maxRanks: node.maxRanks, ...(r.choice !== undefined ? { choice: r.choice } : {}),
    }));
  const byTree = [...pointsByTree(catalog, result.ranks)].map(([id, points]) => ({ id, name: catalog.trees.find((t) => t.id === id)?.name ?? `tree ${id}`, points }));
  const pointsSpent = byTree.reduce((sum, t) => sum + t.points, 0);
  const link = `${SITE}/tools/talents/${catalog.classSlug}#plan=${code}`;
  const lines = [
    `${catalog.className} plan: ${pointsSpent} ${pointsSpent === 1 ? "point" : "points"}, level ${result.minLevel} at least. ${byTree.map((t) => `${t.name} ${t.points}`).join(", ")}. Made on build ${result.report.codeBuild}; trees from build ${result.report.treeBuild} (${LABEL}).`,
  ];
  for (const tree of byTree.filter((t) => t.points > 0)) {
    lines.push(`${tree.name}: ${talents.filter((t) => t.treeId === tree.id).map((t) => `${t.name} ${t.rank}/${t.maxRanks}`).join(", ")}`);
  }
  if (result.report.problems.length > 0) lines.push("", ...result.report.problems.map((p) => `Problem: ${p}`));
  const url = talentBuildUrl(catalog.classSlug, code);
  lines.push(moreLine(url), GAME_DATA_CREDIT);
  return {
    text: lines.join("\n"),
    structured: {
      ok: true, class: catalog.classSlug, className: catalog.className, codeBuild: result.report.codeBuild, treeBuild: result.report.treeBuild,
      pointsSpent, minLevel: result.minLevel, byTree, talents, problems: result.report.problems, link, label: catalog.label, credit: GAME_DATA_CREDIT, url,
    },
  };
}
