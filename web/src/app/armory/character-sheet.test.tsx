import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { armoryCharacter } from "@/lib/armory.fixture";
import ProgressionMatrix from "@/components/progression/ProgressionMatrix";
import { characterProgression } from "@kb/progression";
import { characterPanel } from "./character-tabs";
import { CharacterFacts, DungeonRaidSlot, SheetSummary } from "./[region]/[slug]/sheet";
import { rankBadges, shownRanks } from "./[region]/[slug]/character-data";

const at = "2026-11-23T14:40:00.000Z";
const noKills = { synced: false, summary: null, instances: [] };
/** Blizzard's play history with a boss-kill group, as Kaz Sneaks's read has. */
const history = { asOf: at, ranked: { quests: 988, dungeons: 42 }, groups: [
  { name: "Dungeons & Raids · Boss Kills", rows: [{ id: 1, name: "Baron Rivendare kills (Stratholme)", value: 4 }] },
  { name: "Quests", rows: [{ id: 98, name: "Quests completed", value: 988 }] },
] };
const kaz = armoryCharacter({ details: { revision: 1, playHistory: history, quests: { asOf: at, completed: [1, 2, 3] } } });

test("the two item levels each say what they are: the ranked 17-slot number and Blizzard's own average", () => {
  const facts = renderToStaticMarkup(<CharacterFacts character={armoryCharacter()} lastRead={null} now={0} />);
  expect(facts).toMatch(/Ranked item level<\/dt><dd[^>]*>57\.41</);
  expect(facts).toContain("17 slots, an empty one counting 0");
  const summary = renderToStaticMarkup(<SheetSummary character={armoryCharacter()} />);
  expect(summary).toMatch(/Blizzard&#x27;s average item level<\/dt><dd[^>]*>58</);
});

test("an item level of 0 while gear is worn shows a dash, not 0", () => {
  const c = armoryCharacter({ level: 1, itemLevel: 0, averageItemLevel: 0 });
  expect(renderToStaticMarkup(<CharacterFacts character={c} lastRead={null} now={0} />)).toMatch(/Ranked item level<\/dt><dd[^>]*><span[^>]*>—</);
  expect(renderToStaticMarkup(<SheetSummary character={c} />)).toMatch(/average item level<\/dt><dd[^>]*><span[^>]*>—</);
});

test("the boss-kill line names its source and points at Blizzard's counts instead of contradicting them", () => {
  const line = renderToStaticMarkup(<DungeonRaidSlot data={noKills} href="#progress" character={kaz} />);
  expect(line).not.toContain("no boss kills are synced for this character");
  expect(line).toContain("no boss kills synced through the Everloot Desktop App");
  expect(line).toContain("Blizzard&#x27;s API lists boss kills in Play history, read 2026-11-23");
  // Without Blizzard's boss-kill counts the line stays one source.
  expect(renderToStaticMarkup(<DungeonRaidSlot data={noKills} href="#progress" character={armoryCharacter()} />)).not.toContain("Play history");
});

test("the Progress tab's empty line names its source and says where Blizzard's kills are", () => {
  const html = renderToStaticMarkup(<>{characterPanel(kaz, "progress", {})}</>);
  expect(html).toContain("No boss kills synced through the Everloot Desktop App for this character yet.");
  expect(html).toContain("Blizzard&#x27;s API lists boss kills in Play history, read 2026-11-23");
});

test("Play history says it is Blizzard's API, when it was read, and why its quest count can differ", () => {
  const html = renderToStaticMarkup(<>{characterPanel(kaz, "history", {})}</>);
  expect(html).toMatch(/From Blizzard&#x27;s API play history, read (?:<[^>]*>)*2026-11-23/);
  expect(html).toContain("completed-quest list");
});

test("a boss count of one reads 1 boss", () => {
  const instances = characterProgression([
    { id: 1, name: "One Room", group: "Dungeons", typeKnown: true, unconfirmed: false, bosses: [{ id: 9, name: "Ogre" }], availability: "open" },
  ], null);
  const html = renderToStaticMarkup(<ProgressionMatrix instances={instances} />);
  expect(html).toContain("1 boss<");
  expect(html).not.toContain("1 bosses");
});

test("below level 10 the Talents tab says there are no talent points yet", () => {
  const html = renderToStaticMarkup(<>{characterPanel(armoryCharacter({ level: 1 }), "talents", {})}</>);
  expect(html).toContain("No talent points before level 10.");
  expect(html).not.toContain("did not include talents");
});

test("the Professions tab links the bars above instead of repeating them", () => {
  const c = armoryCharacter({ details: { revision: 1, professions: { asOf: at, rows: [{ name: "Skinning", rank: 300, max: 300 }] } } });
  const html = renderToStaticMarkup(<>{characterPanel(c, "professions", {})}</>);
  expect(html).not.toContain("<progress");
  expect(html).toContain('href="#armory-overview-professions"');
});

test("a zero count gets no rank: no badge, no PvP rank and no play-history rank for 0", () => {
  const c = armoryCharacter({ honorableKills: 0, details: { revision: 1, playHistory: { ...history, ranked: { quests: 988, deaths: 0 } } } });
  const ranks = [
    { metric: "item_level" as const, rank: 6, of: 20 }, { metric: "honorable_kills" as const, rank: 5705, of: 24403 },
    { metric: "quests_completed" as const, rank: 90, of: 15620 }, { metric: "total_deaths" as const, rank: 4159, of: 15037 },
  ];
  expect(rankBadges(c, ranks).map((b) => b.label)).toEqual(["EU Normal · Item level #6 of 20"]);
  expect(shownRanks(c, ranks).map((r) => r.metric)).toEqual(["item_level", "quests_completed"]);
});

test("reputations are ordered by standing, Exalted first, then by name", () => {
  const c = armoryCharacter({ details: { revision: 1, reputations: { asOf: at, rows: [
    { id: 1, name: "Zandalar Tribe", standing: "Friendly", tier: 4 },
    { id: 2, name: "Orgrimmar", standing: "Exalted", tier: 7 },
    { id: 3, name: "Darkspear Trolls", standing: "Friendly", tier: 4 },
  ] } } });
  const html = renderToStaticMarkup(<>{characterPanel(c, "reputations", {})}</>);
  const order = ["Orgrimmar", "Darkspear Trolls", "Zandalar Tribe"].map((n) => html.indexOf(n));
  expect(order).toEqual([...order].sort((a, b) => a - b));
});
