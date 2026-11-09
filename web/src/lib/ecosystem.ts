import registryFile from "../../../kb/curated/ecosystem.json";
import snapshotFile from "../../../kb/changes/ecosystem.json";
import buildsFile from "../../../kb/changes/builds.json";
import { buildView, currentForeverInterface, parseRegistry, parseSnapshot, type EcosystemView } from "../../../kb/src/ecosystem";
import { loadPopularAddons } from "./rollup-compute";

export {
  BADGES, BOARD_IDS, buildBoards, starGainLabel,
  type Board, type BadgeId, type EcosystemView, type ProjectView,
} from "../../../kb/src/ecosystem";

/** The refresh keeps one count per day; past this many hours the addon pages say the GitHub facts are old. */
export const STALE_AFTER_HOURS = 26;

/** "older than 26 hours" when the snapshot is that old by `now`; null when it is fresh or there is none. */
export function staleNote(refreshedAt: string | null, now: Date = new Date()): string | null {
  return refreshedAt && now.getTime() - Date.parse(refreshedAt) > STALE_AFTER_HOURS * 3_600_000 ? `older than ${STALE_AFTER_HOURS} hours` : null;
}

/**
 * The registry (kb/curated/ecosystem.json) and the GitHub snapshot (kb/changes/ecosystem.json) are bundled
 * with the site, so a new refresh reaches visitors with the next deploy. Install counts are read live from the
 * same rollup as /addons/popular, which already lists an addon only from three installs.
 */
const registry = parseRegistry(registryFile);
const snapshot = parseSnapshot(snapshotFile);
// The newest Forever build the version service reported (kb/changes/builds.json, kept fresh by the changes
// workflow), so Forever-ready moves with the build instead of a number someone typed in.
const forever = currentForeverInterface((buildsFile as unknown as { builds: { product: string; version: string; buildId: number }[] }).builds);

export async function loadEcosystem(now: Date = new Date()): Promise<EcosystemView> {
  let popular: { name: string; installs: number }[] | null = null;
  try {
    const usage = await loadPopularAddons();
    popular = usage.unreachable ? null : usage.addons;
  } catch {
    popular = null;
  }
  return buildView(registry, snapshot, popular, now, forever);
}
