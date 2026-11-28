/**
 * Whether an item name is a development leftover: the game files keep test, placeholder and retired items
 * ("Deprecated Copper Ingot", "[PH] Naxxramas Sword", "Monster - Shield, Kite Metal", "AHNQIRAJ TEST ITEM A")
 * next to the real ones. Pure, so the item lists, the item page and the sitemap apply the same test.
 *
 * Three kinds of evidence: a prefix the developers used for a whole family (Deprecated, also spelled Depricated, OLD glued to the name,
 * Monster - , Test , Unused, QA , zz glued to the name, NPC Equip, and the level-tier gear "90 Epic Frost Belt", "63 Green
 * Rogue Bow"), a marker anywhere in the name ([PH], [UNUSED], (DND), (Test), (Deprecated), (DELETE ME), a trailing
 * (old), the capitals TEST, UNUSED, DEPRECATED, NYI, DNT, DND, the word Placeholder), and the word test in the shapes
 * below ("1500 Test sword 80 purple", "Level 60 Test Gear", "JYoo test item"), a whole name like "Monster Weapon" aside.
 * Case matters in the markers, so "Old Blanchy's Blanket", "Monster Omelet", "Target Dummy", "Test of Faith" and "High
 * Test Eternium Fishing Line" stay. importers/pfquest.ts has JUNK_NAME for the emulator data it imports; that one is
 * for a different source and does not know these prefixes.
 */
const PREFIX = /^(?:[Dd]ep(?:re|ri)cated\b|OLD[A-Z ]|\(OLD\)|Monster - |Test (?!of )|test |Unused\b|QA ?Test|QA |zz[A-Z]|NPC Equip|\d+ (?:Epic|Green) )/;
const MARKER = /<(?:TEST|TXT|NYI|UNUSED|PH|DND)>|\[(?:UNUSED|PH|DND|DNT|NYI|TMP|TEST)\]|\((?:DND|DNT|TEST|Test|test|DEPRECATED|Deprecated|DELETE ME)\)|\((?:old|OLD)\)$|\b(?:UNUSED|TEST|DEPRECATED|NYI|DNT|DND)\b|\bPlaceholder\b/;
/**
 * Test in the shapes only test items use: lower-case test anywhere, a leading number ("1500 Test sword"), Fast Test,
 * or Test before a number, a dash or an item-ish word. Not a capital Test alone: the rule also reads quest and NPC
 * names, and "Rokar's Test", "Toxic Test" and "Inhuman Test Subject" are real.
 */
const TEST_WORD = /\btest\b|^\d+%? Test\b|\bFast Test\b|\bTest (?:\d|- |Item|Gear|Dagger|Ranged|Quest|NPC|Reputation|Creature|Pet|Dragon)/;
const WHOLE = /^(?:Monster Weapon|Template Item)$/;

export const isDevelopmentItemName = (name: string | null | undefined): boolean =>
  Boolean(name) && (PREFIX.test(name!) || MARKER.test(name!) || TEST_WORD.test(name!) || WHOLE.test(name!));

/**
 * A spell name the files keep for development: the item rule, or Test as a word in any case ("Editor Test Spell",
 * "Wyatt Test", "Tim's Test Fireball"). Spells only: quest and NPC names keep their capital Test. "Test of Faith" and
 * "Test of Lore" are real quest spells and stay; "Testament" and "Testing" are other words.
 */
const SPELL_TEST = /\btest\b(?! of\b)/i;
export const isDevelopmentSpellName = (name: string | null | undefined): boolean =>
  isDevelopmentItemName(name) || (Boolean(name) && SPELL_TEST.test(name!));
