import { parseCoverageExpected, type CoverageExpected, type CoverageInput } from "@kb/coverage";
import { buildFolder, privateStoreFromEnv, type PrivateStore } from "./game-assets";
import { CLIENT_LAYER } from "./items";
import { assetsBaseUrl } from "./talents/assets";
import type { Corpus } from "./upload-store";
import { WORLD_MAP } from "./world-map";
import { RECHECK_SCOPES } from "./recheck-scopes";
import { placedEntrances, publicZones } from "./zones";

export { RECHECK_SCOPES } from "./recheck-scopes";

/** The client build the score is for: the build the site's game files are read from. */
export const COVERAGE_BUILD = CLIENT_LAYER.build.version;

/**
 * The counts-only expected file the maintainer's `coverage-report` writes, uploaded to the private bucket's folder
 * for the build (`<build folder>/coverage-expected.json`, beside the item names): the folder is what ties it to a
 * build. Null when it is missing, malformed or holds anything but counts: the score then has no denominator and
 * the pages show the reported facts alone. Never throws.
 */
export async function loadCoverageExpected(base: string | null = assetsBaseUrl(), store: PrivateStore | null = privateStoreFromEnv()): Promise<CoverageExpected | null> {
  const folder = base ? buildFolder(base) : null;
  if (!folder || !store) return null;
  return parseCoverageExpected(await store.read(`${folder}/coverage-expected.json`));
}

/**
 * The score's input for one corpus: the released zones, the entrances the game files place, the expected counts and
 * the recheck scopes. `asOf` is the time of the last real change (the snapshot's), never the time this ran.
 */
export function coverageInput(corpus: Pick<Corpus, "records" | "dataAsOf">, expected: CoverageExpected | null, asOf: string | null = corpus.dataAsOf ?? null): CoverageInput {
  const fileEntrances = placedEntrances(WORLD_MAP).flatMap((e) => (e.files && e.zone ? [{ instanceMapIds: e.instanceMapIds, zone: e.zone.mapId }] : []));
  return {
    records: corpus.records, asOf, build: COVERAGE_BUILD,
    zones: publicZones().map((z) => ({ mapId: z.mapId, name: z.name })),
    heldBack: WORLD_MAP.heldBackZones.map((z) => z.uiMapId),
    fileEntrances, expected, recheck: RECHECK_SCOPES,
  };
}
