import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
// Quest titles from the private names file; none unless a test sets them.
const titles = vi.hoisted(() => ({ quests: null as unknown }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadQuestNames: async () => titles.quests,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

// Three installs each: NPC 77 is Thrall and drops item 9 (Warchief's Blade); quest 5 is Return to Sender,
// given by NPC 77 and rewarding item 9. Item 10 drops from NPC 77 too, but nobody has named it.
const installs = ["install-a", "install-b", "install-c"];
const records = installs.flatMap((installId) => [
  { kind: "loot", eventId: `${installId}:77:1`, installId, capturedAt: "2026-10-09T00:00:00.000Z", sourceNpcId: 77, sourceEvidence: "loot-api", items: [{ itemId: 9, count: 1 }, { itemId: 10, count: 1 }] },
  { kind: "item_seen", installId, itemId: 9, name: "Warchief's Blade" },
  { kind: "npc_sighting", installId, npcId: 77, name: "Thrall", mapId: 1, x: 50, y: 50, positionKind: "npc" },
  { kind: "quest", installId, questId: 5, title: "Return to Sender", level: 10, giverNpcId: 77, turnInNpcId: 77, rewardItemIds: [9] },
]);

let release = "";
beforeAll(async () => { release = await buildLoreRelease(); });
beforeEach(() => store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records, dataAsOf: "2026-10-09T00:00:00.000Z" }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); titles.quests = null; });

async function npcPage() {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  const { default: Page } = await import("./npcs/[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "77" }) }));
}
async function questPage(id = "5") {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  const { default: Page } = await import("./quests/[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }));
}

test("an NPC's drop list names the items players agree on and keeps the id for one nobody named", async () => {
  const page = await npcPage();
  expect(page).toContain('href="/database/items/9"');
  expect(page).toMatch(/<a href="\/database\/items\/9"[^>]*>Warchief&#x27;s Blade<\/a>/);
  expect(page).toMatch(/<a href="\/database\/items\/10"[^>]*>Item 10<\/a>/);
  expect(page).not.toMatch(/>Item 9</);
});

test("an NPC page with a matching lore page shows a Lore section: the first paragraph and a link", async () => {
  const page = await npcPage();
  expect(page).toContain('id="lore"');
  expect(page).toContain("Thrall is the former Warchief of the Horde.");
  expect(page).toContain('href="/lore/1-thrall"');
  expect(page).not.toContain("Son of Durotan");
});

test("a quest page names its giver, turn-in and reward, and shows the quest's lore", async () => {
  const page = await questPage();
  expect(page).toContain(">Thrall</a>");
  expect(page).not.toContain("Giver NPC 77");
  expect(page).toMatch(/<a href="\/database\/items\/9"[^>]*>Warchief&#x27;s Blade<\/a>/);
  // The lore for the quest is the quest page, not the NPC page of the same name.
  expect(page).toContain("An achievement.");
  expect(page).toContain('href="/lore/5-return-to-sender"');
});

test("a quest nobody has titled takes the Warcraft Wiki's title with the quiet marker; players' title wins", async () => {
  titles.quests = {
    version: "1.60.1.70450", wiki: { name: "Warcraft Wiki", url: "https://warcraft.wiki.gg" },
    names: new Map([[5, { name: "Wiki Return", wikiPage: "https://warcraft.wiki.gg/wiki/Wiki_Return" }], [6, { name: "Wanted: Hogger", wikiPage: "https://warcraft.wiki.gg/wiki/Wanted:_Hogger" }]]),
  };
  const untitled = await questPage("6");
  expect(untitled).toContain("Wanted: Hogger");
  expect(untitled).not.toContain("Quest 6");
  expect(untitled).toContain('data-badge="files"');
  const titled = await questPage("5");
  expect(titled).toContain("Return to Sender");
  expect(titled).not.toContain("Wiki Return");
  expect(titled).not.toContain('data-badge="files"');
});

test("Raw JSON is linked for a quest players reported, and not for one only the wiki names (the API has no card for it)", async () => {
  titles.quests = {
    version: "1.60.1.70450", wiki: { name: "Warcraft Wiki", url: "https://warcraft.wiki.gg" },
    names: new Map([[6, { name: "Wanted: Hogger", wikiPage: "https://warcraft.wiki.gg/wiki/Wanted:_Hogger" }]]),
  };
  expect(await questPage("5")).toContain('href="/api/tooltip/quest/5"');
  const wikiOnly = await questPage("6");
  expect(wikiOnly).toContain("Wanted: Hogger");
  expect(wikiOnly).not.toContain("/api/tooltip/quest/6");
  expect(await npcPage()).toContain('href="/api/tooltip/npc/77"');
});

test("no lore section when no lore page has the name, and none when the archive cannot be opened", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, records: records.map((r) => (r.kind === "npc_sighting" ? { ...r, name: "Nobody Named This" } : r)), dataAsOf: "2026-10-09T00:00:00.000Z" });
  expect(await npcPage()).not.toContain('id="lore"');
  store.loadCorpus.mockResolvedValue({ uploads: 3, records, dataAsOf: "2026-10-09T00:00:00.000Z" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
  vi.stubEnv("KB_SNAPSHOT_PATH", "C:/missing/release.sqlite");
  const { default: Page } = await import("./npcs/[id]/page");
  expect(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "77" }) }))).not.toContain('id="lore"');
});

test("a lore page links back to the database page when players agree on its name", async () => {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  const { default: LorePage } = await import("../lore/[slug]/page");
  const thrall = renderToStaticMarkup(await LorePage({ params: Promise.resolve({ slug: "1-thrall" }) }));
  expect(thrall).toContain('href="/database/npcs/77"');
  expect(thrall).toContain("In the Forever database");
  // A lore page of another type with that name matches its own database type.
  const quest = renderToStaticMarkup(await LorePage({ params: Promise.resolve({ slug: "5-return-to-sender" }) }));
  expect(quest).toContain('href="/database/quests/5"');
  // No agreed name, no link.
  const eagle = renderToStaticMarkup(await LorePage({ params: Promise.resolve({ slug: "7-zul-gurub-eagle" }) }));
  expect(eagle).not.toContain("In the Forever database");
});
