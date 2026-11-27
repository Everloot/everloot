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

// Beastmaster's Mantle as Blizzard's Forever API sent it on 2026-11-27, shortened to two pieces and two bonuses.
const mantle = {
  binding: "Binds when picked up", slot: "Shoulder", kind: "Mail", armor: 286, stats: ["+12 Intellect", "+13 Agility"],
  bonus_stats: ["+14 Critical Strike"], effects: ["Equip: Increases damage dealt by your pet by 3%."],
  set: {
    name: "Beastmaster Armor",
    pieces: [{ name: "Beastmaster's Mantle", equipped: true }, { name: "Beastmaster's Chest", equipped: false }],
    bonuses: [{ text: "Set: +8 All Resistances.", count: 2, active: false }, { text: "Set: +40 Attack Power.", count: 6, active: false }],
  },
};

test("QA round 5: on armory pages the gear card is built from the lines Blizzard sent: item level, armor, stats, Equip lines and set", async () => {
  const assets = parseSiteManifest(siteManifest, BASE)!;
  const tips = await loadEquippedTips(assets, [{ itemId: 30, name: "Beastmaster's Mantle", quality: "RARE", level: 65, tip: mantle }], store(), true);
  expect(tips.get(30)).toMatchObject({
    name: "Beastmaster's Mantle", quality: "Rare", icon: `${BASE}/icons/135661.webp`, partial: false, level: 65,
    lines: [
      "Item Level 65", "Binds when picked up", "Shoulder · Mail", "286 Armor", "+12 Intellect", "+13 Agility",
      "Equip: +14 Critical Strike", "Equip: Increases damage dealt by your pet by 3%.",
      "Beastmaster Armor (1/2)", "  Beastmaster's Mantle", "  Beastmaster's Chest", "(2) Set: +8 All Resistances.", "(6) Set: +40 Attack Power.",
    ],
    label: "From Blizzard's API · icon found in game files, unconfirmed · build 1.60.1.70450",
  });
  // The game files' own tooltip gives way to Blizzard's lines on an armory page, and stays everywhere else.
  const withFiles = await loadEquippedTips(assets, [{ itemId: 9, name: "Linen Cloth", quality: "COMMON", level: 5, tip: mantle }], store(), true);
  expect(withFiles.get(9)?.label).toMatch(/^From Blizzard's API/);
  const elsewhere = await loadEquippedTips(assets, [{ itemId: 9, name: "Linen Cloth", quality: "COMMON", level: 5, tip: mantle }], store());
  expect(elsewhere.get(9)?.label).not.toMatch(/Blizzard/);
});

test("an item with only an icon in the files shows the item level the armory read", async () => {
  const tips = await loadEquippedTips(parseSiteManifest(siteManifest, BASE)!, [{ itemId: 35, name: "Bent Staff", quality: "COMMON", level: 12 }], store());
  expect(tips.get(35)?.lines).toEqual(["Item Level 12", "Staves", "Two-Hand"]);
});

test("without the asset files Blizzard's lines still give an armory gear card, with no icon", async () => {
  const tips = await loadEquippedTips(null, [{ itemId: 30, name: "Beastmaster's Mantle", quality: "RARE", level: 65, tip: mantle }], store(), true);
  expect(tips.get(30)).toMatchObject({ icon: null, label: "From Blizzard's API", partial: false });
  expect(tips.get(30)?.lines).toContain("286 Armor");
  expect((await loadEquippedTips(null, [{ itemId: 30, name: "Beastmaster's Mantle", quality: "RARE", tip: mantle }], store())).size).toBe(0);
});
