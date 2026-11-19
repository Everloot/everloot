import { guildProgression, guildProgressionScore } from "@kb/guild-progression";
import { armoryGuildHidden, isDisbandedGuild } from "./armory-guilds";
import { playerStore } from "./player-store";
import { z } from "zod";
import { characterProgression, progressionCatalogue, rosterProgression, type ProgressionKill } from "@kb/progression";
import { armoryCharacterPath, isArmoryRegion, validArmorySlug } from "./armory";
import { ownArmoryLinks } from "./armory-links";
import { armoryStore, type ArmoryMember } from "./armory-store";
import { bossKillSyncOn } from "./boss-kill-sync";
import { ownBossKills } from "./boss-kill-sync-store";
import { instanceHref, instanceRows } from "./instances";
import { loadInstanceFacts } from "./rollup-compute";
import { getUser } from "./supabase/server";

const Capture = z.object({
  sync: z.boolean(), capturedAt: z.string().datetime({ offset: true }).nullable(),
  kills: z.array(z.object({
    encounterId: z.number().int().positive(), instanceMapId: z.number().int().positive(),
    lastKillAt: z.string().datetime({ offset: true }),
  })).nullable(),
});

async function catalogueData() {
  const facts = await loadInstanceFacts().catch(() => null);
  const available = facts && !facts.unreachable ? facts : null;
  const catalogue = progressionCatalogue(available);
  // The instance route uses these same rows. File-only entries without a page stay plain text.
  const pages = instanceRows(available ? { instances: available } : {});
  const links = Object.fromEntries([...pages].map(([id, r]) => [id, instanceHref(id, r.name)]));
  return { catalogue, links };
}

async function owner() {
  if (!bossKillSyncOn()) return null;
  try {
    const user = await getUser();
    if (!user) return null;
    return { userId: user.id, links: await ownArmoryLinks(user.id) };
  } catch { return null; }
}

async function history(region: string, slug: string, account: Awaited<ReturnType<typeof owner>>): Promise<ProgressionKill[] | null> {
  if (!account || !isArmoryRegion(region) || !validArmorySlug(slug)) return null;
  try {
    const path = armoryCharacterPath(region, slug);
    const linkId = [...account.links].find(([, value]) => value === path)?.[0];
    if (!linkId) return null;
    // Only linked members need a read; repeat the hide check for callers other than the character page.
    if (!await armoryStore().character(region, slug)) return null;
    // This RPC checks ownership, consent and current linked status on every read. Frozen links return no capture.
    const parsed = Capture.safeParse(await ownBossKills(account.userId, linkId));
    if (!parsed.success || !parsed.data.sync || !parsed.data.capturedAt) return null;
    return parsed.data.kills;
  } catch { return null; }
}

/**
 * Request-scoped character Progress tab. No shared cache: #1275 is undecided, so boss history is
 * visible only to the signed-in linked owner with separate boss-kill consent and both sync gates on.
 * Anonymous/other viewers, missing captures and failed reads get the complete catalogue with no data.
 */
export async function loadCharacterProgression(region: string, slug: string) {
  const [{ catalogue, links }, account] = await Promise.all([catalogueData(), owner()]);
  return { instances: characterProgression(catalogue, await history(region, slug, account)), links };
}

export type ProgressionMember = ArmoryMember & { region: string };

/**
 * Guild follow-up entry point: loadRosterProgression(roster.map(m => ({ ...m, region: guild.region }))).
 * Uses one catalogue and one account-link read. Until a public-history decision, only the current
 * owner's consented histories participate; everyone else stays in the "no data" member list.
 * The guild page must remain dynamic and must not put these results in a shared cache.
 */
export async function loadRosterProgression(members: readonly ProgressionMember[]) {
  const [{ catalogue, links }, account] = await Promise.all([catalogueData(), owner()]);
  const roster = await Promise.all(members.map(async (member) => ({ member, kills: await history(member.region, member.characterSlug, account) })));
  return { instances: rosterProgression(catalogue, roster), links };
}

/** Deduplicate roster characters before counting; all reads remain scoped to this request's owner. */
async function rosterHistories(members: readonly ProgressionMember[], account: Awaited<ReturnType<typeof owner>>) {
  const unique = [...new Map(members.map((m) => [`${m.region}/${m.characterSlug}`, m])).values()];
  return Promise.all(unique.map(async (member) => ({ kills: await history(member.region, member.characterSlug, account) })));
}

export async function loadGuildProgression(members: readonly ProgressionMember[]) {
  const [{ catalogue, links }, account] = await Promise.all([catalogueData(), owner()]);
  const roster = await rosterHistories(members, account);
  return { instances: guildProgression(catalogue, roster), score: guildProgressionScore(catalogue, roster), links };
}

export interface GuildProgressionRank { region: string; slug: string; name: string; score: number }

/**
 * Request-only ranking. Under owner-only history, only guilds of linked characters can score.
 * Recheck each guild, its hide status and its current roster; never infer membership from uploads.
 */
export async function loadGuildProgressionRanking(region: string | null): Promise<GuildProgressionRank[]> {
  const account = await owner();
  if (!account) return [];
  try {
    const store = armoryStore();
    const hidden = await playerStore().hiddenGuilds();
    const candidates = new Map<string, { region: string; slug: string }>();
    for (const path of account.links.values()) {
      const [, , r, slug] = path.split("/");
      if (!r || !slug || (region !== null && region !== r)) continue;
      const character = await store.character(r, decodeURIComponent(slug));
      if (character?.guildSlug) candidates.set(`${r}/${character.guildSlug}`, { region: r, slug: character.guildSlug });
    }
    if (!candidates.size) return [];
    const { catalogue } = await catalogueData();
    const rows = await Promise.all([...candidates.values()].map(async (g) => {
      const guild = await store.guild(g.region, g.slug);
      if (!guild || isDisbandedGuild(guild.name) || armoryGuildHidden(hidden, guild.region, guild.name)) return null;
      const members = (await store.roster(g.region, g.slug)).map((m) => ({ ...m, region: g.region }));
      const score = guildProgressionScore(catalogue, await rosterHistories(members, account));
      return score > 0 ? { region: g.region, slug: g.slug, name: guild.name, score } : null;
    }));
    return rows.filter((r): r is GuildProgressionRank => r !== null)
      .sort((a, b) => b.score - a.score || a.region.localeCompare(b.region) || a.slug.localeCompare(b.slug));
  } catch { return []; }
}
