import { existsSync, readFileSync, statSync } from "node:fs";
import { parseEverlootLua } from "../../../web/src/lib/sv-parse";
import { readAsks } from "../../../companion/src/bridge/asks";
import { parseEverlootTable } from "../../../web/src/lib/sv-parse";
import { readRealms } from "../../../companion/src/prices";
import { receiptKeyForSite } from "../../../companion/src/sent-state";
import type { FileSummary, ScanAge } from "../shared/types";

/** When the player last ran a full scan on each realm (`EverlootDB.lastScans`), newest first. */
export function readScanAges(text: string): ScanAge[] {
  let db: Record<string, unknown>;
  try { db = parseEverlootTable(text); } catch { return []; }
  const scans = db.lastScans;
  if (!scans || typeof scans !== "object") return [];
  const out: ScanAge[] = [];
  for (const [realm, v] of Object.entries(scans as Record<string, unknown>)) {
    const at = v && typeof v === "object" && typeof (v as { at?: unknown }).at === "string" ? (v as { at: string }).at : null;
    if (realm.trim().length >= 2) out.push({ realm: realm.trim(), at });
  }
  return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
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

/** One parse per file write: the summary is remembered by size and mtime, only the confirmed count is live. */
const memo = new Map<string, { key: string; summary: Omit<FileSummary, "file" | "writtenAt" | "bytes" | "confirmed">; installId: string | null }>();

export function summarizeFiles(files: string[], sentPath: string, endpoint = "https://everloot.app"): FileSummary[] {
  const confirmedFor = confirmedCounts(sentPath, endpoint);
  return files.map((file) => {
    let st: ReturnType<typeof statSync>;
    try { st = statSync(file); }
    catch (err) { return { file, writtenAt: null, bytes: 0, ...summarizeSavedVariables("", () => 0), ok: false, error: err instanceof Error ? err.message : String(err) }; }
    const key = `${st.mtimeMs}:${st.size}`;
    let hit = memo.get(file);
    if (!hit || hit.key !== key) {
      let text = "";
      try { text = readFileSync(file, "utf8"); } catch (err) { return { file, writtenAt: st.mtime.toISOString(), bytes: st.size, ...summarizeSavedVariables("", () => 0), ok: false, error: err instanceof Error ? err.message : String(err) }; }
      let installId: string | null = null;
      const { confirmed: _confirmed, ...summary } = summarizeSavedVariables(text, (id) => { installId = id; return 0; });
      hit = { key, summary, installId };
      memo.set(file, hit);
    }
    return { file, writtenAt: st.mtime.toISOString(), bytes: st.size, ...hit.summary, confirmed: hit.installId ? confirmedFor(hit.installId) : 0 };
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
