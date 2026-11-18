import { NextResponse } from "next/server";
import { admit, attribution, attributionHeaders } from "@/lib/data-guard";
import { DISENCHANT_BUILD, disenchantBands, disenchantGameData, loadDisenchant } from "@/lib/disenchant";
import { recordUsage } from "@/lib/usage-metrics";

/**
 * GET /api/rollups/disenchant — what each disenchant band of the current build yields, from the disenchants players
 * recorded. A band's materials are public once three installs disenchanted in it. Small enough to send whole: one row
 * per band of the game files, so it is never paged. The Desktop App writes it into the addon's price file.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  recordUsage("api.rollups_disenchant");
  const admitted = await admit(req, "drops");
  if (admitted instanceof Response) return admitted;
  const view = await loadDisenchant();
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    dataAsOf: view.dataAsOf,
    unreachable: view.unreachable,
    build: DISENCHANT_BUILD,
    bands: disenchantBands(view.yields),
    unplaced: view.tables.unplaced,
    attribution: attribution("/tools/disenchanting"),
    gameData: disenchantGameData(),
  }, { headers: attributionHeaders() });
}
