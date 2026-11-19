import { COVERAGE_NOT_MEASURED, type CoverageLoader } from "@kb/coverage-tool";
import { loadStoredCoverage } from "./coverage-summary";

/**
 * The score the MCP coverage tool answers from: the stored report for this build, the one the home page counts. When
 * it is missing, unreadable or for another build, the tool says the score is not measured yet. It never computes the
 * score from the corpus: that replay loaded the whole corpus into a request and ran the Worker out of memory (#1354).
 * `source` is never part of the stored file: it is added here, per answer.
 */
export async function loadCoverageForTool(deps: { stored?: typeof loadStoredCoverage } = {}): ReturnType<CoverageLoader> {
  const stored = await (deps.stored ?? loadStoredCoverage)();
  return stored ? { ...stored, source: "stored" } : COVERAGE_NOT_MEASURED;
}
