import { expect, test } from "vitest";
import registryFile from "../../../kb/curated/ecosystem.json";
import { ADDON_SOURCES, approvedAddon, curatedAddon } from "./addon-repos";

test("a curated folder matches regardless of case and keeps the map's spelling", () => {
  expect(curatedAddon("polestar")?.name).toBe("Polestar");
  expect(curatedAddon("POLESTAR")?.name).toBe("Polestar");
  expect(curatedAddon("polestar")?.source.repo).toBe(ADDON_SOURCES.Polestar.repo);
});

test("an uncurated folder has no curated source", () => {
  expect(curatedAddon("SomethingElse")).toBeNull();
});

test("an approved addon is the owner's spelling, title and source, whatever case was typed", () => {
  for (const typed of ["Polestar", "polestar", "POLESTAR"]) {
    expect(approvedAddon(typed)).toEqual({ name: "Polestar", title: "Polestar", source: ADDON_SOURCES.Polestar });
  }
});

test("an addon only the ecosystem registry names is approved too, with the registry's repository and no invented links", () => {
  const olympus = approvedAddon("olympus");
  expect(olympus).toEqual({ name: "Olympus", title: "Olympus", source: { repo: "dnl-gentile/olympus-addon" } });
  expect(curatedAddon("Olympus")).toBeNull();
});

test("every folder the registry lists is approved, so no explicitly approved project is dropped", () => {
  const folders = registryFile.projects.flatMap((p) => p.addonNames);
  expect(folders.length).toBeGreaterThan(1);
  for (const folder of folders) expect(approvedAddon(folder)?.name, folder).toBe(folder);
  for (const [folder, source] of Object.entries(ADDON_SOURCES)) expect(approvedAddon(folder)?.source, folder).toEqual(source);
});

test("an addon nobody approved resolves to nothing, however it is spelled or reported", () => {
  for (const name of ["Questie", "SomethingElse", "", "Polestar.Alternate", "Polestar ", "poles"]) expect(approvedAddon(name), name).toBeNull();
});
