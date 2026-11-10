import type { LoadedCoverage } from "../../../kb/src/coverage-tool";
import { loadCoverage } from "./coverage-compute";
import { loadStoredCoverage } from "./coverage-summary";

/**
 * The score the MCP coverage tool answers from. The stored report for this build is what the home page counts, so it
 * is read first and nothing replays the corpus while it is usable. Only when it is missing, unreadable or for another
 * build does the tool compute the score live, as the coverage pages do, and the answer's date line says which it was.
 * `source` is never part of the stored file: it is added here, per answer.
 */
export async function loadCoverageForTool(deps: { stored?: typeof loadStoredCoverage; live?: typeof loadCoverage } = {}): Promise<LoadedCoverage | null> {
  const stored = await (deps.stored ?? loadStoredCoverage)();
  if (stored) return { ...stored, source: "stored" };
  const live = await (deps.live ?? loadCoverage)();
  return live ? { ...live, source: "live" } : null;
}
