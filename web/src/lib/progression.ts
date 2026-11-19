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
