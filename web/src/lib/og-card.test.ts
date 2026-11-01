import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { CURRENT_BUILD } from "@/data/game-data/raid";
import { emptySlots, encodeRaid } from "@/lib/raid";
import { loadCatalog } from "@/lib/talents/catalogs";
import { encodeBuild } from "@/lib/talents/share";

// The link previews are drawn on each request on the Worker, which has no repository files: reading the fonts from
// node_modules there answered 500 for every shared build and raid (found live 11/01). Run from an empty folder, as
// the Worker is, every card still comes back a PNG. The routes load after the move, so a path worked out when the
// module loads points into the empty folder too.

const PNG = [0x89, 0x50, 0x4e, 0x47];
let cwd = "";
let empty = "";
let raidCard: typeof import("@/app/tools/raid/card/route").GET;
let talentCard: typeof import("@/app/tools/talents/[class]/card/route").GET;
beforeAll(async () => {
  cwd = process.cwd();
  empty = mkdtempSync(join(tmpdir(), "og-card-"));
  process.chdir(empty);
  raidCard = (await import("@/app/tools/raid/card/route")).GET;
  talentCard = (await import("@/app/tools/talents/[class]/card/route")).GET;
});
afterAll(() => {
  process.chdir(cwd);
  rmSync(empty, { recursive: true, force: true });
});

async function expectPng(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 4)]).toEqual(PNG);
}

test("a shared talent build's card, and the class's own when the codes are empty, draw without reading a file", async () => {
  const catalog = await loadCatalog("mage");
  const first = catalog.nodes.find((n) => !n.unlock && n.prereqs.length === 0 && !n.anyOf)!;
  const code = encodeBuild({ classSlug: "mage", specId: 0, build: catalog.build, ranks: { [first.id]: { rank: 1 } } });
  const params = { params: Promise.resolve({ class: "mage" }) };
  await expectPng(await talentCard(new Request(`https://everloot.app/tools/talents/mage/card?a=${encodeURIComponent(code)}&b=-`), params));
  await expectPng(await talentCard(new Request("https://everloot.app/tools/talents/mage/card?a=0&b=-"), params));
});

test("a raid plan's card, and the planner's own without a raid, draw without reading a file", async () => {
  const slots = emptySlots(10);
  slots[0] = { class: "warrior", tree: 3 };
  slots[1] = { class: "priest", tree: 2 };
  await expectPng(await raidCard(new Request(`https://everloot.app/tools/raid/card?c=${encodeURIComponent(encodeRaid({ size: 10, build: CURRENT_BUILD, slots }))}`)));
  await expectPng(await raidCard(new Request("https://everloot.app/tools/raid/card")));
});
