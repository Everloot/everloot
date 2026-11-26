import Link from "next/link";
import { cache } from "react";
import type { Fact } from "@/components/ui";
import {
  armoryBoardHref, isArmoryRegion, metricOfKey, PLAY_HISTORY_METRICS, rankText, regionLabel, slugFromSegment, validArmorySlug, ARMORY_BOARDS,
} from "@/lib/armory";
import { armoryStore, type ArmoryCharacter, type ArmoryRank } from "@/lib/armory-store";
import { loadCatalog } from "@/lib/completion-lists";
import { loadCharacterProgression } from "@/lib/progression";
import type { CharacterTabId, SheetParts } from "../../character-tabs";
import type { HistoryRank } from "../../profile";
import { link } from "../../parts";
import type { RankBadge } from "./sheet";

/**
 * The character page's reads, each once per request (React cache): the page, its metadata and a tab opened later each
 * ask for what they need and share the answer. Every read goes to storage on every request, so a hide applies at once.
 */

/** The character, null when there is none (or the address is not one), "unreachable" when storage did not answer. */
export const loadCharacter = cache(async (region: string, segment: string): Promise<ArmoryCharacter | null | "unreachable"> => {
  const slug = slugFromSegment(segment);
  if (!isArmoryRegion(region) || slug === null || !validArmorySlug(slug)) return null;
  try { return await armoryStore().character(region, slug); } catch { return "unreachable"; }
});

/** A rank the store cannot give leaves the ranks out; the rest of the page stands. */
export const loadRanks = cache((region: string, slug: string): Promise<ArmoryRank[]> =>
  armoryStore().rank(region, slug).catch(() => [] as ArmoryRank[]));

export const loadProgression = cache((region: string, slug: string) => loadCharacterProgression(region, slug));

/** Achievement category names come from player reports only (the game files carry the id); none read leaves "Other". */
async function loadCategories(c: ArmoryCharacter): Promise<Map<number, string>> {
  if (!c.details?.achievements?.rows.length) return new Map();
  return loadCatalog()
    .then((cat) => new Map((cat?.achievements ?? []).flatMap((a) => (a.category ? [[a.achievementId, a.category] as const] : []))))
    .catch(() => new Map<number, string>());
}

const historyKeys = new Set<string>(PLAY_HISTORY_METRICS.map((m) => ARMORY_BOARDS[m].key));
const boardHref = (c: ArmoryCharacter, metric: Parameters<typeof armoryBoardHref>[0]) =>
  armoryBoardHref(metric, { region: isArmoryRegion(c.region) ? c.region : null, ruleset: c.rulesetId });

/** The honorable-kills rank sits with the kills in the PvP tab; the gear ranks stay with the numbers above the tabs. */
function pvpFacts(c: ArmoryCharacter, ranks: ArmoryRank[]): Fact[] {
  return ranks.filter((r) => r.metric === "honorable_kills").flatMap((r) => {
    const metric = metricOfKey(r.metric);
    if (!metric) return [];
    return [{ label: `${ARMORY_BOARDS[metric].title} rank`, value: <Link href={boardHref(c, metric)} className={link}>{rankText(r)}</Link>, numeric: true }];
  });
}

/** The play-history ranks sit beside their counts in the Play history tab. */
function historyRanks(c: ArmoryCharacter, ranks: ArmoryRank[]): HistoryRank[] {
  return ranks.flatMap((r) => {
    const metric = metricOfKey(r.metric);
    return metric && historyKeys.has(r.metric)
      ? [{ metric, rank: r.rank, of: r.of, ...(r.tied === undefined ? {} : { tied: r.tied }), href: boardHref(c, metric) }]
      : [];
  });
}

/**
 * Every rank but the play-history ones shows as a badge under the facts strip, scoped by region and ruleset, in the
 * same words as every other rank (rankText: the tie count and top share once the database returns them).
 */
export function rankBadges(c: ArmoryCharacter, ranks: ArmoryRank[]): RankBadge[] {
  return ranks.flatMap((r) => {
    const metric = metricOfKey(r.metric);
    if (!metric || historyKeys.has(r.metric)) return [];
    return [{ label: `${regionLabel(c.region)} ${c.ruleset} · ${ARMORY_BOARDS[metric].title} ${rankText(r)}`, href: boardHref(c, metric) }];
  });
}

/** What one tab needs beyond the character, read only for that tab. */
export async function tabParts(c: ArmoryCharacter, id: CharacterTabId): Promise<SheetParts> {
  switch (id) {
    case "achievements": return { categories: await loadCategories(c) };
    case "pvp": return { pvpFacts: pvpFacts(c, await loadRanks(c.region, c.slug)) };
    case "history": return { historyRanks: historyRanks(c, await loadRanks(c.region, c.slug)) };
    case "progress": return { progression: await loadProgression(c.region, c.slug) };
    default: return {};
  }
}
