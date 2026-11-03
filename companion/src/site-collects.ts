import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readStateFile } from "./state-file";

/** What a site's last receipt for a batch with run records said: whether it reads them, and when (ms since epoch). */
export interface SiteAnswer { collects: boolean; at: number }

/**
 * Whether each site collects `instance_run` and `pull_summary` rows (`RUN_RECORD_KINDS`), as its last intake receipt for
 * a batch that carried them said, kept beside sent.json. The file is written only once such a batch was sent, so an
 * install whose addon never writes those rows never gets one.
 */
export function createSiteCollects(path: string, onRecovery: (message: string) => void = console.warn) {
  const answers = new Map<string, SiteAnswer>();
  const raw = readStateFile(path, (value): value is Record<string, SiteAnswer> =>
    value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every((a) => a !== null && typeof a === "object" && typeof (a as SiteAnswer).collects === "boolean" && Number.isFinite((a as SiteAnswer).at)), onRecovery);
  for (const [origin, answer] of Object.entries(raw ?? {})) answers.set(origin, answer);
  return {
    get(origin: string): SiteAnswer | undefined {
      return answers.get(origin);
    },
    set(origin: string, answer: SiteAnswer): void {
      answers.set(origin, answer);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(Object.fromEntries(answers)));
      renameSync(`${path}.tmp`, path);
    },
  };
}

export type SiteCollects = ReturnType<typeof createSiteCollects>;

/** True once the site's last answer said it reads runs and pull summaries; false before any answer. */
export function siteReadsRuns(path: string, endpoint: string): boolean {
  try { return createSiteCollects(path, () => {}).get(new URL(endpoint).origin)?.collects === true; } catch { return false; }
}
