import { dataAgeLabel } from "./data-age";

/**
 * The armory (plan docs/superpowers/plans/2026-11-09-armory-blizzard-intake.md): a page for every WoW: Forever
 * character and guild the crawler read from the Blizzard Forever API. The crawler (kb/src/armory) writes the rows; the
 * pages under app/armory only read them, through armory-store.ts. Behind EVERLOOT_ARMORY=1, which the owner turns on
 * after applying the migration. Blizzard's terms: no ad on these pages, the credit line on each, rows kept 30 days at
 * most, and a character hidden on request is deleted and never read again.
 */

export function armoryOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_ARMORY === "1";
}

/** Said on every armory page, with the time of the newest read. */
export const BLIZZARD_CREDIT = "Data from Blizzard Entertainment";
/** How long a row is kept after its last read, and when the crawler reads it again at the latest. */
export const ARMORY_KEPT_DAYS = 30;
export const ARMORY_RECHECK_DAYS = 20;

export const ARMORY_REGIONS = ["us", "eu"] as const;
export type ArmoryRegion = (typeof ARMORY_REGIONS)[number];
export const isArmoryRegion = (s: string | undefined): s is ArmoryRegion => s === "us" || s === "eu";
export const regionLabel = (r: string) => r.toUpperCase();

/** The Forever rulesets the API names (dynamic-forever ruleset index, read 2026-11-09). */
export const ARMORY_RULESETS = [
  { id: 1, label: "PvP" },
  { id: 2, label: "Normal" },
  { id: 3, label: "Roleplay" },
  { id: 15, label: "Roleplay PvP" },
] as const;
export const rulesetName = (id: number) => ARMORY_RULESETS.find((r) => r.id === id)?.label ?? "Unknown";

/**
 * A character or guild slug as the table checks it (`^[[:alnum:]]+(-[[:alnum:]]+)*$`, at most 64 characters): one or
 * more words of letters (any script) and digits joined by hyphens, in lower case. A single word is a slug too.
 */
const SLUG = /^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u;
export const validArmorySlug = (s: string | undefined): s is string =>
  typeof s === "string" && [...s].length <= 64 && s === s.toLowerCase() && SLUG.test(s);

/** A slug from an address: decoded once (the segment may arrive percent-encoded), composed (NFC). Null if it does not decode. */
export function slugFromSegment(segment: string): string | null {
  try { return decodeURIComponent(segment).normalize("NFC"); } catch { return null; }
}

/**
 * The form fields: a first name and a surname, letters of any script. What a person types or pastes may be decomposed
 * (a letter and a combining accent), so the browser patterns and the server's first check take letters and combining
 * marks alike. The server then composes the text (NFC) and checks letters only, so a mark that does not compose into
 * its letter is refused there and never reaches a slug.
 */
export const NAME_PATTERN = "[\\p{L}\\p{M}]{2,12}";
export const SURNAME_PATTERN = "[\\p{L}\\p{M}]{2,24}";
export const NAME_INPUT_RULE = new RegExp(`^${NAME_PATTERN}$`, "u");
export const SURNAME_INPUT_RULE = new RegExp(`^${SURNAME_PATTERN}$`, "u");
/** After composing: letters only, 2 to 12 and 2 to 24 of them. */
export const NAME_RULE = /^\p{L}{2,12}$/u;
export const SURNAME_RULE = /^\p{L}{2,24}$/u;
/** `name-surname` composed (NFC) and in lower case, as the API's `slug`; null when either part is not letters only. */
export function characterSlugOf(name: string, surname: string): string | null {
  const rawName = name.trim(), rawSurname = surname.trim();
  if (!NAME_INPUT_RULE.test(rawName) || !SURNAME_INPUT_RULE.test(rawSurname)) return null;
  const n = rawName.normalize("NFC"), s = rawSurname.normalize("NFC");
  return NAME_RULE.test(n) && SURNAME_RULE.test(s) ? `${n}-${s}`.toLowerCase() : null;
}

/**
 * A name and surname read off a character slug, each part with a capital: for a roster member stored without its
 * names, which the roster allows. `ølvir-stål` reads "Ølvir" and "Stål"; a single-word slug has no surname.
 */
export function namesFromSlug(slug: string): { name: string; surname: string } {
  const cap = (w: string) => (w ? w.charAt(0).toLocaleUpperCase() + w.slice(1) : w);
  const [first = "", ...rest] = slug.split("-");
  return { name: cap(first), surname: rest.map(cap).join(" ") };
}

/** A search prefix: 2 to 24 letters of any script. */
export const SEARCH_RULE = /^\p{L}{2,24}$/u;

export const ARMORY_PATH = "/armory";
export const ARMORY_HIDE_PATH = "/armory/hide";
export const ARMORY_SUBMIT_PATH = "/armory/submit";
export const armoryCharacterPath = (region: string, slug: string) => `/armory/${region}/${encodeURIComponent(slug)}`;
export const armoryGuildPath = (region: string, slug: string) => `/armory/${region}/guilds/${encodeURIComponent(slug)}`;
/** The hide form, filled in for one character. */
export function armoryHidePath(c?: { region: string; name: string; surname: string }): string {
  return c ? `${ARMORY_HIDE_PATH}?${new URLSearchParams({ region: c.region, name: c.name, surname: c.surname })}` : ARMORY_HIDE_PATH;
}

export type ArmoryMetric = "item-level" | "gear-score" | "honorable-kills";
/** The column armory_board ranks by. */
export type ArmoryMetricKey = "item_level" | "gear_score" | "honorable_kills";
export const ARMORY_METRICS: readonly ArmoryMetric[] = ["item-level", "gear-score", "honorable-kills"];
export const isArmoryMetric = (s: string): s is ArmoryMetric => (ARMORY_METRICS as readonly string[]).includes(s);
export const ARMORY_BOARDS: Record<ArmoryMetric, { key: ArmoryMetricKey; title: string; column: string; lede: string }> = {
  "item-level": {
    key: "item_level", title: "Item level", column: "Item level",
    lede: "Characters by the average item level of what they wear: 17 slots, an empty one counting 0, a two-handed weapon filling both hands.",
  },
  "gear-score": {
    key: "gear_score", title: "Gear Score", column: "Gear Score",
    lede: "Characters by Everloot Gear Score: item level weighted by each slot's stat budget.",
  },
  "honorable-kills": {
    key: "honorable_kills", title: "Honorable kills", column: "Honorable kills",
    lede: "Characters by lifetime honorable kills, as their PvP summary gives them.",
  },
};
export const metricOfKey = (key: string): ArmoryMetric | null => ARMORY_METRICS.find((m) => ARMORY_BOARDS[m].key === key) ?? null;
export const armoryBoardPath = (metric: ArmoryMetric) => `/armory/rankings/${metric}`;
/** The number a board or a fact shows: whole kills, item level and Gear Score to two decimals at most. */
export const metricValue = (metric: ArmoryMetric, value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: metric === "honorable-kills" ? 0 : 2 });

export interface ArmoryBoardQuery { region: ArmoryRegion | null; ruleset: number | null }

/** `?ruleset=1&region=eu`; null when a value is not one we know (the page answers 404 rather than guess). */
export function armoryBoardQuery(search: Record<string, string | string[] | undefined>): ArmoryBoardQuery | null {
  const one = (k: string) => (typeof search[k] === "string" ? (search[k] as string) : "");
  const rawRegion = one("region"), rawRuleset = one("ruleset");
  const region = rawRegion === "" ? null : isArmoryRegion(rawRegion) ? rawRegion : undefined;
  const ruleset = rawRuleset === "" ? null : ARMORY_RULESETS.find((r) => String(r.id) === rawRuleset)?.id ?? undefined;
  if (region === undefined || ruleset === undefined) return null;
  return { region, ruleset };
}

export function armoryBoardHref(metric: ArmoryMetric, q: ArmoryBoardQuery): string {
  const params = new URLSearchParams();
  if (q.ruleset !== null) params.set("ruleset", String(q.ruleset));
  if (q.region) params.set("region", q.region);
  const s = params.toString();
  return s ? `${armoryBoardPath(metric)}?${s}` : armoryBoardPath(metric);
}

/**
 * Class and race by the API's ids, for the roster, which carries ids only. Only the ids the plan confirmed; any other
 * id reads "Unknown" rather than a guess. The class is the addon's token, so the class colours and names apply.
 */
const CLASS_BY_ID: Record<number, string> = {
  1: "WARRIOR", 2: "PALADIN", 3: "HUNTER", 4: "ROGUE", 5: "PRIEST", 7: "SHAMAN", 8: "MAGE", 9: "WARLOCK", 11: "DRUID",
};
const RACE_BY_ID: Record<number, string> = {
  1: "Human", 2: "Orc", 3: "Dwarf", 4: "Night Elf", 5: "Undead", 6: "Tauren", 7: "Gnome", 8: "Troll",
};
export const UNKNOWN = "Unknown";
export const classTokenOfId = (id: number | null | undefined): string | null => (id == null ? null : CLASS_BY_ID[id] ?? null);
export const raceOfId = (id: number | null | undefined): string => (id == null ? UNKNOWN : RACE_BY_ID[id] ?? UNKNOWN);
/** The addon's class token for the API's class name ("Hunter" → "HUNTER"). */
export const classTokenOfName = (name: string) => name.trim().toUpperCase();

/** The equipment slot types the API names, as a page labels them. */
const SLOT_LABEL: Record<string, string> = {
  HEAD: "Head", NECK: "Neck", SHOULDER: "Shoulder", SHIRT: "Shirt", CHEST: "Chest", WAIST: "Waist", LEGS: "Legs",
  FEET: "Feet", WRIST: "Wrist", HANDS: "Hands", FINGER_1: "Finger", FINGER_2: "Finger", TRINKET_1: "Trinket",
  TRINKET_2: "Trinket", BACK: "Back", MAIN_HAND: "Main hand", OFF_HAND: "Off hand", RANGED: "Ranged", TABARD: "Tabard",
};
export const slotLabel = (slot: string) => SLOT_LABEL[slot] ?? UNKNOWN;

/** "Read 2026-11-09 14:05 UTC": when the crawler last read the row, or that it is unrecorded. */
export function readLine(at: string | null | undefined): string {
  const label = dataAgeLabel(at);
  return label.startsWith("Data as of ") ? `Read ${label.slice("Data as of ".length)}` : "Read time unrecorded";
}
