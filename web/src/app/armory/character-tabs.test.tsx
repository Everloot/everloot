import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Tabs } from "@/components/ui";
import { armoryCharacter } from "@/lib/armory.fixture";
import { CHARACTER_TABS, EMPTY_TAB, characterTabs } from "./character-tabs";
import { characterProgression, progressionCatalogue } from "@kb/progression";

const at = "2026-11-17T08:00:00.000Z";
const full = armoryCharacter({
  class: "Warlock", classId: 9,
  details: {
    revision: 1,
    statistics: { asOf: at, rows: [{ label: "Intellect", value: 69, percent: false }] },
    talents: { asOf: at, trees: [{ name: "Demonology", points: 14, talents: [{ name: "Unholy Power", rank: 5 }] }] },
    professions: { asOf: at, rows: [{ name: "Alchemy", rank: 66, max: 150 }] },
    achievements: { asOf: at, rows: [{ id: 6, name: "Level 10", completedAt: "2026-11-01T12:26:40.000Z" }] },
    reputations: { asOf: at, rows: [{ id: 530, name: "Darkspear Trolls", standing: "Friendly", tier: 4 }] },
    quests: { asOf: at, completed: [788, 789, 804] },
    playHistory: { asOf: at, ranked: { quests: 791, creatures: 11256, fish: 1993, flights: 152, dungeons: 23 }, groups: [
      { name: "Quests", rows: [{ id: 98, name: "Quests completed", value: 791 }] },
      { name: "Character · Consumables", rows: [{ id: 1125, name: "Bandage used most", value: 31, note: "Triage Bandage" }] },
    ] },
  },
});
// A profile row from before the detail reads: gear and the PvP numbers, nothing else.
const partial = armoryCharacter({ honorableKills: null, pvpRank: null, equipment: [] });

const render = (c = full) => renderToStaticMarkup(<Tabs label="Sheet" tabs={characterTabs(c, { tips: new Map() })} />);
const tabIds = (html: string) => [...html.matchAll(/data-tab-panel="([a-z-]+)"/g)].map((m) => m[1]);
const emptyIds = (html: string) => [...html.matchAll(/data-empty-tab="([a-z-]+)"/g)].map((m) => m[1]);

test("a character with every part stored draws every tab, none of them empty", () => {
  const html = render();
  expect(tabIds(html)).toEqual(CHARACTER_TABS.map(([id]) => id));
  expect(emptyIds(html)).toEqual([]);
  expect(html).toContain('href="/database/items/16846"');
  expect(html).toContain("Unholy Power");
  expect(html).toContain('href="/tools/talents/warlock"');
  expect(html).toContain("Intellect");
  expect(html).toContain("1,234");
  expect(html).toContain('href="/database/achievements/6"');
  expect(html).toContain("66 / 150");
  expect(html).toContain('href="/database/factions/530"');
  expect(html).toMatch(/>3<\/span> completed quests/);
});

test("the strip holds Gear to Quests and nothing that waits on the privacy decision", () => {
  const labels = CHARACTER_TABS.map(([, label]) => label);
  expect(labels).toEqual(["Gear", "Talents", "Stats", "PvP", "Achievements", "Professions", "Reputations", "Quests", "Play history", "Progress"]);
  for (const out of ["Gold", "Completionist", "Alts", "Legacy perks"]) expect(labels).not.toContain(out);
});

test("Progress always holds the full catalogue and renders only the permitted history supplied by its loader", () => {
  const catalogue = progressionCatalogue({ entrances: [], encounters: [] });
  const unknown = render();
  expect([...unknown.matchAll(/data-progression-instance=/g)]).toHaveLength(catalogue.length);
  expect(unknown).toContain("no data from this character");
  const progress = characterTabs(full, { tips: new Map(), progression: {
    instances: characterProgression(catalogue, [{ instanceMapId: 33, encounterId: 2748, lastKillAt: at }]),
    links: { 33: "/database/instances/33-shadowfang-keep" },
  } }).find((t) => t.id === "progress")!;
  const html = renderToStaticMarkup(<>{progress.panel}</>);
  expect(html).toContain("1 / 8 bosses");
  expect(html).toContain(">partial</span>");
  expect(html).toContain('href="/database/instances/33-shadowfang-keep"');
});

test("a character with partial data keeps every tab, and each empty one says why in one sentence", () => {
  const html = render(partial);
  expect(tabIds(html)).toEqual(CHARACTER_TABS.map(([id]) => id));
  expect(emptyIds(html)).toEqual(CHARACTER_TABS.filter(([id]) => id !== "progress").map(([id]) => id));
  for (const sentence of Object.values(EMPTY_TAB)) {
    expect(html).toContain(sentence.replaceAll("'", "&#x27;"));
    expect(sentence.match(/[.!?]/g)).toHaveLength(1);
  }
  expect(EMPTY_TAB.talents).toBe("The last read from Blizzard's API did not include talents for this character.");
  // No paper doll of empty slots when nothing was equipped.
  expect(html).not.toContain("data-equipment-slot");
});

test("gear and PvP from the profile row show without any detail read", () => {
  const html = render(armoryCharacter());
  expect(emptyIds(html)).toEqual(["talents", "stats", "achievements", "professions", "reputations", "quests", "history"]);
  expect(html).toContain("data-equipment-slot");
  expect(html).toContain("1,234");
});

test("an achievements read with nothing completed says so, not that it was missing", () => {
  const html = render(armoryCharacter({ details: { revision: 1, achievements: { asOf: at, rows: [] }, reputations: { asOf: at, rows: [] } } }));
  expect(html).toContain("None completed when it was read.");
  expect(emptyIds(html)).not.toContain("achievements");
  expect(emptyIds(html)).toContain("reputations");
});

test("play history shows the six ranked counts, an unread one as Not read, then every group with its notes", () => {
  const panel = characterTabs(full, { tips: new Map(), historyRanks: [{ metric: "fish-caught", rank: 2, of: 40, href: "/armory/rankings/fish-caught?ruleset=2&region=eu" }] })
    .find((t) => t.id === "history")!;
  const html = renderToStaticMarkup(<>{panel.panel}</>);
  for (const text of ["Quests completed", "791", "Fish caught", "1,993", "Dungeons entered", "Character · Consumables", "Bandage used most", "Triage Bandage"]) expect(html, text).toContain(text);
  // No deaths count was read: the headline says so instead of a 0.
  expect(html).toMatch(/Deaths<\/dt><dd[^>]*>(<span[^>]*>)?Not read/);
  expect(html).toContain('href="/armory/rankings/fish-caught?ruleset=2&amp;region=eu"');
  expect(html).toContain("#2 of 40");
});

test("a character read before play history, or with none to read, has the tab saying it was not read", () => {
  expect(emptyIds(render(partial))).toContain("history");
  const none = armoryCharacter({ details: { revision: 1, playHistory: { asOf: at, groups: [], ranked: {} } } });
  expect(emptyIds(render(none))).toContain("history");
});
