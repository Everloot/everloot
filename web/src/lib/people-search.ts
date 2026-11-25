import { unstable_cache } from "next/cache";
import { className, PLAYER_SEARCH_TAG } from "@/app/players/player-view";
import { CLASSES } from "@/design/tokens";
import { ARMORY_RULESETS, armoryCharacterPath, armoryGuildPath, armoryNameQuery, armoryOn, regionLabel } from "./armory";
import { sameGuild } from "./guild-merge";
import { armoryStore, type ArmoryGuildHit, type ArmoryHit, type SitePeople, type SitePlayerHit } from "./armory-store";
import { GUILD_SEARCH_TAG, guildPath, guildSearchPrefix, guildsOn, loadGuildSearch } from "./guilds";
import { playerPagesOn, playerPath, searchPrefix } from "./player-pages";
import type { PeopleSearch, PersonGroup, PersonResult } from "./people-search-types";
import { playerStore } from "./player-store";

/**
 * Characters and guilds for the site's own search (/search and the header type-ahead), from the same lookups
 * /players, /armory and /guilds run. Answered only by /search/people, which no CDN or browser keeps: a hide clears the
 * caches below at once (the hide routes revalidate both tags), and a response kept anywhere else would not be. The
 * armory lookup is not cached at all, so an armory hide needs no tag.
 */

/** One search per name prefix is kept five minutes; /players reads the same entries. */
export const searchPlayers = unstable_cache((prefix: string) => playerStore().search(prefix), ["player-search"], { revalidate: 300, tags: [PLAYER_SEARCH_TAG] });

/**
 * One guild search per prefix, kept five minutes. Unreachable storage throws, and so does an answer missing the players
 * table's guilds, so neither is kept (/guilds still shows such an answer, read fresh). A guild hide clears it; so does a
 * character hide, as the members-seen count comes from the players table.
 */
const searchGuildsKept = unstable_cache(async (prefix: string) => {
  const found = await loadGuildSearch(prefix);
  if (found.unreachable) throw new Error("guild storage unreachable");
  if (found.partial) throw new Error("players table unreachable for the guild search");
  return found.results;
}, ["site-guild-search"], { revalidate: 300, tags: [GUILD_SEARCH_TAG, PLAYER_SEARCH_TAG] });

export type { PeopleSearch, PersonGroup, PersonResult } from "./people-search-types";

const EMPTY: PersonGroup = { results: [], total: 0, capped: false };
export const PEOPLE_LIMIT = 8;
/** The PEOPLE_SEARCH_LIMIT binding in web/wrangler.jsonc: lookups per address per minute on /search/people. */
export const PEOPLE_PER_MINUTE = 60;
/** The most rows any lookup returns: the players store's search limit, kb's searchGuilds default, and the armory's ask. */
const LOOKUP_CAP = 25;

/** Exact names first, then the lookup's own order; the first `limit`. Capped when any lookup stopped at its 25. */
function group(lookups: PersonResult[][], limit: number): PersonGroup {
  const seen = new Set<string>();
  const rows = lookups.flat().filter((r) => !seen.has(r.href) && Boolean(seen.add(r.href)));
  const sorted = [...rows].sort((a, b) => Number(b.exact) - Number(a.exact));
  return { results: sorted.slice(0, limit), total: rows.length, capped: lookups.some((l) => l.length >= LOOKUP_CAP) };
}

/** A class as the colour tokens name it ("warrior"), from a store token ("WARRIOR") or the armory's name ("Warrior"). */
function classKey(name: string): { class?: string } {
  const c = CLASSES.find((k) => k === name.toLowerCase());
  return c ? { class: c } : {};
}

/** An armory character as a search row; exact when the text is its full name or its first name. */
function armoryRow(h: Pick<ArmoryHit, "region" | "slug" | "name" | "surname" | "level" | "class" | "ruleset"> & { faction?: string }, fullName: string): PersonResult {
  const label = `${h.name} ${h.surname}`;
  return {
    type: "character", label, href: armoryCharacterPath(h.region, h.slug), meta: `Level ${h.level} ${h.class} · ${regionLabel(h.region)} ${h.ruleset}`,
    exact: label.toLowerCase() === fullName || h.name.toLowerCase() === fullName, ...classKey(h.class), ...(h.faction ? { faction: h.faction } : {}),
  };
}

/** A character the addon saw as a search row. */
function playerRow(p: SitePlayerHit, q: string): PersonResult {
  return {
    type: "character", label: p.name, href: playerPath(p), meta: `Level ${p.level} ${className(p.class)} · ${p.realm}`, exact: p.name.toLowerCase() === q, ...classKey(p.class),
  };
}

/** An armory guild as a search row: its region, ruleset and the roster size Blizzard reports, as /guilds lists it. */
function armoryGuildRow(g: ArmoryGuildHit, q: string): PersonResult {
  return {
    type: "guild", label: g.name, href: armoryGuildPath(g.region, g.slug),
    meta: `${regionLabel(g.region)} ${g.ruleset} · ${g.memberCount.toLocaleString("en-US")} ${g.memberCount === 1 ? "member" : "members"}`,
    exact: g.name.toLowerCase() === q, faction: g.faction,
  };
}

/**
 * Characters seen by the addon whose name starts with the text (switch on, 2 to 12 letters), armory characters whose
 * first name, surname or "first surname" does (switch on, see armoryNameQuery), and guilds whose name does (switch
 * on, 2 to 24 characters), plus, with the armory on, armory guilds. Addon rows have no surname, so a full name finds armory rows only. Characters from both
 * lookups share one group, one row per page. Both character kinds and the armory guilds come from one read
 * (site_people_search); until its migration is applied, or when it fails, the separate reads answer as before, without
 * armory guilds. A lookup that fails leaves its rows out; the others still answer.
 * `lookup` (the /search page's on-demand armory lookup, armory-lookup.ts) runs only when the armory answered and
 * had nobody for the text; its hit, if any, is the armory's one row.
 */
export async function peopleSearch(raw: string, limit = PEOPLE_LIMIT, lookup?: (text: string) => Promise<ArmoryHit | null>): Promise<PeopleSearch> {
  const text = raw.trim().slice(0, 40);
  const q = text.toLowerCase();
  const name = playerPagesOn() ? searchPrefix(text) : null;
  const fullName = armoryOn() ? armoryNameQuery(text) : null;
  const guild = guildsOn() ? guildSearchPrefix(text) : null;
  const armoryGuild = armoryOn() ? guildSearchPrefix(text) : null;
  const one = name || fullName || armoryGuild ? await oneRead(text) : null;
  const [players, armory, guilds] = await Promise.all([
    name ? (one ? one.players.map((p) => playerRow(p, q)) : orNone(async () => (await searchPlayers(name.toLowerCase())).map((p) => playerRow(p, q)))) : null,
    fullName ? orNone(async () => {
      const stored = one ? one.armory : await armoryStore().search(fullName, LOOKUP_CAP);
      const found = !stored.length && lookup ? await lookup(text) : null;
      return (found ? [found] : stored).map((h) => armoryRow(h, fullName));
    }) : null,
    // An addon guild the armory answered too is the armory's row (guild-merge.ts's rule), as its page redirects there.
    guild ? orNone(async () => (await searchGuildsKept(guild.toLowerCase())).filter((g) => !inArmory(g, armoryGuild && one ? one.guilds : [])).map((g) => ({
      type: "guild" as const, label: g.guildName, href: guildPath(g.realm, g.guildName),
      meta: g.membersSeen === null ? g.realm : `${g.realm} · ${g.membersSeen.toLocaleString("en-US")} ${g.membersSeen === 1 ? "member" : "members"} seen`,
      exact: g.guildName.toLowerCase() === q, ...(g.faction ? { faction: g.faction } : {}),
    }))) : null,
  ]);
  const characterLookups = [players, armory].filter((l): l is PersonResult[] => l !== null);
  const guildLookups = [guilds, armoryGuild && one ? one.guilds.map((g) => armoryGuildRow(g, q)) : null].filter((l): l is PersonResult[] => l !== null);
  return { characters: characterLookups.length ? group(characterLookups, limit) : EMPTY, guilds: guildLookups.length ? group(guildLookups, limit) : EMPTY };
}

/** Whether an addon guild is one of the armory guilds the search found. */
function inArmory(g: { realm: string; guildName: string }, armory: readonly ArmoryGuildHit[]): boolean {
  return armory.some((a) => sameGuild(g, { region: a.region, slug: a.slug, rulesetId: ARMORY_RULESETS.find((r) => r.label === a.ruleset)?.id ?? -1 }));
}

/** The one read, or null before its migration (and in development) or when it fails (logged), for the separate reads to answer. */
async function oneRead(text: string): Promise<SitePeople | null> {
  try { return await armoryStore().people(text, LOOKUP_CAP); } catch (err) { console.error("site search: the characters and guilds read failed", err); return null; }
}

/** A lookup's rows, or null when it failed (logged), so the group is built from the lookups that answered. */
async function orNone(read: () => Promise<PersonResult[]>): Promise<PersonResult[] | null> {
  try { return await read(); } catch (err) { console.error("site search: character or guild lookup failed", err); return null; }
}
