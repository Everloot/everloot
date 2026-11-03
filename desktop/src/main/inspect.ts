import { existsSync, readFileSync, statSync, type Stats } from "node:fs";
import { parseEverlootLua } from "../../../web/src/lib/sv-parse";
import { readAsks } from "../../../companion/src/bridge/asks";
import { parseEverlootTable } from "../../../web/src/lib/sv-parse";
import { readRealms } from "../../../companion/src/prices";
import { saveFacts, scanAgesIn, type SaveFacts } from "./save-facts";
import { receiptKeyForSite } from "../../../companion/src/sent-state";
import type { FileSummary, ScanAge } from "../shared/types";

/** When the player last ran a full scan on each realm (`EverlootDB.lastScans`), newest first. */
export function readScanAges(text: string): ScanAge[] {
  let db: Record<string, unknown>;
  try { db = parseEverlootTable(text); } catch { return []; }
  return scanAgesIn(db);
}

export function summarizeSavedVariables(text: string, confirmedFor: (installId: string) => number): Omit<FileSummary, "file" | "writtenAt" | "bytes"> {
  try {
    const parsed = parseEverlootLua(text);
    const counts = new Map<string, number>();
    for (const r of parsed.records) counts.set(String(r.kind), (counts.get(String(r.kind)) ?? 0) + 1);
    const kinds = [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
    let pendingAsks = 0;
    try { pendingAsks = readAsks(text).length; } catch { /* asks are optional */ }
    return {
      ok: true, error: null,
      addonVersion: parsed.version, clientBuild: parsed.clientBuild ?? null,
      kinds, records: parsed.records.length,
      confirmed: confirmedFor(parsed.installId),
      pendingAsks,
      scanRealms: readRealms(text),
      scans: readScanAges(text),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), addonVersion: null, clientBuild: null, kinds: [], records: 0, confirmed: 0, pendingAsks: 0, scanRealms: [], scans: [] };
  }
}

/** Confirmed event counts per install from the companion's sent.json; an unreadable file counts nothing. */
export function confirmedCounts(sentPath: string, endpoint = "https://everloot.app"): (installId: string) => number {
  let sent: Record<string, string[]> = {};
  try { if (existsSync(sentPath)) sent = JSON.parse(readFileSync(sentPath, "utf8")) as Record<string, string[]>; } catch { sent = {}; }
  return (installId) => { const ids = sent?.[receiptKeyForSite(installId, endpoint)]; return Array.isArray(ids) ? ids.length : 0; };
}

/**
 * The Upload page: what summarizeSavedVariables gives for each file, from the parse saveFacts keeps per write (the jobs
 * and the other pages read the same one); only the confirmed count is read live, from sent.json.
 */
export function summarizeFiles(files: string[], sentPath: string, endpoint = "https://everloot.app"): FileSummary[] {
  const confirmedFor = confirmedCounts(sentPath, endpoint);
  const failed = (file: string, st: Stats | null, err: unknown): FileSummary => ({
    file, writtenAt: st ? st.mtime.toISOString() : null, bytes: st ? st.size : 0, ...summarizeSavedVariables("", () => 0), ok: false, error: err instanceof Error ? err.message : String(err),
  });
  return files.map((file) => {
    let st: Stats;
    try { st = statSync(file); } catch (err) { return failed(file, null, err); }
    let facts: SaveFacts;
    try { facts = saveFacts(file); } catch (err) { return failed(file, st, err); }
    const { installId, error, ...upload } = facts.upload;
    if (error) return failed(file, st, error);
    return {
      file, writtenAt: st.mtime.toISOString(), bytes: st.size, ok: true, error: null, ...upload,
      confirmed: installId ? confirmedFor(installId) : 0, pendingAsks: facts.asks.length, scanRealms: facts.realms, scans: facts.scans,
    };
  });
}

export const SCAN_STALE_MS = 24 * 3600 * 1000;

/** Realms whose last full scan is older than `maxAge` or has no date, oldest first; a softer reminder than scanning for the player. */
/** One entry per realm across every account file, the newest scan winning, newest first. */
export function newestScans(all: ScanAge[]): ScanAge[] {
  const best = new Map<string, ScanAge>();
  for (const s of all) {
    const b = best.get(s.realm);
    if (!b || (s.at ?? "") > (b.at ?? "")) best.set(s.realm, s);
  }
  return [...best.values()].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

export function staleScans(scans: ScanAge[], now = Date.now(), maxAge = SCAN_STALE_MS): ScanAge[] {
  return scans.filter((s) => !s.at || now - new Date(s.at).getTime() > maxAge).sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/** "Scan Firemaw again: last full scan 3 d ago (+1 more)", or null when every realm is fresh. */
export function scanReminder(stale: ScanAge[], now = Date.now()): string | null {
  const s = stale[0];
  if (!s) return null;
  const more = stale.length > 1 ? ` (+${stale.length - 1} more)` : "";
  if (!s.at) return `Scan ${s.realm} again: no dated scan${more}`;
  return `Scan ${s.realm} again: last full scan ${Math.round((now - new Date(s.at).getTime()) / 86400000)} d ago${more}`;
}
