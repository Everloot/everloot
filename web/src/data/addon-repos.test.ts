import { expect, test } from "vitest";
import { ADDON_SOURCES, canonicalAddonName, curatedAddon } from "./addon-repos";

test("a curated folder matches regardless of case and keeps the map's spelling", () => {
  expect(curatedAddon("polestar")?.name).toBe("Polestar");
  expect(curatedAddon("POLESTAR")?.name).toBe("Polestar");
  expect(curatedAddon("polestar")?.source.repo).toBe(ADDON_SOURCES.Polestar.repo);
});

test("an uncurated folder has no approved source", () => {
  expect(curatedAddon("SomethingElse")).toBeNull();
});

test("the canonical name is the curated spelling when the folder is approved", () => {
  expect(canonicalAddonName("polestar", "Polestar.Alternate")).toBe("Polestar");
  expect(canonicalAddonName("POLESTAR", null)).toBe("Polestar");
});

test("an uncurated addon keeps the name its installs report", () => {
  expect(canonicalAddonName("SomethingElse", "Something Else")).toBe("Something Else");
  expect(canonicalAddonName("SomethingElse", null)).toBeNull();
});
