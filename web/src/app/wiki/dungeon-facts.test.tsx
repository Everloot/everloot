import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { DungeonFacts } from "@/lib/wiki-dungeon";
import { DungeonBosses, DungeonGlance, DungeonLoadingArt, DungeonRecordedFacts } from "./dungeon-facts";

vi.mock("@/lib/world-map", () => ({ WORLD_MAP: { difficulties: { 1: { name: "Normal", maxPlayers: 5 } } } }));

const facts: DungeonFacts = {
  level: null, href: "/database/instances/36", unreachable: false,
  row: {
    instanceMapId: 36, name: "Test mine", raid: false, difficulty: null, level: null,
    difficulties: [1], files: [], confirmed: [], reported: 0, bosses: [],
    encounters: [{ id: 100, name: "File-only boss" }] as DungeonFacts["row"]["encounters"],
  },
};

test("file-only encounters remain useful before launch without claiming kills or player confirmation", () => {
  const html = renderToStaticMarkup(<DungeonBosses facts={facts} />);
  expect(html).toContain("File-only boss");
  expect(html).toContain('data-badge="files"');
  expect(html).not.toMatch(/0 kills|from 0 installs|last seen/);
});

test("a file-only encounter still appears when player storage is unavailable", () => {
  expect(renderToStaticMarkup(<DungeonBosses facts={{ ...facts, unreachable: true }} />)).toContain("File-only boss");
});

test("difficulty and group capacity come from the files and stay unconfirmed, even without an entrance", () => {
  const html = renderToStaticMarkup(<DungeonGlance facts={facts} />);
  expect(html).toContain("Normal");
  expect(html).toContain("up to 5 players");
  expect(html).toContain('data-badge="files"');
  expect(html).not.toContain("Confirmed difficulty");
});

test("empty recorded sections explain missing evidence and link to upload without claiming no quests or drops", () => {
  const html = renderToStaticMarkup(<DungeonRecordedFacts records={{ loot: [], quests: [], unavailable: false }} />);
  expect(html).toContain("Unrecorded does not mean a boss drops nothing");
  expect(html).toContain("This does not mean there are no quests here");
  expect(html).toContain('href="/upload"');
});

test("a storage failure replaces recorded sections with an unknown-data notice", () => {
  const html = renderToStaticMarkup(<DungeonRecordedFacts records={{ loot: [], quests: [], unavailable: true }} />);
  expect(html).toContain("Player reports are unavailable");
  expect(html).not.toContain("No public");
});

test("recorded panels date the corpus snapshot so older observations are not presented as launch-day play", () => {
  const html = renderToStaticMarkup(<DungeonRecordedFacts records={{ loot: [], quests: [], unavailable: false, dataAsOf: "2026-10-22T01:30:27.923Z" }} />);
  expect(html).toContain("Corpus snapshot: 2026-10-22");
  expect(html).toContain("Recorded observations may be from earlier builds");
});

test("loading art has a credit and no-map caption, while missing art draws nothing", () => {
  expect(renderToStaticMarkup(<DungeonLoadingArt art={null} />)).toBe("");
  const html = renderToStaticMarkup(<DungeonLoadingArt art={{ mapId: 36, name: "Test mine", kind: "dungeon", heldBack: false, url: "https://example.test/loading.webp", width: 1600, small: null }} />);
  expect(html).toContain('href="/methodology#credits"');
  expect(html).toContain("This is not an interior map");
});
