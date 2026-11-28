import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { armoryCharacter } from "@/lib/armory.fixture";
import type { ItemTip } from "@/lib/game-assets";
import { Equipment, PlayHistoryView, ProfileDetailsView, readTimes } from "./profile";

const UNKNOWN = "https://assets.example.test/b/icons/134400.webp";
const tip = (over: Partial<ItemTip> = {}): ItemTip => ({
  name: "Giantstalker's Helmet", color: "#a335ee", quality: "Epic", icon: "https://assets.example.test/b/icons/132111.webp", lines: [], partial: false,
  why: [], label: "found in game files, unconfirmed · build 1", level: 66, required: 60, binding: 1, ...over,
});

test("gear includes every slot, empty states and our item links without a character model", () => {
  const html = renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map()} />);
  expect(html.match(/data-equipment-slot=/g)).toHaveLength(19);
  expect(html).toContain("Not equipped");
  expect(html).toContain('href="/database/items/16846"');
  expect(html).toContain("Giantstalker");
  expect(html).toContain("Main hand");
  // Without the asset files no icon is drawn at all.
  expect(html).not.toContain("data-game-icon");
  expect(html).not.toContain("data-armory-credit");
});

test("an item level from the game files is marked as theirs in its slot, and the gear says why once", () => {
  const html = renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map()} fromFiles={new Set(["MAIN_HAND"])} />);
  expect(html).toContain('aria-label="Item level 69, from the game files"');
  expect(html).toContain('aria-label="Item level 66"');
  expect(html).toContain("Blizzard&#x27;s armory no longer sends item levels");
  expect(renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map()} />)).not.toContain("from the game files");
});

test("the slots sit as a paper doll: left, an empty model space, right, then the weapons", () => {
  const html = renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map()} />);
  const at = (slot: string) => html.indexOf(`data-equipment-slot="${slot}"`);
  expect(html).toContain("data-model-space");
  expect(at("WRIST")).toBeLessThan(html.indexOf("data-model-space"));
  expect(html.indexOf("data-model-space")).toBeLessThan(at("HANDS"));
  expect(at("TRINKET_2")).toBeLessThan(at("MAIN_HAND"));
  expect(html).toContain('aria-label="Weapons"');
});

test("a profile without recorded equipment avoids an empty paper doll and still shows available stats", () => {
  const character = armoryCharacter({ equipment: [] });
  const html = renderToStaticMarkup(<Equipment character={character} tips={new Map()} center={<p>Average item level 58</p>} />);
  expect(html).toContain("Nothing equipped when it was read.");
  expect(html).toContain("Average item level 58");
  expect(html).not.toContain("data-paper-doll");
  expect(html).not.toContain("Not equipped");
});

test("the item link includes its icon and name in one target and describes the tooltip", () => {
  const html = renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map([[16846, tip()]])} unknownIcon={UNKNOWN} />);
  const href = 'href="/database/items/16846"';
  expect(html.split(href)).toHaveLength(2);
  const anchor = html.match(/<a[^>]*href="\/database\/items\/16846"[^>]*>.*?<\/a>/)?.[0];
  expect(anchor).toContain("icons/132111.webp");
  expect(anchor).toContain("Giantstalker");
  expect(anchor).toContain("aria-describedby");
});

test("every equipped slot shows an icon in its quality border: its own art, or the question mark", () => {
  const html = renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map([[16846, tip()]])} unknownIcon={UNKNOWN} />);
  expect(html.match(/data-game-icon/g)).toHaveLength(2);
  expect(html).toContain("icons/132111.webp");
  expect(html).toContain("border-q-epic");
  // The main hand has no tooltip record: the question mark, still in Blizzard's rare border.
  expect(html).toContain(UNKNOWN);
  expect(html).toContain("border-q-rare");
  // A record without art falls back too.
  const noArt = renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map([[16846, tip({ icon: null })]])} unknownIcon={UNKNOWN} />);
  expect(noArt.match(/134400\.webp/g)).toHaveLength(2);
});

test("an item the game files do not know keeps Blizzard's name, gets an armory-only tooltip and no link to a nameless page", () => {
  // Only the head has a game-file tooltip; the main hand (17069) is unknown to the files.
  const html = renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map([[16846, tip()]])} unknownIcon={UNKNOWN} unknown={new Set([17069])} />);
  // Without a tooltip but not known to be missing from the files (a slow or absent bucket), the item keeps its link.
  expect(renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map()} unknownIcon={UNKNOWN} />)).toContain('href="/database/items/17069"');
  const slot = html.slice(html.indexOf('data-equipment-slot="MAIN_HAND"'));
  const mainHand = slot.slice(0, slot.indexOf("</li>"));
  expect(mainHand).toContain("Striker&#x27;s Mark");
  expect(mainHand).not.toContain('href="/database/items/17069"');
  // Its own tooltip, so the shared hover card (which would ask /card/item/17069 and get a 404) never attaches.
  expect(mainHand).toContain("data-item-tip");
  expect(mainHand).toContain("Item level 69");
  expect(mainHand).toContain("Not in the game files yet");
  // A known item still links its page.
  expect(html).toContain('href="/database/items/16846"');
});

test("supported details show their numbers and useful tools; missing categories stay absent", () => {
  const details = { revision: 1 as const, statistics: { asOf: "2026-11-12T12:00:00.000Z", rows: [{ label: "Intellect", value: 69, percent: false }] }, talents: { asOf: "2026-11-12T12:00:00.000Z", trees: [{ name: "Demonology", points: 14, talents: [{ name: "Unholy Power", rank: 5 }] }] }, professions: { asOf: "2026-11-12T12:00:00.000Z", rows: [{ name: "Alchemy", rank: 66, max: 150 }] } };
  const character = armoryCharacter({ class: "Warlock", classId: 9, details });
  const html = renderToStaticMarkup(<ProfileDetailsView character={character} />);
  expect(html).toContain("Intellect");
  expect(html).toContain("Unholy Power");
  expect(html).toContain('href="/tools/talents/warlock"');
  expect(html).toContain("66 / 150");
  expect(html).not.toContain("data-armory-credit");
  expect(readTimes(character)).toEqual(["2026-11-09T10:00:00.000Z", "2026-11-12T12:00:00.000Z", "2026-11-12T12:00:00.000Z", "2026-11-12T12:00:00.000Z"]);
  expect(renderToStaticMarkup(<ProfileDetailsView character={armoryCharacter()} />)).toBe("");
});

test("progress from Blizzard links to our pages, with no credit line per section", () => {
  const at = "2026-11-17T08:00:00.000Z";
  const details = { revision: 1 as const,
    achievements: { asOf: at, rows: [{ id: 6, name: "Level 10", completedAt: "2026-11-01T12:26:40.000Z" }] },
    reputations: { asOf: at, rows: [{ id: 530, name: "Darkspear Trolls", standing: "Friendly", tier: 4 }] },
    quests: { asOf: at, completed: [788, 789, 804] } };
  const html = renderToStaticMarkup(<ProfileDetailsView character={armoryCharacter({ details })} />);
  expect(html).toContain('href="/database/achievements/6"');
  expect(html).toContain("2026-11-01");
  expect(html).toContain('href="/database/factions/530"');
  expect(html).toContain("Friendly");
  expect(html).toMatch(/>3<\/span> completed quests/);
  expect(html).not.toContain("data-armory-credit");
  expect(html).not.toContain("data-disclosure");
  const empty = renderToStaticMarkup(<ProfileDetailsView character={armoryCharacter({ details: { revision: 1, achievements: { asOf: at, rows: [] }, reputations: { asOf: at, rows: [] } } })} />);
  expect(empty).toContain("None completed when it was read.");
  expect(empty).not.toContain("Reputations");
});

test("the newest five achievements stay open; the rest close under a disclosure, grouped by category", () => {
  const at = "2026-11-17T08:00:00.000Z";
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, name: `Deed ${i}`, completedAt: `2026-11-0${i + 1}T12:00:00.000Z` }));
  const categories = new Map([[100, "Quests"], [101, "Exploration"], [102, "Quests"]]);
  const html = renderToStaticMarkup(<ProfileDetailsView character={armoryCharacter({ details: { revision: 1, achievements: { asOf: at, rows } } })} categories={categories} />);
  const [open, closed] = html.split("data-disclosure");
  // Newest first: 107..103 open, 102..100 inside.
  for (const id of [107, 106, 105, 104, 103]) expect(open).toContain(`href="/database/achievements/${id}"`);
  for (const id of [102, 101, 100]) {
    expect(open).not.toContain(`href="/database/achievements/${id}"`);
    expect(closed).toContain(`href="/database/achievements/${id}"`);
  }
  expect(closed).toContain("3 more, by category");
  // Groups by their newest: Quests (102) before Exploration (101); "Other" would go last.
  expect(closed.indexOf('data-achievement-category="Quests"')).toBeLessThan(closed.indexOf('data-achievement-category="Exploration"'));
  expect(closed).not.toContain('data-achievement-category="Other"');
});

test("a linked page's details show play history as its own section, and its read time counts", () => {
  const at = "2026-11-20T08:00:00.000Z";
  const c = armoryCharacter({ details: { revision: 1, playHistory: { asOf: at, ranked: { quests: 791 }, groups: [{ name: "Quests", rows: [{ id: 98, name: "Quests completed", value: 791 }] }] } } });
  const html = renderToStaticMarkup(<ProfileDetailsView character={c} />);
  expect(html).toContain('aria-labelledby="armory-play-history"');
  expect(html).toContain("791");
  expect(readTimes(c)).toContain(at);
});

test("an empty play history adds no section", () => {
  const c = armoryCharacter({ details: { revision: 1, playHistory: { asOf: "2026-11-20T08:00:00.000Z", groups: [], ranked: {} } } });
  expect(renderToStaticMarkup(<ProfileDetailsView character={c} />)).not.toContain("armory-play-history");
});

test("a play-history count of 0 shows without a rank; a count above 0 keeps its rank", () => {
  const html = renderToStaticMarkup(<PlayHistoryView
    history={{ asOf: "2026-11-09T10:00:00.000Z", groups: [], ranked: { deaths: 0, quests: 12 } }}
    ranks={[
      { metric: "deaths", rank: 5705, of: 21422, tied: 15716, href: "/armory/rankings/deaths" },
      { metric: "quests-completed", rank: 90, of: 15620, tied: 0, href: "/armory/rankings/quests-completed" },
    ]}
  />);
  expect(html).not.toContain("/armory/rankings/deaths");
  expect(html).toContain("#90 of 15,620");
});

test("an equipped item's screen-reader description says an amount is missing instead of reading [?]", () => {
  const html = renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map([[16846, tip({ lines: ["Head", "[?] Armor", "+[?] Strength"], partial: true })]])} />);
  const desc = html.match(/<span id="[^"]+-desc" hidden="">([^<]*)<\/span>/)?.[1] ?? "";
  expect(desc).toContain("Armor (amount not in the game files). Strength (amount not in the game files)");
  expect(desc).not.toContain("[?]");
});
