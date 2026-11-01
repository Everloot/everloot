import type { AppState, Job, JobState, JobStatus, Settings } from "../shared/types";

/** The renderer's text helpers; no DOM, so they are tested on their own. */

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never");
export const ago = (iso: string | null, now = Date.now()) => {
  if (!iso) return "never";
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(m)) return "unknown time";
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
export const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const gold = (copper: number | null) => {
  if (copper === null) return "–";
  const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
  return g ? `${g.toLocaleString()}g ${s}s` : s ? `${s}s ${c}c` : `${c}c`;
};
// IPC wraps a thrown error as "Error invoking remote method 'x': Error: ..."; the page shows only the reason.
export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': /, "").replace(/^(?:Type)?Error: /, "");

/**
 * What Settings says after Save. The app keeps the old value of a field it refuses (a site address that
 * is not http or https) and saves the rest; the page names that field instead of saying "Saved.".
 * "!" starts an error.
 */
export function savedNote(sent: { endpoint?: string; mcpUrl?: string }, saved: Settings): string {
  const refused = [
    sent.endpoint !== undefined && sent.endpoint.replace(/\/+$/, "") !== saved.endpoint ? "Site" : null,
    sent.mcpUrl !== undefined && sent.mcpUrl !== saved.ask.mcpUrl ? "Private MCP server" : null,
  ].filter(Boolean);
  return refused.length ? `!${refused.join(" and ")} was not saved: it needs an http:// or https:// address, so the old one is kept. Everything else was saved.` : "Saved.";
}

/** The setup screen's line about the addon in the picked folder: null while that is not known yet, or when it is there. */
export const setupAddonLine = (installed: string | null | undefined) => (installed === null ? "The Everloot addon is not in this folder yet. The game records nothing for the app to upload without it." : null);

/** What an answer's Copy button says: how the last press went, on that answer only, until the feedback runs out. */
export const copyLabel = (index: number, copied: { index: number; label: string } | null) => (copied?.index === index ? copied.label : "Copy");

export function statusText(j: JobStatus): string {
  switch (j.state) {
    case "off": return "Off";
    case "idle": return "Waiting for the next write";
    case "running": return "Running";
    case "ok": return j.message || "Done";
    case "error": return j.message;
  }
}

export type CompanionState = "setup" | "paused" | "error" | "running" | "off" | "idle";
/** The Overview headline: one answer from the three jobs. `jobs` are the ones the state is about, in upload, prices, ask order. */
export interface CompanionStatus { state: CompanionState; headline: string; detail: string; jobs: Job[] }

export const JOB_NAMES: Record<Job, string> = { upload: "Upload", prices: "Market prices", ask: "In-game /ask" };
const ORDER: Job[] = ["upload", "prices", "ask"];
const list = (jobs: Job[]) => { const n = jobs.map((j) => JOB_NAMES[j]); return n.length < 3 ? n.join(" and ") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`; };

/**
 * What the app is doing, truthfully. Checked in this order: no consent, no game folder, paused, any failure,
 * any job running, everything off, else waiting. "ok" describes a last run, so it counts as waiting, not as healthy.
 */
export function companionStatus(s: Pick<AppState, "settings" | "engine">): CompanionStatus {
  const { settings, engine } = s;
  const withState = (...states: JobState[]) => ORDER.filter((j) => states.includes(engine.jobs[j].state));
  const errors = withState("error"), running = withState("running");
  if (!settings.consentedAt) return { state: "setup", headline: "Finish setup", detail: "Choose a game folder and press Start. Nothing runs before that.", jobs: [] };
  if (!settings.gameFolder) return { state: "setup", headline: "Choose a game folder", detail: "Everloot needs the World of Warcraft folder that holds WTF before it can watch for the addon.", jobs: [] };
  if (engine.paused) {
    const notes = [running.length ? `${list(running)} ${running.length === 1 ? "was" : "were"} already running and may still finish.` : "", errors.length ? `${list(errors)} failed last time.` : ""].filter(Boolean);
    return { state: "paused", headline: "Paused", detail: ["Nothing new is scheduled until you resume.", ...notes].join(" "), jobs: [...errors, ...running] };
  }
  if (errors.length) {
    return { state: "error", headline: "Needs attention", detail: `${list(errors)} failed.${running.length ? ` ${list(running)} ${running.length === 1 ? "is" : "are"} running.` : ""}`, jobs: errors };
  }
  if (running.length) return { state: "running", headline: "Working", detail: `${list(running)} ${running.length === 1 ? "is" : "are"} running.`, jobs: running };
  if (ORDER.every((j) => engine.jobs[j].state === "off")) return { state: "off", headline: "Automatic jobs are off", detail: "Upload, market prices and /ask are all turned off. Turn one on below.", jobs: [] };
  const n = engine.files.length;
  // Only an enabled upload gets a schedule promise; otherwise name the jobs that are on.
  const on = ORDER.filter((j) => engine.jobs[j].state !== "off");
  const waiting = engine.jobs.upload.state !== "off" ? "The next upload starts after you log out of the game or /reload." : `Upload is off. ${list(on)} ${on.length === 1 ? "is" : "are"} waiting.`;
  return n
    ? { state: "idle", headline: `Watching ${n} account file${n === 1 ? "" : "s"}`, detail: waiting, jobs: [] }
    : { state: "idle", headline: "Waiting for the first addon file", detail: "Log out of the game once so the addon writes Everloot.lua. Setup is done.", jobs: [] };
}

/** A 96x24 line of a character's gold over time; nothing for fewer than two points. */
export function sparkline(points: { at: string; copper: number }[]): string {
  if (points.length < 2) return "";
  const w = 96, h = 24, lo = Math.min(...points.map((p) => p.copper)), hi = Math.max(...points.map((p) => p.copper));
  const y = (v: number) => (hi === lo ? h / 2 : h - 1 - ((v - lo) / (hi - lo)) * (h - 2));
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * (w - 1)).toFixed(1)},${y(p.copper).toFixed(1)}`).join(" ");
  const first = esc(points[0].at.slice(0, 10)), last = esc(points[points.length - 1].at.slice(0, 10));
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="gold from ${first} to ${last}"><title>${points.length} snapshots, ${first} to ${last}</title><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}
