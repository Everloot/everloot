/**
 * Whether an item name is a development leftover: the game files keep test, placeholder and retired items
 * ("Deprecated Copper Ingot", "[PH] Naxxramas Sword", "Monster - Shield, Kite Metal", "AHNQIRAJ TEST ITEM A")
 * next to the real ones. Pure, so the item lists, the item page and the sitemap apply the same test.
 *
 * Two kinds of evidence: a prefix the developers used for a whole family (Deprecated, OLD glued to the name,
 * Monster - , Test , Unused, QA , zz glued to the name, NPC Equip), and a marker anywhere in the name ([PH], [UNUSED], (DND),
 * (Test), or the capitals TEST, UNUSED, DEPRECATED, NYI). Case matters in the markers, so "Old Blanchy's
 * Blanket", "Monster Omelet", "Target Dummy" and "Test of Faith" stay. importers/pfquest.ts has JUNK_NAME for
 * the emulator data it imports; that one is for a different source and does not know these prefixes.
 */
const PREFIX = /^(?:[Dd]eprecated\b|OLD[A-Z ]|\(OLD\)|Monster - |Test (?!of )|test |Unused\b|QA |zz[A-Z]|NPC Equip)/;
const MARKER = /<(?:TEST|TXT|NYI|UNUSED|PH|DND)>|\[(?:UNUSED|PH|DND|DNT|NYI|TMP|TEST)\]|\((?:DND|DNT|TEST|Test|test|DEPRECATED)\)|\b(?:UNUSED|TEST|DEPRECATED|NYI)\b/;

export const isDevelopmentItemName = (name: string | null | undefined): boolean => Boolean(name) && (PREFIX.test(name!) || MARKER.test(name!));
