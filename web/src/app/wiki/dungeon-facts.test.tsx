import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { DungeonFacts } from "@/lib/wiki-dungeon";
import { DungeonBosses, DungeonGlance } from "./dungeon-facts";

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
