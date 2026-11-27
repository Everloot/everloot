import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseSiteManifest } from "./game-assets";
import { itemIndex, memoryStore, shard0, siteManifest } from "./game-assets.fixture";
import { loadEquippedItems, loadEquippedTips } from "./equipped-item-tips";

const BASE = "https://assets.example.test/wow_classic_beta-70450-84bea423";
const FOLDER = "wow_classic_beta-70450-84bea423";
const store = () => memoryStore({ [`${FOLDER}/items.json`]: itemIndex, [`${FOLDER}/items/0.json`]: { ...shard0, "30": { i: 135661 }, "35": { i: 135145 } } });

test("gear Blizzard reports equipped gets a card: the files' tooltip, else the armory's name with the files' icon, marked unconfirmed", async () => {
  const assets = parseSiteManifest(siteManifest, BASE)!;
  const tips = await loadEquippedTips(assets, [
    { itemId: 9, name: "Linen Cloth", quality: "COMMON" },
    { itemId: 30, name: "Witchblade", quality: "EPIC" },
    { itemId: 31, name: "Nothing In The Files", quality: "RARE" },
  ], store());
  expect(tips.get(9)?.lines.length).toBeGreaterThan(0);
  expect(tips.get(9)?.name).toBe("Linen Cloth");
  expect(tips.get(30)).toMatchObject({
    name: "Witchblade", quality: "Epic", icon: `${BASE}/icons/135661.webp`,
    label: "Name from Blizzard's armory · icon found in game files, unconfirmed · build 1.60.1.70450",
  });
  // Neither a tooltip nor an icon: a plain link, as before.
  expect(tips.has(31)).toBe(false);
});

test("an item is unknown to the files only after a complete read of this build's index finds nothing for it", async () => {
  const items = [{ itemId: 9, name: "Linen Cloth", quality: "COMMON" }, { itemId: 30, name: "Witchblade", quality: "EPIC" }, { itemId: 31, name: "Nothing In The Files", quality: "RARE" }];
  const read = await loadEquippedItems(parseSiteManifest(siteManifest, BASE)!, items, store());
  expect([...read.unknown]).toEqual([31]);
  // No private bucket, or no asset files: nothing is known either way, so nothing is called unknown.
  expect((await loadEquippedItems(parseSiteManifest(siteManifest, BASE)!, items, null)).unknown.size).toBe(0);
  expect((await loadEquippedItems(null, items, store())).unknown.size).toBe(0);
});

test("the game files' item levels come from the files' records only, never from a card built from the armory's own fields", async () => {
  const read = await loadEquippedItems(parseSiteManifest(siteManifest, BASE)!, [
    { itemId: 9, name: "Linen Cloth", quality: "COMMON", level: null },
    { itemId: 25, name: "Worn Shortsword", quality: "RARE", level: null },
    // An icon only in the files: its card carries the armory's level, which is not the files'.
    { itemId: 30, name: "Witchblade", quality: "EPIC", level: 70 },
    { itemId: 31, name: "Nothing In The Files", quality: "RARE", level: null },
  ], store());
  expect([...read.levels]).toEqual([[9, 5], [25, 2]]);
  expect((await loadEquippedItems(null, [{ itemId: 9, name: "Linen Cloth", quality: "COMMON" }], store())).levels.size).toBe(0);
});

test("an item with an icon only gets its type and slot from the client layer", async () => {
  const tips = await loadEquippedTips(parseSiteManifest(siteManifest, BASE)!, [{ itemId: 35, name: "Bent Staff", quality: "COMMON" }], store());
  // Item 35 is [35, Weapon, Staves, Two-Hand, Common] in the client layer.
  expect(tips.get(35)).toMatchObject({ name: "Bent Staff", partial: true, lines: ["Staves", "Two-Hand"] });
});

// The armory character page draws these cards on every view. The full client layer is 2.5 MB of JSON and about 25 MB
// of a Worker isolate's 128 MB once loaded, so the page must not load it to name an equipped item's type and slot.
test("the equipped cards do not pull the full client layer into their import graph", () => {
  const web = join(__dirname, "..", "..");
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
      const spec = match[1];
      const base = spec.startsWith("@/") ? join(web, "src", spec.slice(2))
        : spec.startsWith("@kb/") ? join(web, "..", "kb", "src", spec.slice(4))
        : spec.startsWith(".") ? join(file, "..", spec) : null;
      if (base === null) continue;
      expect(base, `${file} imports ${spec}`).not.toContain("client-layer");
      if (!base.endsWith(".json")) visit(`${base.replace(/\.js$/, "")}.ts`);
    }
  };
  visit(join(__dirname, "equipped-item-tips.ts"));
  expect(seen.size).toBeGreaterThan(3);
});

test("no asset files or private bucket: no cards", async () => {
  expect((await loadEquippedTips(null, [{ itemId: 30, name: "Witchblade", quality: "EPIC" }], store())).size).toBe(0);
  expect((await loadEquippedTips(parseSiteManifest(siteManifest, BASE), [{ itemId: 30, name: "Witchblade", quality: "EPIC" }], null)).size).toBe(0);
});

test("an item with only an icon in the files shows the item level the armory read", async () => {
  const tips = await loadEquippedTips(parseSiteManifest(siteManifest, BASE)!, [{ itemId: 35, name: "Bent Staff", quality: "COMMON", level: 12 }], store());
  expect(tips.get(35)?.lines).toEqual(["Item Level 12", "Staves", "Two-Hand"]);
  expect(tips.get(35)?.level).toBe(12);
});
