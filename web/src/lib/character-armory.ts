import { z } from "zod";
import { armoryOn } from "./armory";
import { armoryStore, type ArmoryCharacter } from "./armory-store";
import { authQuery } from "./supabase/server";

/**
 * Blizzard's data on a linked character's own page (data policy, amended 17 November 2026): the armory character the
 * link is associated with (armory_links), read from the armory tables on every request and never copied anywhere, so a
 * row the armory deletes (30 days unrefreshed, a 404 or a hide) is gone from the page at once. On the public page each
 * part shows only while the page's existing switch for it is on; the owner's preview shows every part.
 */

/** The page switches that gate each part of Blizzard's data. Achievements and completed quests share Collections. */
export interface ArmoryShown {
  gear: boolean; stats: boolean; talents: boolean; pvp: boolean; professions: boolean; reputations: boolean; collections: boolean;
  history: boolean;
}
export const ALL_SHOWN: ArmoryShown = { gear: true, stats: true, talents: true, pvp: true, professions: true, reputations: true, collections: true, history: true };
/** The character_visibility column behind each part. */
export const BLIZZARD_SWITCH: Record<keyof ArmoryShown, string> = {
  gear: "show_gear", stats: "show_stats", talents: "show_talents", pvp: "show_pvp", professions: "show_professions",
  reputations: "show_reputations", collections: "show_collections", history: "show_history",
};
export const BLIZZARD_PARTS = Object.keys(BLIZZARD_SWITCH) as (keyof ArmoryShown)[];

export interface CharacterArmory { character: ArmoryCharacter; shown: ArmoryShown }

const PublicRow = z.object({
  region: z.enum(["us", "eu"]), slug: z.string().min(1),
  show_gear: z.boolean(), show_stats: z.boolean(), show_talents: z.boolean(), show_pvp: z.boolean(),
  show_professions: z.boolean(), show_reputations: z.boolean(), show_collections: z.boolean(),
  // Off when the database predates 20261121100000, so the page keeps working until it is applied.
  show_history: z.boolean().default(false),
});

/**
 * The public page's part: null when the armory is off, the character has no association, its page is not public, or
 * every switch is off. `public_character_armory` repeats the page's own checks (live link, public page, no hide, no
 * frozen claim) and the association's identity match. A failed read leaves the part out rather than taking the page down.
 */
export async function publicCharacterArmory(ruleset: string, realm: string, name: string): Promise<CharacterArmory | null> {
  if (!armoryOn()) return null;
  try {
    const rows = await authQuery<unknown>("rpc/public_character_armory", {
      method: "POST", body: JSON.stringify({ p_ruleset: ruleset, p_realm_slug: realm, p_name: name }),
    });
    const row = z.array(PublicRow).parse(rows)[0];
    if (!row) return null;
    const shown: ArmoryShown = {
      gear: row.show_gear, stats: row.show_stats, talents: row.show_talents, pvp: row.show_pvp,
      professions: row.show_professions, reputations: row.show_reputations, collections: row.show_collections,
      history: row.show_history,
    };
    if (!Object.values(shown).some(Boolean)) return null;
    const character = await armoryStore().character(row.region, row.slug);
    return character ? { character, shown } : null;
  } catch {
    return null;
  }
}

/** The owner's preview: every part, for one of the account's own links. Null without an association or on a failed read. */
export async function ownCharacterArmory(userId: string, linkId: string): Promise<CharacterArmory | null> {
  if (!armoryOn()) return null;
  try {
    const rows = await authQuery<unknown>("rpc/armory_own_links", { method: "POST", body: JSON.stringify({ p_user_id: userId }) });
    const own = z.array(z.object({ link_id: z.string(), region: z.enum(["us", "eu"]), slug: z.string() })).parse(rows).find((r) => r.link_id === linkId);
    if (!own) return null;
    const character = await armoryStore().character(own.region, own.slug);
    return character ? { character, shown: ALL_SHOWN } : null;
  } catch {
    return null;
  }
}

/** The character as its shown parts allow: a part switched off is removed here, so it never reaches the markup. */
export function shownCharacter(c: ArmoryCharacter, shown: ArmoryShown): ArmoryCharacter {
  const d = c.details;
  return {
    ...c,
    equipment: shown.gear ? c.equipment : [],
    itemLevel: shown.gear ? c.itemLevel : null,
    gearScore: shown.gear ? c.gearScore : null,
    equippedItemLevel: shown.gear ? c.equippedItemLevel : null,
    averageItemLevel: shown.gear ? c.averageItemLevel : null,
    honorableKills: shown.pvp ? c.honorableKills : null,
    pvpRank: shown.pvp ? c.pvpRank : null,
    details: d && {
      revision: d.revision,
      ...(shown.stats && d.statistics ? { statistics: d.statistics } : {}),
      ...(shown.talents && d.talents ? { talents: d.talents } : {}),
      ...(shown.professions && d.professions ? { professions: d.professions } : {}),
      ...(shown.reputations && d.reputations ? { reputations: d.reputations } : {}),
      ...(shown.collections && d.achievements ? { achievements: d.achievements } : {}),
      ...(shown.collections && d.quests ? { quests: d.quests } : {}),
      ...(shown.history && d.playHistory ? { playHistory: d.playHistory } : {}),
    },
  };
}
