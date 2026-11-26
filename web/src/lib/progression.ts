import { guildProgression, guildProgressionScore } from "@kb/guild-progression";
import { unstable_cache } from "next/cache";
import { characterProgression, dungeonProgress, progressionCatalogue, rosterProgression } from "@kb/progression";
import { armoryOn, isArmoryRegion, validArmorySlug } from "./armory";
import type { ArmoryMember } from "./armory-store";
import { progressionByLink, progressionStore, type PublicHistory } from "./progression-store";
import { bossKillSyncOn, instanceClearsOn } from "./boss-kill-sync";
import { dungeonsAndRaids, instanceClears } from "./dungeon-clears";
import { instanceHref, instanceRows } from "./instances";
import { loadInstanceFacts } from "./rollup-compute";

async function catalogueData() {
  const facts = await loadInstanceFacts().catch(() => null);
  const available = facts && !facts.unreachable ? facts : null;
  const catalogue = progressionCatalogue(available);
  const pages = instanceRows(available ? { instances: available } : {});
  const links = Object.fromEntries([...pages].map(([id, r]) => [id, instanceHref(id, r.name)]));
  return { catalogue, links };
}

export type ProgressionMember = ArmoryMember & { region: string };
const key = (r: { region: string; slug: string }) => `${r.region}/${r.slug}`;

/** Public linked histories only. The RPC checks suppression and hides; no viewer identity is read. */
async function histories(characters: readonly { region: string; slug: string }[]) {
  const unique = [...new Map(characters.filter((c) => isArmoryRegion(c.region) && validArmorySlug(c.slug)).map((c) => [key(c), c])).values()]
    .sort((a, b) => key(a).localeCompare(key(b)));
  const rows: PublicHistory[] = [];
  try {
    // Bound each request, including exceptionally large armory rosters.
    for (let i = 0; i < unique.length; i += 1000) rows.push(...await progressionStore().characters(unique.slice(i, i + 1000)));
  } catch { return new Map<string, PublicHistory["kills"]>(); }
  return new Map(rows.map((r) => [key(r), r.kills]));
}

export async function loadCharacterProgression(region: string, slug: string) {
  const [{ catalogue, links }, kills] = await Promise.all([catalogueData(), histories([{ region, slug }])]);
  const history = kills.get(`${region}/${slug}`) ?? null;
  const instances = characterProgression(catalogue, history);
  return { instances, links, summary: dungeonProgress(history), dungeons: dungeonsAndRaids(instances, history, links) };
}

/** Public clears of one instance; null while the switch is off or storage does not answer, so the page leaves the section out. */
export async function loadInstanceClears(mapId: number) {
  if (!armoryOn() || !instanceClearsOn()) return null;
  try { return instanceClears(mapId, await progressionStore().instance(mapId)); } catch { return null; }
}

export async function loadLinkedDungeonProgress(ruleset: string, realm: string, name: string) {
  if (!armoryOn() || !bossKillSyncOn()) return null;
  const history = await progressionByLink({ ruleset, realm, name });
  return history ? { ...history, summary: dungeonProgress(history.kills) } : null;
}

async function rosterHistories(members: readonly ProgressionMember[]) {
  const unique = [...new Map(members.map((m) => [`${m.region}/${m.characterSlug}`, m])).values()];
  const kills = await histories(unique.map((m) => ({ region: m.region, slug: m.characterSlug })));
  return unique.map((member) => ({ member, kills: kills.get(`${member.region}/${member.characterSlug}`) ?? null }));
}

export async function loadRosterProgression(members: readonly ProgressionMember[]) {
  const [{ catalogue, links }, roster] = await Promise.all([catalogueData(), rosterHistories(members)]);
  return { instances: rosterProgression(catalogue, roster), links };
}

export async function loadGuildProgression(members: readonly ProgressionMember[]) {
  const [{ catalogue, links }, roster] = await Promise.all([catalogueData(), rosterHistories(members)]);
  return { instances: guildProgression(catalogue, roster), score: guildProgressionScore(catalogue, roster), links };
}

export interface GuildProgressionRank { region: string; slug: string; name: string; score: number }

/** Cache the bounded board too, so ordinary requests do not regroup the regional histories. */
const cachedRanking = unstable_cache(async (region: string | null): Promise<GuildProgressionRank[]> => {
  const [{ catalogue }, rows] = await Promise.all([catalogueData(), progressionStore().region(region)]);
  const guilds = new Map<string, { region: string; slug: string; name: string; members: Map<string, PublicHistory> }>();
  for (const r of rows) {
    const id = `${r.region}/${r.guild_slug}`;
    let guild = guilds.get(id);
    if (!guild) guilds.set(id, guild = { region: r.region, slug: r.guild_slug, name: r.guild_name, members: new Map() });
    guild.members.set(r.slug, r);
  }
  return [...guilds.values()].map((g) => ({ region: g.region, slug: g.slug, name: g.name,
    score: guildProgressionScore(catalogue, [...g.members.values()]) }))
    .filter((g) => g.score > 0)
    .sort((a, b) => b.score - a.score || a.region.localeCompare(b.region) || a.slug.localeCompare(b.slug)).slice(0, 100);
}, ["public-guild-progression-ranking"], { revalidate: 300, tags: ["players", "guilds"] });

export async function loadGuildProgressionRanking(region: string | null): Promise<GuildProgressionRank[]> {
  if (region !== null && !isArmoryRegion(region)) return [];
  try { return await cachedRanking(region); } catch { return []; }
}
