import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
// The game files' spell names and whether upload storage answered; no names file and storage down unless a test sets them.
const files = vi.hoisted(() => ({ spells: null as { version: string; names: Map<number, string> } | null, unreachable: true, wiki: null as import("@/lib/wiki-entity-names").WikiEntityNames | null, assets: null as unknown, setNames: null as { version: string; names: Map<number, string> } | null }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSpellNames: async () => files.spells,
  loadSiteAssets: async () => files.assets,
  loadItemTips: async () => new Map(),
  loadItemSetNames: async () => files.setNames,
}));
// The items the item name rule lets a page show; none unless a test names some.
const shown = vi.hoisted(() => ({ items: new Map<number, string>() }));
vi.mock("@/lib/shown-item-names", () => ({
  loadShownNames: async () => ({
    agreed: shown.items, matched: null, degraded: false,
    named: { has: (id: number) => shown.items.has(id) }, showsTip: (id: number) => shown.items.has(id),
  }),
}));
vi.mock("@/lib/edges", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/edges")>();
  return { ...real, loadEdges: async () => ({ observed: [], client: real.CLIENT_EDGES, unreachable: files.unreachable, dataAsOf: null }) };
});

vi.mock("@/lib/wiki-entity-names", async (original) => ({ ...await original<typeof import("@/lib/wiki-entity-names")>(), loadWikiEntityNames: async () => files.wiki }));
import SpellPage, { generateMetadata } from "./page";
import { CLIENT_EDGES } from "@/lib/edges";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "@/lib/seo";

afterEach(() => { files.spells = null; files.unreachable = true; files.wiki = null; files.assets = null; files.setNames = null; shown.items = new Map(); });

const props = (id: string) => ({ params: Promise.resolve({ id }) });
const render = async (id: string) => renderToStaticMarkup(await SpellPage(props(id)));
// A spell the client layer says a profession teaches, and one only an item's "created by" points at.
const taught = CLIENT_EDGES.find((e) => e.fromKind === "spell" && e.rel === "in_skill_line")!.fromId;
const creator = CLIENT_EDGES.find((e) => e.toKind === "spell" && e.rel === "created_by" && !CLIENT_EDGES.some((x) => x.fromKind === "spell" && x.fromId === e.toId))!.toId;
// A spell the items say it creates and costs: both edges point from the item to the spell, and none starts at it.
const crafted = CLIENT_EDGES.find((e) => e.rel === "created_by"
  && CLIENT_EDGES.some((x) => x.rel === "reagent_for" && x.toId === e.toId)
  && !CLIENT_EDGES.some((x) => x.fromKind === "spell" && x.fromId === e.toId))!.toId;
const into = (rel: string) => CLIENT_EDGES.filter((e) => e.toKind === "spell" && e.toId === crafted && e.rel === rel).map((e) => e.fromId);
const known = (names: [number, string][]) => {
  files.spells = { version: "1.60.1.70532", names: new Map(names) };
  files.unreachable = false;
};

test("a spell page says what it is, in short, and names the build it was read from", async () => {
  const page = await render("1234");
  expect(page).toContain("In short");
  expect(page).toContain("Build");
  expect(page).toContain("Copy for AI");
  // The page says where the numbers come from, the way every other database page does.
  expect(page).toContain('href="/database#reading"');
});

test("a spell page is not indexed before it has a name", async () => {
  expect(await render("1234")).toContain("Spell 1234");
  expect((await generateMetadata(props("1234"))).robots).toMatchObject({ index: false, follow: true });
});

test("an id the game files, the uploads and the relations know nothing about is a 404, not an empty page", async () => {
  known([[taught, "Some Craft"]]);
  await expect(render("999999999")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(generateMetadata(props("999999999"))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("without the names file or with storage out of reach, no id is ruled out", async () => {
  files.unreachable = false;
  expect(await render("999999999")).toContain("Spell 999999999");
  known([]);
  files.unreachable = true;
  expect((await generateMetadata(props("999999999"))).robots).toMatchObject({ index: false });
});

test("a known spell with nothing past its name is noindex; one with a relation is indexed", async () => {
  known([[1234, "Name Only"], [taught, "Some Craft"]]);
  expect(await render("1234")).toContain("Name Only");
  expect((await generateMetadata(props("1234"))).robots).toMatchObject({ index: false, follow: true });
  expect((await generateMetadata(props(String(taught)))).robots).toMatchObject({ index: true, follow: true });
});

test("a spell only an item points at is known, and without a name it is noindex", async () => {
  known([]);
  expect(await render(String(creator))).toContain(`Spell ${creator}`);
  expect((await generateMetadata(props(String(creator)))).robots).toMatchObject({ index: false });
});

test("Creates and Costs list the items whose edges point at the spell", async () => {
  const [made, reagents] = [into("created_by"), into("reagent_for")];
  expect(made.length).toBeGreaterThan(0);
  expect(reagents.length).toBeGreaterThan(0);
  const page = await render(String(crafted));
  for (const item of [...made, ...reagents]) expect(page).toContain(`href="/database/items/${item}"`);
  expect(page).toContain('data-tab-panel="creates"');
  expect(page).toContain('data-tab-panel="costs"');
  // Nothing teaches it in the files, and no player report could: the empty tab is left out rather than shown empty.
  expect(page).not.toContain('data-tab-panel="taught-by"');
  expect(page).toContain(`The files say it creates ${made.length} ${made.length === 1 ? "item" : "items"} and costs ${reagents.length}`);
});

test("a spell the files relate to nothing gets one plain line naming the build, never the addon link or the meter", async () => {
  known([[1234, "Name Only"]]);
  const page = await render("1234");
  expect(page).toMatch(/The game files list nothing here \(build 1\.60\.1\.\d+\)\./);
  expect(page).not.toContain('role="tab"');
  expect(page).not.toContain("Get the addon");
  expect(page).not.toContain("data-agreement");
  // A spell that creates and costs nothing leaves those quick facts out, as every other empty fact is, rather than a "0".
  expect(page).not.toMatch(/>Creates(?:<[^>]*>)*\s*0/);
  expect(page).not.toMatch(/>Costs(?:<[^>]*>)*\s*0/);
  expect(page).not.toContain(">Creates<");
  expect(page).not.toContain(">Costs<");
  // The name comes from the game files, so the summary says so rather than that players agree on it.
  expect(page).toContain("The name is shown from the game files; players have not reported it yet.");
  expect(page).not.toContain("Players agree on the name.");
});

test("a named spell is titled like the other database pages, with the brand added once by the layout", async () => {
  // Without a name the title stays the id, as before.
  expect((await generateMetadata(props("1234"))).title).toBe("Spell 1234");
  known([[taught, "Some Craft"]]);
  const m = await generateMetadata(props(String(taught)));
  expect(m.title).toBe("Some Craft – WoW Forever spell");
  expect(m.description).toContain("Some Craft is a spell in WoW: Forever.");
  expect(m.description).toContain(`Spell ID ${taught}.`);
  expect((m.openGraph as { title?: string }).title).toBe("Some Craft – WoW Forever spell · Everloot");
  expect((m.twitter as { card?: string }).card).toBe("summary_large_image");
});

test("a long spell name still leaves a description within the limits", async () => {
  const long = "Greater Blessing of the Ancient Watchers of the Emerald Dream";
  known([[taught, long]]);
  const description = String((await generateMetadata(props(String(taught)))).description);
  expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  expect(description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
  expect(description).toContain(long);
  // At the name length where the full form first overruns, the short form must still clear the minimum.
  const boundary = "Enchant Weapon - Lesser Strikingxxxxx".slice(0, 37 - String(taught).length);
  known([[taught, boundary]]);
  const edge = String((await generateMetadata(props(String(taught)))).description);
  expect(edge).not.toContain("from the game files");
  expect(edge.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  expect(edge.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
});

test("a named spell whose only relations are what it creates and costs is indexed", async () => {
  known([[crafted, "Some Recipe"]]);
  expect((await generateMetadata(props(String(crafted)))).robots).toMatchObject({ index: true, follow: true });
});

test("a spell only the talent trees hold shows where it sits, says index, and links its class's calculator", async () => {
  // Arcane Power: a Mage talent no item, skill line or report relates to.
  const { loadSpellTalents } = await import("@/lib/talents/spell-talents");
  const [talent] = (await loadSpellTalents()).get(12042)!;
  expect(CLIENT_EDGES.some((e) => (e.fromKind === "spell" && e.fromId === 12042) || (e.toKind === "spell" && e.toId === 12042))).toBe(false);
  known([[12042, "Arcane Power"]]);
  const page = await render("12042");
  expect(page).toContain('data-tab-panel="talent"');
  expect(page).toContain('href="/tools/talents/mage"');
  expect(page).toContain(`>${talent!.tree}<`);
  expect(page).toContain(`From the talent catalog, build ${talent!.build}`);
  expect(page).not.toContain("The game files list nothing here");
  expect((await generateMetadata(props("12042"))).robots).toMatchObject({ index: true, follow: true });
  // Without a name it stays noindex, as every other spell does.
  known([]);
  expect((await generateMetadata(props("12042"))).robots).toMatchObject({ index: false });
});

test("an unnamed spell uses the labelled wiki name, while a current file name wins", async () => {
  files.wiki = { version: "x", names: new Map([[taught, { name: "Wiki spell", wikiPage: "https://warcraft.wiki.gg/wiki/Wiki_spell" }]]) };
  const page = await render(String(taught));
  expect(page).toContain('title="Name from the Warcraft Wiki"');
  expect(page).toContain('"name":"Wiki spell"');
  expect((await generateMetadata(props(String(taught)))).title).toContain("Wiki spell");
  known([[taught, "Current spell"]]);
  expect(await render(String(taught))).not.toContain('title="Name from the Warcraft Wiki"');
});

test("a spell page shows the spell's icon in its header when the manifest has one, and no icon when not", async () => {
  files.assets = { spellIcons: new Map([[taught, "https://a.test/icons/136243.webp"]]), spellTips: new Map() };
  const header = (page: string) => page.split("data-entity-header")[1]?.split("</header>")[0] ?? "";
  expect(header(await render(String(taught)))).toContain('src="https://a.test/icons/136243.webp"');
  expect(header(await render(String(creator)))).not.toContain("data-game-icon");
});

// The spell numbers below are the committed client-spells.json of build 1.60.1.71139.
const box = (page: string) => page.split("data-tooltip-frame")[1]?.split("</section>")[0] ?? "";
const panel = (page: string, id: string) => page.split(`data-tab-panel="${id}"`)[1]?.split("data-tab-panel=")[0] ?? "";

test("the tooltip box lays out cost and range, then cast time, as the game does, with the rank and the school", async () => {
  known([[133, "Fireball"], [143, "Fireball"]]);
  const page = await render("133");
  const tip = box(page);
  expect(tip).toMatch(/data-tip-pair[^>]*>(?:<[^>]*>)*30 Mana(?:<[^>]*>)*, (?:<[^>]*>)*35 yd range/);
  expect(tip).toContain("1.5 sec cast");
  // The files link no other rank to this Fireball (SkillLineAbility.SupercedesSpell is 0), so no rank is claimed.
  expect(tip).not.toContain("Rank ");
  expect(tip).toMatch(/School:(?:<[^>]*>)*\s*Fire/);
  expect(tip).toMatch(/Duration:(?:<[^>]*>)*\s*4 sec/);
  // Quick facts: the school, the spell level and the class whose skill line lists it, linked.
  expect(page).toMatch(/School(?:<[^>]*>)*Fire/);
  expect(page).toMatch(/Spell level(?:<[^>]*>)*1</);
  expect(page).toContain('href="/classes/mage"');
});

test("rage costs read in rage, melee range says so, and a cooldown shows on the right", async () => {
  known([[78, "Heroic Strike"], [20271, "Judgement"]]);
  const strike = box(await render("78"));
  expect(strike).toContain("15 Rage");
  expect(strike).toContain("Melee Range");
  expect(strike).toContain("Instant");
  const judgement = box(await render("20271"));
  expect(judgement).toContain("6% of base mana");
  expect(judgement).toMatch(/Instant(?:<[^>]*>)*, (?:<[^>]*>)*10 sec cooldown/);
});

test("the Ranks tab lists every rank the skill lines link, lowest first, with this one marked", async () => {
  // Sunder Armor: each rank's SkillLineAbility row names the rank it replaces (7386 → 7405 → 8380 → 11596 → 11597).
  known([[7386, "Sunder Armor"], [7405, "Sunder Armor"], [11597, "Sunder Armor"]]);
  const page = await render("7405");
  const ranks = panel(page, "ranks");
  expect(ranks).toContain('href="/database/spells/7386"');
  expect(ranks).toContain('href="/database/spells/11597"');
  expect(ranks.indexOf("/database/spells/7386")).toBeLessThan(ranks.indexOf("Rank 2"));
  expect(ranks.indexOf("Rank 2")).toBeLessThan(ranks.indexOf("/database/spells/11597"));
  expect(ranks).toContain('aria-current="true"');
  expect(ranks).not.toContain('href="/database/spells/7405"');
  expect(box(page)).toContain("Rank 2");
});

test("a talent spell shows its cooldown, school and dispel type, and no spell level the trees already gate", async () => {
  known([[12042, "Arcane Power"]]);
  const page = await render("12042");
  expect(box(page)).toContain("3 min cooldown");
  expect(page).toMatch(/School(?:<[^>]*>)*Arcane/);
  expect(page).toMatch(/Dispel type(?:<[^>]*>)*Magic/);
  expect(page).not.toContain("Spell level");
  expect(page).toContain('data-tab-panel="talent"');
});

test("a talent spell with no spell tooltip uses its talent's text and icon from the calculator's manifest", async () => {
  const { loadSpellTalents } = await import("@/lib/talents/spell-talents");
  const [talent] = (await loadSpellTalents()).get(12042)!;
  files.assets = {
    spellIcons: new Map(), spellTips: new Map(),
    talents: new Map([[talent!.definitionId, { name: "Arcane Power", text: "For the next 15 sec, your spells deal 30% more damage.", partial: false, icon: "https://a.test/icons/136048.webp" }]]),
  };
  known([[12042, "Arcane Power"]]);
  const page = await render("12042");
  expect(box(page)).toContain("For the next 15 sec, your spells deal 30% more damage.");
  expect(page.split("data-entity-header")[1]?.split("</header>")[0]).toContain('src="https://a.test/icons/136048.webp"');
});

test("the Items tab lists only the items the name rule shows, with how each casts the spell", async () => {
  known([[430, "Drink"]]);
  shown.items = new Map([[159, "Refreshing Spring Water"]]);
  const items = panel(await render("430"), "items");
  expect(items).toContain('href="/database/items/159"');
  expect(items).toContain("Refreshing Spring Water");
  expect(items).toMatch(/>Use</);
  // An item the rule does not show yet is left out, not listed by its id.
  expect(items).not.toContain('href="/database/items/2071"');
  expect(items).toContain("not shown yet");
  // A development leftover is left out and counted, as the item set pages do.
  shown.items = new Map([[159, "Refreshing Spring Water"], [2071, "Deprecated Mountain Spring Water"]]);
  const leftover = panel(await render("430"), "items");
  expect(leftover).not.toContain('href="/database/items/2071"');
  expect(leftover).toContain("1 item the game files mark as a development item is left out.");
  // With none shown, the tab says how many the files list and names none.
  shown.items = new Map();
  const none = panel(await render("430"), "items");
  expect(none).not.toContain('href="/database/items/');
});

test("a mount's spell links its mount, reads its cast time and lasts until cancelled", async () => {
  known([[458, "Brown Horse"]]);
  const page = await render("458");
  expect(panel(page, "mounts")).toContain('href="/database/mounts/6-brown-horse"');
  expect(box(page)).toContain("3 sec cast");
  expect(box(page)).toContain("Until cancelled");
  expect(page).toMatch(/Mechanic(?:<[^>]*>)*Mounted/);
});

test("a set bonus links its set with the pieces it needs, and a companion's spell links the pet", async () => {
  known([[1301126, "Bonus"], [4055, "Mechanical Squirrel"]]);
  files.setNames = { version: "1.60.1.71139", names: new Map([[1, "The Gladiator"]]) };
  const sets = panel(await render("1301126"), "item-sets");
  expect(sets).toContain('href="/database/item-sets/1"');
  expect(sets).toContain("The Gladiator");
  expect(sets).toMatch(/>2</);
  expect(panel(await render("4055"), "pets")).toContain('href="/database/pets/39-mechanical-squirrel"');
});

test("the Effect values tab gives each effect's value the way the talent tooltips resolve it", async () => {
  known([[133, "Fireball"]]);
  const effects = panel(await render("133"), "effects");
  expect(effects).toContain("14 to 22");
  expect(effects).toContain("2 sec");
});

test("a spell the numbers file does not hold gets no invented tooltip lines", async () => {
  known([[1234, "Name Only"]]);
  const tip = box(await render("1234"));
  expect(tip).not.toContain("data-tip-pair");
  expect(tip).not.toContain("Instant");
  expect(tip).not.toContain("School:");
});
