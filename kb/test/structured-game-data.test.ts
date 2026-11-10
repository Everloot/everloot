import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GAME_DATA_CREDIT, MCP_TOOLS } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { BRIDGE_PLAN } from "../src/bridge-plan.js";
import { CLIENT_LAYER, CLIENT_TAXONOMY } from "../src/client-layer-file.js";
import { openDb, type DB } from "../src/db.js";
import { buildView, currentForeverInterface, parseRegistry, type ProjectMetrics } from "../src/ecosystem.js";
import { createKnowledgeServer } from "../src/mcp-server.js";

const categoriesOut = z.object(MCP_TOOLS.item_categories.outputSchema);
const ecosystemOut = z.object(MCP_TOOLS.ecosystem_projects.outputSchema);
const planOut = z.object(MCP_TOOLS.everloot_plan.outputSchema);

const NOW = new Date("2026-10-20T12:00:00.000Z");
const metrics: ProjectMetrics = {
  status: "ok", fetchedAt: NOW.toISOString(), stars: 3, archived: false, license: "MIT", lastCommit: "2026-10-19T00:00:00.000Z",
  release: { tag: "v2", date: "2026-10-10T00:00:00.000Z", url: "https://github.com/o/a/releases/tag/v2" }, commits4w: 4, contributors: 1,
  openIssues: 0, closedIssues: 0, medianFirstResponseHours: null, responseSample: 0, interfaces: [16001],
};
const view = () => buildView(
  parseRegistry({ schema: 1, projects: [{ id: "a", name: "Synthetic", kind: "addon", summary: "A synthetic addon.", repo: "o/a", addonNames: ["Synth"], verifiedAt: "2026-10-18", evidence: "https://github.com/o/a" }] }),
  { schema: 1, refreshedAt: NOW.toISOString(), projects: { a: metrics }, history: {} },
  [{ name: "Synth", installs: 6 }], NOW, currentForeverInterface([{ product: "wow_classic_beta", version: "1.60.1.70450", buildId: 70450 }]),
);

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function client(options: Parameters<typeof createKnowledgeServer>[1] = {}) {
  const db = openDb(":memory:");
  databases.push(db);
  const server = createKnowledgeServer(db, options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const c = new Client({ name: "test", version: "0" });
  await c.connect(clientSide);
  return c;
}

test("item_categories: the whole tree, one item's path, a filtered list and a missing class, each structured like its text", async () => {
  const c = await client();
  const tree = categoriesOut.parse((await c.callTool({ name: "item_categories", arguments: {} })).structuredContent);
  expect(tree.build).toBe(CLIENT_LAYER.build.version);
  expect(tree.credit).toBe(GAME_DATA_CREDIT);
  expect(tree.classes!.length).toBe(CLIENT_TAXONOMY.classes.filter((x) => x.items > 0).length);
  expect(tree.classes!.every((x) => x.items > 0 && x.subclasses.every((s) => s.items > 0))).toBe(true);

  const [itemId] = CLIENT_TAXONOMY.items[0];
  const one = await c.callTool({ name: "item_categories", arguments: { item: itemId } });
  const path = categoriesOut.parse(one.structuredContent);
  expect(path.item!.itemId).toBe(itemId);
  expect(path.item!.class).not.toBeNull();
  expect(JSON.stringify(one.content)).toContain(`Item ${itemId}:`);
  expect(categoriesOut.parse((await c.callTool({ name: "item_categories", arguments: { item: 1 } })).structuredContent).item).toBeNull();

  const cls = CLIENT_TAXONOMY.classes.find((x) => x.items > 2)!;
  const listed = categoriesOut.parse((await c.callTool({ name: "item_categories", arguments: { class: cls.slug, limit: 2 } })).structuredContent);
  expect(listed.items!.length).toBe(2);
  expect(listed.total).toBe(cls.items);
  expect(listed.items!.every((i) => i.class?.id === cls.id)).toBe(true);

  const missing = categoriesOut.parse((await c.callTool({ name: "item_categories", arguments: { class: "no-such-class" } })).structuredContent);
  expect(missing.error).toContain("No item class no-such-class");
  expect(missing.items).toBeUndefined();
});

test.each([{ item: 19019 }, { class: "weapons", limit: 2 }])("item_categories output validates against tools/list for %j", async (args) => {
  const c = await client();
  await c.listTools();
  const result = await c.callTool({ name: "item_categories", arguments: args });
  const out = categoriesOut.parse(result.structuredContent);
  const items = out.item ? [out.item] : out.items!;
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) expect(item.class).toMatchObject({ name: "Weapon", label: "Weapons", slug: "weapons" });
});

test("ecosystem_projects: the ranked rows with GitHub facts flattened, and not connected is not an empty list", async () => {
  const ranked = ecosystemOut.parse((await (await client({ ecosystem: view })).callTool({ name: "ecosystem_projects", arguments: { board: "installed" } })).structuredContent);
  expect(ranked.connected).toBe(true);
  expect(ranked.board).toBe("installed");
  expect(ranked.forever).toEqual({ interface: 16001, version: "1.60.1.70450", build: 70450 });
  expect(ranked.projects).toEqual([{
    rank: 1, display: "6 installs", id: "a", name: "Synthetic", kind: "addon", summary: "A synthetic addon.", repo: "o/a", url: "https://github.com/o/a",
    installs: 6, stars: 3, release: metrics.release, lastCommit: metrics.lastCommit, commits4w: 4, foreverReady: "yes",
    badges: ["forever-ready", "active", "fresh-release", "open-license"], maintenanceScore: ranked.projects[0].maintenanceScore,
  }]);
  const all = ecosystemOut.parse((await (await client({ ecosystem: view })).callTool({ name: "ecosystem_projects", arguments: {} })).structuredContent);
  expect(all.projects[0].rank).toBeUndefined();
  expect(all.projects[0].display).toBeUndefined();

  const off = ecosystemOut.parse((await (await client()).callTool({ name: "ecosystem_projects", arguments: {} })).structuredContent);
  expect(off).toEqual({ connected: false, refreshedAt: null, installsAvailable: false, forever: null, board: "all", projects: [] });
});

test("everloot_plan: every tracker row with its status and proof across detail pages, and the counts add up", async () => {
  const c = await client();
  const rows = [];
  let plan: z.infer<typeof planOut> | undefined;
  for (let offset: number | undefined = 0; offset !== undefined; offset = plan.nextOffset) {
    plan = planOut.parse((await c.callTool({ name: "everloot_plan", arguments: { detail: true, offset } })).structuredContent);
    rows.push(...plan.rows);
  }
  const byStatus = (["live", "next", "waiting", "shape"] as const).flatMap((s) => BRIDGE_PLAN.filter((r) => r.status === s));
  expect(rows).toEqual(byStatus);
  plan = planOut.parse((await c.callTool({ name: "everloot_plan", arguments: {} })).structuredContent);
  expect(plan.counts.live + plan.counts.next + plan.counts.waiting + plan.counts.shape).toBe(BRIDGE_PLAN.length);
  expect(plan.counts.live).toBe(BRIDGE_PLAN.filter((r) => r.status === "live").length);
});
