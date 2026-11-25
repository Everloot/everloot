import type { RulesetSlug } from "../data/realms";
import { armoryOn, isArmoryRegion, type ArmoryRegion } from "./armory";
import { armoryGuildHidden, guildSlugOf } from "./armory-guilds";
import { armoryStore, type ArmoryGuild } from "./armory-store";
import { guildSearchPrefix, guildsOn, loadGuildPage, loadGuildSearch, type GuildPageData } from "./guilds";
import { guildSlug } from "@kb/guilds";
import { playerStore } from "./player-store";
import { realmInfo, realmParts } from "./realms";

/**
 * One page per guild (#1272): the armory page (/armory/<region>/guilds/<slug>) is the guild's page, and an addon
 * guild page (/guilds/<realm>/<guild>) redirects there for good when the armory has that guild.
 *
 * The match rule. The addon names a guild by realm and name; the armory by region and slug, with the ruleset on the
 * row. Forever's realm names carry both of the others ("CAMWOW US1 Realm 3 PvE": US, Normal), so an addon guild is
 * the armory guild with:
 * - the region the realm map gives, else the "US1"/"EU2" word in the realm's name;
 * - the slug of its name as the armory makes it (guildSlugOf: lower case, spaces as hyphens, accents kept);
 * - the same ruleset, when the realm's map line or name ending says one. A realm that says none matches on region
 *   and slug alone; a ruleset the armory has no id for (Hardcore) matches nothing.
 * Checked on the live data on 2026-11-25: Fatal, Merthy and Je me Souviens on "CAMWOW US1 Realm 3 PvE" are the US
 * Normal armory guilds of those names, and Glizzy Gang is a different guild on EU and US.
 */

/** The armory's ruleset ids (ARMORY_RULESETS) by the realm map's ruleset slug. */
const ARMORY_RULESET_ID: Record<RulesetSlug, number | undefined> = { pvp: 1, normal: 2, rp: 3, "rp-pvp": 15, hardcore: undefined };

const REGION_WORD = /(?:^|[\s-])(us|eu)\d*(?=[\s-]|$)/i;

export interface ArmoryGuildKey { region: ArmoryRegion; slug: string; rulesetId: number | null }

/** The armory key an addon guild would have, or null when its realm names no armory region or its ruleset has no armory id. */
export function armoryKeyOf(realm: string, guildName: string): ArmoryGuildKey | null {
  const mapped = realmInfo(realm)?.region;
  const region = mapped ?? REGION_WORD.exec(realm)?.[1]?.toLowerCase();
  if (!isArmoryRegion(region)) return null;
  const slug = guildSlugOf(guildName);
  if (slug === null) return null;
  const ruleset = realmParts(realm).ruleset;
  if (ruleset === null) return { region, slug, rulesetId: null };
  const rulesetId = ARMORY_RULESET_ID[ruleset];
  return rulesetId === undefined ? null : { region, slug, rulesetId };
}

/** Whether an addon guild (realm and name) is this armory guild. */
export function sameGuild(addon: { realm: string; guildName: string }, armory: Pick<ArmoryGuild, "region" | "slug" | "rulesetId">): boolean {
  const key = armoryKeyOf(addon.realm, addon.guildName);
  return key !== null && key.region === armory.region && key.slug === armory.slug && (key.rulesetId === null || key.rulesetId === armory.rulesetId);
}

/**
 * The armory guild an addon guild is, or null: with the armory off, no such guild stored, the guild hidden through
 * /guilds/hide, or the armory or the hide list out of reach (the addon page then stays, as it was). Never a throw.
 */
export async function armoryGuildOf(realm: string, guildName: string): Promise<ArmoryGuild | null> {
  if (!armoryOn()) return null;
  const key = armoryKeyOf(realm, guildName);
  if (!key) return null;
  try {
    const [guild, hidden] = await Promise.all([armoryStore().guild(key.region, key.slug), playerStore().hiddenGuilds()]);
    if (!guild || !sameGuild({ realm, guildName }, guild)) return null;
    return armoryGuildHidden(hidden, guild.region, guild.name) ? null : guild;
  } catch {
    return null;
  }
}

/**
 * What the addon knows of an armory guild: the addon guild page's data (members seen, agreed kills, the officers'
 * board) for the first addon guild that matches, or null with the guild pages off, none matching or the data out of
 * reach. Hidden guilds and characters are already out of what loadGuildPage returns. Never a throw.
 */
export async function addonGuildOf(guild: ArmoryGuild): Promise<GuildPageData | null> {
  if (!guildsOn()) return null;
  const prefix = guildSearchPrefix(guild.name);
  if (!prefix) return null;
  try {
    const found = await loadGuildSearch(prefix.toLowerCase());
    const match = found.results.find((g) => sameGuild(g, guild));
    if (!match) return null;
    const loaded = await loadGuildPage(guildSlug(match.realm), guildSlug(match.guildName));
    return loaded === "unreachable" ? null : loaded;
  } catch {
    return null;
  }
}
