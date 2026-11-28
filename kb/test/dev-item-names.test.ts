import { expect, test } from "vitest";
import { isDevelopmentItemName, isDevelopmentSpellName } from "../src/dev-item-names.js";

test("a spell name with Test as a word is a leftover; the quest spells named Test of stay", () => {
  // Real spell names from build 71139 the item rule lets through.
  for (const name of [
    "Editor Test Spell", "Wyatt Test", "Damage Immunity Test", "Stasis Test", "Script Test", "Sam's Test Spell #2", "Tim's Test Fireball",
    "Love is in the Air Test", "Feed Pet (Quest Test)", "Get Gosssip, Test", "T1 Set Piece Test", "Test",
  ]) expect(isDevelopmentSpellName(name), name).toBe(true);
  // The item rule's leftovers stay leftovers.
  expect(isDevelopmentSpellName("Hot Foot (TEST)")).toBe(true);
  for (const name of [
    "Test of Faith", "Test of Lore", "Testament of Hope", "Frostbolt", "Teleport Goldshire", "Goldshire Portal", "Contest Winner", "Attest",
  ]) expect(isDevelopmentSpellName(name), name).toBe(false);
  expect(isDevelopmentSpellName(undefined)).toBe(false);
});

test("names the game files keep for development items are leftovers", () => {
  for (const name of [
    "Deprecated Copper Ingot", "Depricated Sharp Arrow", "DEPRECATED ITEM", "OLD Stormwind Seasoning Salts", "OLDRecruit's Belt", "(OLD)Medium Throwing Knife",
    "[PH] Naxxramas Sword", "Doomcaller's Handwraps [PH]", "Monster - Shield, Kite Metal", "Test Defense Chest", "test Eric Shirt",
    "TEST QUEST HELM", "AHNQIRAJ TEST ITEM A CLOTH LEGS", "Unused Black Night Elf Pants", "UNUSED - Cloak of Arcane Insulation",
    "QA Tabard of Weighted Dice", "zzOLD Bracers", "NPC Equip 1", "Ring of Righteous Flame (TEST)", "Plate Shoulderpad (Test)",
    "Charm Pouch (DND)", "Hidden Belt (DNT)", "[TMP] Satyrbane", "Gnomish Weather Machine NYI", "Tabard of the Scarlet Crusade DEPRECATED",
    "Torka's Egg Cracker [UNUSED]", "<UNUSED> Glyphic Rune",
  ]) expect(isDevelopmentItemName(name), name).toBe(true);
});

test("leading numeric test names, suffix forms and placeholders from the 71139 names file are leftovers", () => {
  for (const name of [
    "1500 Test sword 80 purple", "2900 Test sword 80 purple", "3500 Test 2h Axe 70 purple", "1000 Test dagger 60 blue", "5% Test Speed Boots",
    "90 Epic Frost Belt", "90 Epic Warrior Neck", "63 Green Rogue Bow", "90 Green Frost Wand",
    "Felstone (Deprecated)", "Succubi Stone (Deprecated)", "Voidstone (Deprecated)", "Shane Test (DELETE ME)", "Large Moneybag (old)",
    "Monster Weapon", "Placeholder", "Quest Reward Placeholder", "Template Item", "DNT HEAD", "[DNT] Test",
    "Fast Test 2H Sword", "Level 60 Test Gear Plate - Paladin/Warrior", "Off Hand Test Dagger", "Bind On Use Test Item", "Ashbringer Test 001", "Runecarving Test - Crippling Poison",
    "JYoo test item", "Conjured test Item", "test", "2hander Animation as 1hander test copy", "QATest Darkmoon Faire Tickets",
  ]) expect(isDevelopmentItemName(name), name).toBe(true);
});

test("real items that start with a number or hold Monster or Test stay", () => {
  for (const name of [
    "20-slot Bag", "99-Year-Old Port", "10 Pound Mud Snapper", "103 Pound Mightfish", "Used Monster Sample", "Sea Monster's Head",
    "Recipe: Monster Omelet", "A Thoroughly Read Copy of \"Nat Pagle's Extreme' Anglin.\"",
    // The rule also reads quest and NPC names: real ones with a capital Test.
    "Rokar's Test", "Toxic Test", "Inhuman Test Subject", "7th Legion Test Unit",
  ]) expect(isDevelopmentItemName(name), name).toBe(false);
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
