import { ARMORY_RULESETS, classTokenOfId, isArmoryRegion, SEARCH_RULE, type ArmoryRegion } from "./armory";
import { armoryStore, type ArmoryGuildRow, type ArmoryGuildSort, type ArmoryMember } from "./armory-store";

/**
 * The armory's guild directory (/armory/guilds) and the summary on an armory guild page, from Blizzard's API data.
 *
 * It is an armory page, not a section of /guilds: Blizzard's Developer API Terms allow no ad on a page that shows
 * this data, and /armory is on the ad-free list while /guilds is not. /guilds keeps its ladder and its search over
 * members' uploads and the players table, and links here, its search carrying over. The two lists are not merged row
 * by row either: uploads name a guild by realm and name, the armory by region and slug, and nothing joins the two
 * reliably yet, so one table holding both would double a guild or fold two different guilds into one.
 *
 * The filters live in the address: `q`, `region`, `ruleset`, `sort` and `page`.
 */

export const GUILD_DIRECTORY_PATH = "/armory/guilds";

export const GUILD_DIRECTORY_PAGE = 50;

export const GUILD_SORTS = [
  { slug: "members", key: "members", label: "Members read" },
  { slug: "item-level", key: "item_level", label: "Average item level" },
  { slug: "level-60", key: "level_60", label: "Level 60" },
] as const satisfies readonly { slug: string; key: ArmoryGuildSort; label: string }[];
export type GuildSortSlug = (typeof GUILD_SORTS)[number]["slug"];

/** "Roleplay PvP" -> "roleplay-pvp": a ruleset as the address names it. */
export const rulesetSlug = (label: string) => label.toLowerCase().replace(/\s+/g, "-");

export interface GuildDirectoryQuery {
  /** The start of a guild name, already checked by the caller's search rule; null to list every guild. */
  prefix: string | null;
  region: ArmoryRegion | null;
  ruleset: number | null;
  sort: GuildSortSlug;
  page: number;
}

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The start of a guild name the directory searches for, under the rule of the armory's character search: 2 to 24
 * letters, matched from the start of the name. Null for no search; "invalid" for text the rule refuses.
 */
export function directoryPrefix(raw: string | undefined): string | null | "invalid" {
  const text = (raw ?? "").trim().slice(0, 24).normalize("NFC").toLowerCase();
  if (!text) return null;
  return SEARCH_RULE.test(text) ? text : "invalid";
}

/** The directory's filters from the address; anything it does not know is dropped, never an error. */
export function guildDirectoryQuery(search: Search): GuildDirectoryQuery {
  const prefix = directoryPrefix(one(search.q));
  const region = one(search.region)?.toLowerCase();
  const rules = one(search.ruleset)?.toLowerCase();
  const sort = one(search.sort)?.toLowerCase();
  const page = Number(one(search.page));
  return {
    prefix: prefix === "invalid" ? null : prefix,
    region: isArmoryRegion(region) ? region : null,
    ruleset: ARMORY_RULESETS.find((r) => rulesetSlug(r.label) === rules)?.id ?? null,
    sort: GUILD_SORTS.find((s) => s.slug === sort)?.slug ?? "members",
    page: Number.isInteger(page) && page > 1 && page <= 10_000 ? page : 1,
  };
}

/** The address of a directory view; defaults (every region and ruleset, members read, page 1) are left out. */
export function guildDirectoryHref(d: Partial<GuildDirectoryQuery>): string {
  const params = new URLSearchParams();
  if (d.prefix) params.set("q", d.prefix);
  if (d.region) params.set("region", d.region);
  const rules = ARMORY_RULESETS.find((r) => r.id === d.ruleset);
  if (rules) params.set("ruleset", rulesetSlug(rules.label));
  if (d.sort && d.sort !== "members") params.set("sort", d.sort);
  if (d.page && d.page > 1) params.set("page", String(d.page));
  const s = params.toString();
  return s ? `${GUILD_DIRECTORY_PATH}?${s}` : GUILD_DIRECTORY_PATH;
}

/**
 * Whether a guild hide (/guilds/hide, keyed by realm and name as `guildHideKey` writes it) covers an armory guild. The
 * armory has no realm, so a hide on any realm whose name carries the region ("CAMWOW US1 Realm 4 PvP") hides the
 * guild of that name in that region. The SQL directory applies the same rule.
 */
export function armoryGuildHidden(hidden: ReadonlySet<string>, region: string, name: string): boolean {
  const guild = name.trim().toLowerCase().replace(/\s+/g, " ");
  const inRegion = new RegExp(`(^| )${region.toLowerCase()}[0-9]*( |$)`);
  for (const key of hidden) {
    const [realm, hiddenGuild] = key.split("\u0000");
    if (hiddenGuild === guild && realm !== undefined && inRegion.test(realm)) return true;
  }
  return false;
}

export type GuildDirectory =
  | { state: "ready"; rows: ArmoryGuildRow[]; total: number }
  /** The migration is not applied: the guilds whose name starts with the search, without counts. */
  | { state: "not-ready"; rows: ArmoryGuildRow[] }
  | { state: "unreachable" };

/**
 * One page of the directory. `hidden` is the guild hide list (null when it could not be read: then no guild is
 * listed, as /guilds lists none). A row it covers is dropped here too, so the development store, which knows no
 * hides, follows the same rule as the SQL.
 */
export async function loadGuildDirectory(d: GuildDirectoryQuery, hidden: ReadonlySet<string> | null): Promise<GuildDirectory> {
  if (hidden === null) return { state: "unreachable" };
  const shown = (rows: ArmoryGuildRow[]) => rows.filter((r) => !armoryGuildHidden(hidden, r.region, r.name));
  const store = armoryStore();
  try {
    const sort = GUILD_SORTS.find((s) => s.slug === d.sort)!.key;
    const page = await store.guildDirectory({
      prefix: d.prefix, region: d.region, rulesetId: d.ruleset, sort, limit: GUILD_DIRECTORY_PAGE, offset: (d.page - 1) * GUILD_DIRECTORY_PAGE,
    });
    if (page) return { state: "ready", rows: shown(page.rows), total: page.total };
    if (!d.prefix) return { state: "not-ready", rows: [] };
    // Before the migration: the name search the armory already has, filtered here, with no counts to sort by.
    const hits = await store.searchGuilds(d.prefix, GUILD_DIRECTORY_PAGE);
    const rows = hits
      .filter((h) => (d.region === null || h.region === d.region) && (d.ruleset === null || ARMORY_RULESETS.find((r) => r.id === d.ruleset)?.label === h.ruleset))
      .map((h): ArmoryGuildRow => ({
        region: h.region, slug: h.slug, name: h.name, faction: h.faction, ruleset: h.ruleset,
        rulesetId: ARMORY_RULESETS.find((r) => r.label === h.ruleset)?.id ?? 0, memberCount: h.memberCount,
        membersRead: 0, averageItemLevel: null, level60: 0, fetchedAt: "",
      }));
    return { state: "not-ready", rows: shown(rows) };
  } catch {
    return { state: "unreachable" };
  }
}

/** Level bands on a guild page, highest first. */
export const LEVEL_BANDS = [
  { label: "60", min: 60, max: 60 },
  { label: "50–59", min: 50, max: 59 },
  { label: "40–49", min: 40, max: 49 },
  { label: "30–39", min: 30, max: 39 },
  { label: "20–29", min: 20, max: 29 },
  { label: "1–19", min: 1, max: 19 },
] as const;

export interface RosterSummary {
  /** Class token ("MAGE") and count, most first; members whose class Blizzard did not give are left out. */
  classes: { token: string; count: number }[];
  levels: { label: string; count: number }[];
  /** Members whose level the roster does not give. */
  levelUnknown: number;
  /** The average over members whose character has been read; null when none has. */
  averageItemLevel: number | null;
  itemLevelsRead: number;
}

/** The class mix, level spread and average item level of the roster as shown (hidden members are already out). */
export function rosterSummary(members: readonly ArmoryMember[]): RosterSummary {
  const classes = new Map<string, number>();
  for (const m of members) {
    const token = classTokenOfId(m.classId);
    if (token) classes.set(token, (classes.get(token) ?? 0) + 1);
  }
  const levels = LEVEL_BANDS.map((b) => ({ label: b.label, count: members.filter((m) => m.level !== null && m.level >= b.min && m.level <= b.max).length }));
  const read = members.map((m) => m.itemLevel).filter((v): v is number => v !== null);
  return {
    classes: [...classes].map(([token, count]) => ({ token, count })).sort((a, b) => b.count - a.count || a.token.localeCompare(b.token)),
    levels,
    levelUnknown: members.filter((m) => m.level === null || m.level < 1 || m.level > 60).length,
    averageItemLevel: read.length ? Math.round((read.reduce((a, b) => a + b, 0) / read.length) * 10) / 10 : null,
    itemLevelsRead: read.length,
  };
}
