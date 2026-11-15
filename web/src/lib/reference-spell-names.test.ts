import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/game-assets", () => ({ loadSpellNames: vi.fn(), loadSiteAssets: vi.fn() }));
import { loadSpellNames, loadSiteAssets } from "@/lib/game-assets";
import { loadReferenceSpells } from "./reference-spell-names";
import { starterMacros } from "@/data/reference-spells";

test("private names and tooltip fallback form macros; unavailable names omit them", async () => {
  vi.mocked(loadSpellNames).mockResolvedValue({ version: "test", names: new Map([[12328, "Example private name"]]) });
  vi.mocked(loadSiteAssets).mockResolvedValue({ spellTips: new Map([[20216, { name: "Example fallback" }]]), talents: new Map([[134820, { text: "Private restrictions" }]]) } as never);
  const layouts = await loadReferenceSpells();
  expect(starterMacros(layouts).map((m) => m.text)).toEqual(["/cast Example private name", "/cast Example fallback"]);
  expect(layouts.paladin.cooldowns?.evidence).toBe("Private restrictions");
  expect(layouts.mage.cooldowns?.name).toBeUndefined();
  vi.mocked(loadSpellNames).mockResolvedValue(null);
  vi.mocked(loadSiteAssets).mockResolvedValue(null);
  expect(starterMacros(await loadReferenceSpells())).toEqual([]);
});
