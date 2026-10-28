/**
 * The names players shorten, mapped to the names the records carry. The question bank's first eval showed
 * 17 of 20 instance short forms resolving nowhere (docs/evals/question-eval-2026-10-27.md): "MC" is what
 * a player types, "Molten Core" is the page. Each alias is a whole word, matched without regard to case,
 * and expands in place, so the rest of the question keeps its words. Targets are the titles the knowledge
 * release carries (the Warcraft Wiki's), checked against the 2026-10-05 release.
 */
import { allTerms } from "./search.js";

/** alias → the record's name. Keep each alias a whole token: no spaces, letters and digits only. */
export const NAME_ALIASES: Readonly<Record<string, string>> = {
  // Dungeons
  rfc: "Ragefire Chasm", vc: "Deadmines", dm: "Deadmines", wc: "Wailing Caverns", sfk: "Shadowfang Keep",
  bfd: "Blackfathom Deeps", stocks: "Stormwind Stockade", stockade: "Stormwind Stockade", gnomer: "Gnomeregan",
  rfk: "Razorfen Kraul", rfd: "Razorfen Downs", sm: "Scarlet Monastery", uld: "Uldaman", zf: "Zul'Farrak",
  mara: "Maraudon", st: "Temple of Atal'Hakkar", brd: "Blackrock Depths", lbrs: "Blackrock Spire", ubrs: "Blackrock Spire",
  brs: "Blackrock Spire", scholo: "Scholomance", strat: "Stratholme", diremaul: "Dire Maul",
  // Raids
  mc: "Molten Core", ony: "Onyxia's Lair", bwl: "Blackwing Lair", zg: "Zul'Gurub", aq20: "Ruins of Ahn'Qiraj",
  aq40: "Temple of Ahn'Qiraj", aq: "Ahn'Qiraj", naxx: "Naxxramas",
  // Cities
  sw: "Stormwind City", if: "Ironforge", org: "Orgrimmar", tb: "Thunder Bluff", uc: "Undercity", darn: "Darnassus",
  // Zones and battlegrounds
  stv: "Stranglethorn Vale", epl: "Eastern Plaguelands", wpl: "Western Plaguelands", ungoro: "Un'Goro Crater",
  av: "Alterac Valley", wsg: "Warsong Gulch", ab: "Arathi Basin",
  // Things
  ah: "Auction House", dmf: "Darkmoon Faire",
};

/** "DM" in "DM east" is Dire Maul, not the Deadmines: a second word decides where one short form has two readings. */
const TWO_WORD_ALIASES: readonly { first: string; second: RegExp; name: string }[] = [
  { first: "dm", second: /^(east|west|north|tribute|e|w|n)$/, name: "Dire Maul" },
];

const TOKEN = /[\p{L}\p{N}]+/gu;

/**
 * The text with every alias replaced by its record name, and the names that were put in. Alias matching is
 * on whole words only, so "if" expands only when it is the word "IF" on its own; lower-case "if" in a
 * sentence ("what if") is left alone, as is every other alias written in lower case inside a longer question
 * with three or more words: a player writes "SM" or "sm" alone, but "is" is not Ironforge.
 */
export function expandAliases(text: string): { text: string; expanded: string[] } {
  const expanded: string[] = [];
  const words = text.match(TOKEN) ?? [];
  const longQuestion = words.length >= 3;
  let i = 0;
  const out = text.replace(TOKEN, (word) => {
    const lower = word.toLowerCase();
    const next = words[i + 1]?.toLowerCase();
    i += 1;
    const two = TWO_WORD_ALIASES.find((a) => a.first === lower && next !== undefined && a.second.test(next));
    const target = two?.name ?? NAME_ALIASES[lower];
    if (!target) return word;
    // Upper-case short forms are always aliases ("MC"); lower-case ones only in short questions or when nothing else reads them.
    if (word !== word.toUpperCase() && longQuestion && AMBIGUOUS.has(lower)) return word;
    expanded.push(target);
    return target;
  });
  return { text: out, expanded };
}

/** Short forms that are also words or fragments of them, read as aliases only in upper case inside a longer question. */
const AMBIGUOUS = new Set(["if", "st", "ab", "av", "ah", "sw", "tb", "uc", "sm", "dm", "org", "mara", "strat", "stocks", "stockade", "aq"]);

/** The name without a leading article, so "The Barrens" meets the page named "Barrens" and the other way round. */
export function withoutArticle(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, "");
}

/** Whether two names are the same page title, allowing a leading article and punctuation on either side. */
export function sameTitle(a: string, b: string): boolean {
  return allTerms(withoutArticle(a)) === allTerms(withoutArticle(b));
}
