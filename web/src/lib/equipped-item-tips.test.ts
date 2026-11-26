import { expect, test } from "vitest";
import { parseSiteManifest } from "./game-assets";
import { itemIndex, memoryStore, shard0, siteManifest } from "./game-assets.fixture";
import { loadEquippedTips } from "./equipped-item-tips";

const BASE = "https://assets.example.test/wow_classic_beta-70450-84bea423";
const FOLDER = "wow_classic_beta-70450-84bea423";
const store = () => memoryStore({ [`${FOLDER}/items.json`]: itemIndex, [`${FOLDER}/items/0.json`]: { ...shard0, "30": { i: 135661 } } });

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

test("no asset files or private bucket: no cards", async () => {
  expect((await loadEquippedTips(null, [{ itemId: 30, name: "Witchblade", quality: "EPIC" }], store())).size).toBe(0);
  expect((await loadEquippedTips(parseSiteManifest(siteManifest, BASE), [{ itemId: 30, name: "Witchblade", quality: "EPIC" }], null)).size).toBe(0);
});
