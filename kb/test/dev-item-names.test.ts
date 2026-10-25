import { expect, test } from "vitest";
import { isDevelopmentItemName } from "../src/dev-item-names.js";

test("names the game files keep for development items are leftovers", () => {
  for (const name of [
    "Deprecated Copper Ingot", "DEPRECATED ITEM", "OLD Stormwind Seasoning Salts", "OLDRecruit's Belt", "(OLD)Medium Throwing Knife",
    "[PH] Naxxramas Sword", "Doomcaller's Handwraps [PH]", "Monster - Shield, Kite Metal", "Test Defense Chest", "test Eric Shirt",
    "TEST QUEST HELM", "AHNQIRAJ TEST ITEM A CLOTH LEGS", "Unused Black Night Elf Pants", "UNUSED - Cloak of Arcane Insulation",
    "QA Tabard of Weighted Dice", "zzOLD Bracers", "NPC Equip 1", "Ring of Righteous Flame (TEST)", "Plate Shoulderpad (Test)",
    "Charm Pouch (DND)", "Hidden Belt (DNT)", "[TMP] Satyrbane", "Gnomish Weather Machine NYI", "Tabard of the Scarlet Crusade DEPRECATED",
    "Torka's Egg Cracker [UNUSED]", "<UNUSED> Glyphic Rune",
  ]) expect(isDevelopmentItemName(name), name).toBe(true);
});

test("real items whose names only hold one of the words stay", () => {
  for (const name of [
    "Old Blanchy's Blanket", "Ratty Old Belt", "Gloves of Old", "Grasp of the Old God", "Monster Omelet", "Monster Hunter's First Rune Fragment",
    "Target Dummy", "Test of Faith", "High Test Eternium Fishing Line", "Linen Cloth", "Thunderfury, Blessed Blade of the Windseeker",
    "Unusual Pebble", "Testament of Light", "Quartz Ring", "Zzzzz Pillow",
  ]) expect(isDevelopmentItemName(name), name).toBe(false);
  expect(isDevelopmentItemName(undefined)).toBe(false);
  expect(isDevelopmentItemName("")).toBe(false);
});
