import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GAME_DATA_CREDIT, MCP_TOOLS, TALENT_CLASSES } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { encodeBuild, encodeOrder } from "../../web/src/lib/talents/share";
import { openDb, type DB } from "../src/db.js";
import { importCurated } from "../src/importers/curated.js";
import { createKnowledgeServer } from "../src/mcp-server.js";
import { talentBuildUrl } from "../src/page-urls.js";
import type { ReleaseSource } from "../src/release-db.js";
import { handleTalentPlan, handleTalentTree } from "../src/talent-tools.js";
import { siteCatalog, siteCatalogs } from "../src/talents/site-catalogs.js";

const treeOut = z.object(MCP_TOOLS.talent_tree.outputSchema);
const planOut = z.object(MCP_TOOLS.talent_plan.outputSchema);

const mage = siteCatalog("mage");
/** A legal mage plan: the first node of the first tree at full rank. */
function firstNode() {
  const tree = mage.trees[0];
  return mage.nodes.filter((n) => n.treeId === tree.id).sort((a, b) => a.row - b.row || a.col - b.col)[0];
}
const legalCode = () => encodeBuild({ classSlug: "mage", specId: mage.specId, build: mage.build, ranks: { [firstNode().id]: { rank: firstNode().maxRanks } } });

test("every class catalog the site ships parses, in the protocol's order", () => {
  const catalogs = siteCatalogs();
  expect(catalogs.map((c) => c.classSlug)).toEqual([...TALENT_CLASSES]);
  for (const c of catalogs) {
    expect(c.label).toBe("found in game files, unconfirmed");
    expect(c.nodes.length).toBeGreaterThan(10);
    expect(c.trees.length).toBe(3);
  }
});

test("talent_tree lists every node of the class with the build, the point levels and the credit", async () => {
  const { text, structured } = await handleTalentTree({ class: "mage" });
  const out = treeOut.parse(structured);
  expect(out.nodes.length).toBe(mage.nodes.length);
  expect(out.build).toBe(mage.build);
  expect(out.points.total).toBe(mage.rules.pointLevels?.length);
  expect(out.trees.reduce((sum, t) => sum + t.nodes, 0)).toBe(mage.nodes.length);
  expect(text).toContain(`build ${mage.build}`);
  expect(text).toContain("found in game files, unconfirmed");
  for (const tree of mage.trees) expect(text).toContain(`${tree.name} (`);
  expect(text.endsWith(GAME_DATA_CREDIT)).toBe(true);
  // The calculator page links last, before the credit.
  expect(out.url).toBe("https://everloot.app/tools/talents/mage");
  expect(text.endsWith(`\nMore: https://everloot.app/tools/talents/mage\n${GAME_DATA_CREDIT}`)).toBe(true);
  // A gate and a prerequisite are said in words where the catalog has them.
  const gated = mage.nodes.find((n) => n.unlock?.pointsInTree);
  if (gated) expect(text).toContain(`needs ${gated.unlock!.pointsInTree} in tree`);
  const after = mage.nodes.find((n) => n.prereqs.length > 0);
  if (after) expect(text).toContain("after ");
});

test("talent_tree narrows to one tree by name, case-insensitively, and names the trees when there is no such tree", async () => {
  const tree = mage.trees[1];
  const { structured } = await handleTalentTree({ class: "mage", tree: tree.name.toUpperCase() });
  const out = treeOut.parse(structured);
  expect(out.trees.map((t) => t.id)).toEqual([tree.id]);
  expect(out.nodes.every((n) => n.treeId === tree.id)).toBe(true);
  const none = await handleTalentTree({ class: "mage", tree: "Nothing" });
  expect(none.text).toContain(`No tree named Nothing for Mage. Trees: ${mage.trees.map((t) => t.name).join(", ")}.`);
  expect(treeOut.parse(none.structured).nodes).toEqual([]);
});

test("talent_plan reads a legal code: talents, points per tree, the lowest level, the link, no problems", () => {
  const code = legalCode();
  const { text, structured } = handleTalentPlan({ code });
  const out = planOut.parse(structured);
  expect(out.ok).toBe(true);
  expect(out.class).toBe("mage");
  expect(out.pointsSpent).toBe(firstNode().maxRanks);
  expect(out.minLevel).toBe(mage.rules.pointLevels![firstNode().maxRanks - 1]);
  expect(out.talents).toEqual([{ id: firstNode().id, treeId: firstNode().treeId, name: firstNode().entries[0].name, rank: firstNode().maxRanks, maxRanks: firstNode().maxRanks }]);
  expect(out.byTree!.find((t) => t.id === firstNode().treeId)!.points).toBe(firstNode().maxRanks);
  expect(out.problems).toEqual([]);
  expect(out.link).toBe(`https://everloot.app/tools/talents/mage#plan=${code}`);
  expect(out.codeBuild).toBe(mage.build);
  expect(text).toContain(`${firstNode().entries[0].name} ${firstNode().maxRanks}/${firstNode().maxRanks}`);
  expect(text).not.toContain("Problem:");
  expect(text.endsWith(GAME_DATA_CREDIT)).toBe(true);
  // The build's own link: the calculator on this plan, with a preview card when shared.
  expect(out.url).toBe(`https://everloot.app/tools/talents/mage/b/${code}`);
  expect(text.endsWith(`\nMore: ${out.url}\n${GAME_DATA_CREDIT}`)).toBe(true);
});

test("talent_plan takes a calculator link and says what did not load: another build, an unknown node, a gated node", () => {
  const deep = mage.nodes.find((n) => n.unlock?.pointsInTree)!;
  const code = encodeBuild({ classSlug: "mage", specId: 0, build: "1.0.0.1", ranks: { 999999: { rank: 1 }, [deep.id]: { rank: 1 } } });
  const { text, structured } = handleTalentPlan({ code: `https://everloot.app/tools/talents/mage#plan=${code}` });
  const out = planOut.parse(structured);
  expect(out.ok).toBe(true);
  expect(out.codeBuild).toBe("1.0.0.1");
  expect(out.treeBuild).toBe(mage.build);
  expect(out.problems!.some((p) => p.startsWith("Made on game build 1.0.0.1"))).toBe(true);
  expect(out.problems!.some((p) => p.includes("node 999999"))).toBe(true);
  expect(out.problems!.some((p) => p.startsWith(`${deep.entries[0].name}: 1 point not placed.`))).toBe(true);
  expect(out.pointsSpent).toBe(0);
  for (const p of out.problems!) expect(text).toContain(`Problem: ${p}`);
});

test("talent_plan refuses what it cannot read, in the calculator's words", () => {
  const damaged = handleTalentPlan({ code: "EL1-mage-0-1.60.1.70450-!!!" });
  expect(planOut.parse(damaged.structured).ok).toBe(false);
  expect(damaged.structured).not.toHaveProperty("url");
  expect(damaged.text).toContain("not a share code");
  const newer = handleTalentPlan({ code: "EL9-mage-0-1.60.1.70450-" });
  expect(newer.text).toContain("newer version");
  const other = handleTalentPlan({ code: "EL1-monk-0-1.60.1.70450-" });
  expect(other.text).toContain("without a talent catalog: monk");
  expect(handleTalentPlan({ code: "   " }).text).toContain("Paste a share code");
});

test("talent_plan refuses a link's value that is not a whole code, escaped or raw, even with a code inside it", () => {
  // A warrior code: a value that did not decode fell back to the first class's trees, which loaded the code inside it.
  const warrior = siteCatalog("warrior");
  const node = warrior.nodes.find((n) => !n.unlock && n.prereqs.length === 0 && !n.anyOf)!;
  const code = encodeBuild({ classSlug: "warrior", specId: warrior.specId, build: warrior.build, ranks: { [node.id]: { rank: 1 } } });
  expect(planOut.parse(handleTalentPlan({ code }).structured)).toMatchObject({ ok: true, pointsSpent: 1 });
  for (const link of [`https://everloot.app/tools/talents/warrior#plan=junk%23plan%3D${code}`, `https://everloot.app/tools/talents/warrior#plan=junk#plan=${code}`]) {
    const { text, structured } = handleTalentPlan({ code: link });
    expect(planOut.parse(structured), link).toMatchObject({ ok: false, message: "That share code is damaged or cut short." });
    expect(structured, link).not.toHaveProperty("url");
    expect(text, link).toBe(`That share code is damaged or cut short.\n${GAME_DATA_CREDIT}`);
  }
});

test("talent_plan answers a link that carries spend orders exactly as it answers the same link without them", () => {
  const code = legalCode();
  const node = firstNode();
  const order = encodeOrder({ [node.id]: { rank: node.maxRanks } }, Array<number>(node.maxRanks).fill(node.id), "planned");
  expect(order).toMatch(/^O1p-A+$/);
  const old = `https://everloot.app/tools/talents/mage#plan=${code}&plan2=${code}`;
  expect(handleTalentPlan({ code: `${old}&order=${order}&order2=O1g-A` })).toEqual(handleTalentPlan({ code: old }));
  expect(handleTalentPlan({ code: `${old}&order=O2p-A&order2=O1x-A` })).toEqual(handleTalentPlan({ code: old }));
  expect(handleTalentPlan({ code: old })).toEqual(handleTalentPlan({ code }));
});

test("talent_plan keeps the answer it gave before spend orders: the same fields, and links that carry the code alone", () => {
  const example = "EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg";
  const { text, structured } = handleTalentPlan({ code: `https://everloot.app/tools/talents/mage#plan=${example}&order=O1p-AABCC` });
  expect(Object.keys(structured).sort()).toEqual(["byTree", "class", "className", "codeBuild", "credit", "label", "link", "minLevel", "ok", "pointsSpent", "problems", "talents", "treeBuild", "url"]);
  expect(planOut.parse(structured)).toMatchObject({
    ok: true, class: "mage", codeBuild: "1.60.1.70450", treeBuild: mage.build, pointsSpent: 0, talents: [],
    link: `https://everloot.app/tools/talents/mage#plan=${example}`,
    url: `https://everloot.app/tools/talents/mage/b/${example}`,
  });
  expect(text).toContain("Problem: 3 talents in the code are not in this tree and were left out: node 90001 (2 points), 90002 (1 point), 90004 (2 points).");
  expect(text).not.toMatch(/&order=|O1p-/);
});

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

const STARTER_LABEL = "Everloot team starter build, not observed";
const warriorCatalog = siteCatalog("warrior");

/** A published warrior build: the first node of `treeName` at full rank. */
function warriorBuild(id: string, name: string, treeName: string, purpose: string) {
  const tree = warriorCatalog.trees.find((t) => t.name === treeName)!;
  const node = warriorCatalog.nodes.filter((n) => n.treeId === tree.id && !n.unlock && n.prereqs.length === 0 && !n.anyOf)[0];
  const code = encodeBuild({ classSlug: "warrior", specId: warriorCatalog.specId, build: warriorCatalog.build, ranks: { [node.id]: { rank: node.maxRanks } } });
  const yaml = [
    "- kind: build", `  id: ${id}`, `  name: "${name}"`, "  game_version: forever", "  body: A test build.",
    `  source_url: ${talentBuildUrl("warrior", code)}`, '  retrieved_at: "2026-11-03"', "  data:",
    "    class: warrior", `    tree: ${treeName}`, `    purpose: ${purpose}`, `    share_code: ${code}`,
    `    points: ${node.maxRanks}`, `    build: "${warriorCatalog.build}"`, "    status: published",
  ].join("\n");
  return { code, points: node.maxRanks, yaml };
}

const arms = warriorBuild("warrior-leveling-arms", "Warrior leveling: Arms", "Arms", "leveling");
const protection = warriorBuild("warrior-dungeon-protection", "Warrior dungeon: Protection", "Protection", "dungeon");

/** A release holding the two published warrior builds above. */
async function withStarterBuilds(): Promise<DB> {
  const db = openDb(":memory:");
  databases.push(db);
  const dir = mkdtempSync(join(tmpdir(), "kb-talent-builds-"));
  writeFileSync(join(dir, "builds.yaml"), `${arms.yaml}\n${protection.yaml}\n`);
  expect(await importCurated(db, dir)).toBe(2);
  return db;
}

test("talent_tree with builds lists the class's starter builds with the label, the share code and the build page", async () => {
  const source = await withStarterBuilds();
  const { text, structured } = await handleTalentTree({ class: "warrior", builds: true }, source);
  const out = treeOut.parse(structured);
  expect(out.starterBuilds).toEqual([
    { name: "Warrior dungeon: Protection", purpose: "dungeon", tree: "Protection", shareCode: protection.code, points: protection.points, build: warriorCatalog.build, url: talentBuildUrl("warrior", protection.code), label: STARTER_LABEL },
    { name: "Warrior leveling: Arms", purpose: "leveling", tree: "Arms", shareCode: arms.code, points: arms.points, build: warriorCatalog.build, url: talentBuildUrl("warrior", arms.code), label: STARTER_LABEL },
  ]);
  expect(out.starterBuilds![0].url).toContain("/tools/talents/warrior");
  expect(text).toContain("\nStarter builds (Everloot team, not observed):\n");
  expect(text).toContain(`\n- Warrior leveling: Arms (leveling, Arms, ${arms.points} points, build ${warriorCatalog.build}): ${arms.code} ${talentBuildUrl("warrior", arms.code)}\n`);
  // The tree listing is unchanged, and the calculator link and the credit still close the answer.
  expect(text.startsWith((await handleTalentTree({ class: "warrior" })).text.split("\nMore: ")[0])).toBe(true);
  expect(text.endsWith(`\nMore: https://everloot.app/tools/talents/warrior\n${GAME_DATA_CREDIT}`)).toBe(true);
});

test("talent_tree with builds and a tree narrows the builds, and says which trees have one when none match", async () => {
  const source = await withStarterBuilds();
  const narrowed = treeOut.parse((await handleTalentTree({ class: "warrior", tree: "arms", builds: true }, source)).structured);
  expect(narrowed.starterBuilds!.map((b) => b.name)).toEqual(["Warrior leveling: Arms"]);
  const fury = await handleTalentTree({ class: "warrior", tree: "Fury", builds: true }, source);
  const out = treeOut.parse(fury.structured);
  expect(out.trees.map((t) => t.name)).toEqual(["Fury"]);
  expect(out.starterBuilds).toEqual([]);
  expect(fury.text).toContain("No starter build published yet for Warrior Fury. Builds exist for: Arms, Protection.");
});

test("talent_tree with builds for a class with none says so and invents nothing", async () => {
  const source = await withStarterBuilds();
  const { text, structured } = await handleTalentTree({ class: "mage", builds: true }, source);
  expect(treeOut.parse(structured).starterBuilds).toEqual([]);
  expect(text).toContain("\nNo starter build published yet for Mage.\n");
  expect(text).not.toContain("Builds exist for");
});

test("talent_tree without builds, or with builds false, answers exactly as before", async () => {
  const source = await withStarterBuilds();
  const before = await handleTalentTree({ class: "warrior" });
  expect(await handleTalentTree({ class: "warrior" }, source)).toEqual(before);
  expect(await handleTalentTree({ class: "warrior", builds: false }, source)).toEqual(before);
  expect(before.structured).not.toHaveProperty("starterBuilds");
  // The release is never read unless builds is asked for, so the text and the key order cannot depend on it.
  const tripwire = { get: async () => { throw new Error("release read"); }, all: async () => { throw new Error("release read"); } } as unknown as ReleaseSource;
  for (const args of [{ class: "warrior" as const }, { class: "warrior" as const, builds: false }, { class: "warrior" as const, tree: "Arms" }]) {
    expect(JSON.stringify(await handleTalentTree(args, tripwire))).toBe(JSON.stringify(await handleTalentTree(args)));
  }
});

test("talent_tree takes builds over MCP and returns the declared shape", async () => {
  const source = await withStarterBuilds();
  const server = createKnowledgeServer(source);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const withBuilds = await client.callTool({ name: "talent_tree", arguments: { class: "warrior", builds: true } });
  expect(withBuilds.isError).not.toBe(true);
  expect(treeOut.parse(withBuilds.structuredContent).starterBuilds).toHaveLength(2);
  const without = await client.callTool({ name: "talent_tree", arguments: { class: "warrior" } });
  expect(without.structuredContent).toEqual((await handleTalentTree({ class: "warrior" })).structured);
});

test("both tools answer over MCP with structured content of the declared shape", async () => {
  const db = openDb(":memory:");
  databases.push(db);
  const server = createKnowledgeServer(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const tree = await client.callTool({ name: "talent_tree", arguments: { class: "druid", tree: siteCatalog("druid").trees[0].name } });
  expect(tree.isError).not.toBe(true);
  expect(treeOut.parse(tree.structuredContent)).toMatchObject({ class: "druid", url: "https://everloot.app/tools/talents/druid" });
  const plan = await client.callTool({ name: "talent_plan", arguments: { code: legalCode() } });
  expect(plan.isError).not.toBe(true);
  expect(planOut.parse(plan.structuredContent)).toMatchObject({ ok: true, url: `https://everloot.app/tools/talents/mage/b/${legalCode()}` });
  const bad = await client.callTool({ name: "talent_tree", arguments: { class: "monk" } });
  expect(bad.isError).toBe(true);
});
