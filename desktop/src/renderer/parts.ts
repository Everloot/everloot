// Pieces of the page that need no DOM: each returns HTML for app.ts to place, so a test can read the markup.
import type { EngineState, Job, JobStatus, LogLine, Settings } from "../shared/types";
import { clock, esc } from "./format";

/** A pill's look and the word it carries, per job state. `paused` wins for every job that is on. */
export type PillKind = "working" | "failed" | "ok" | "off" | "waiting" | "paused";
const PILL: Record<JobStatus["state"], [PillKind, string]> = {
  running: ["working", "Working"],
  error: ["failed", "Failed"],
  ok: ["ok", "OK"],
  off: ["off", "Off"],
  idle: ["waiting", "Waiting"],
};

export function pillKind(j: JobStatus, paused: boolean): PillKind {
  return paused && j.state !== "off" ? "paused" : PILL[j.state][0];
}

/** The rail's and the strips' state pill: a visible word, and a turning ring while the job works. */
export function statePill(j: JobStatus, paused: boolean): string {
  const kind = pillKind(j, paused);
  const label = kind === "paused" ? "Paused" : PILL[j.state][1];
  const ring = kind === "working" ? '<i class="pill-ring" aria-hidden="true"></i>' : "";
  return `<span class="pill-s pill-${kind}">${ring}${label}</span>`;
}

// ---------- empty states: the real reason a page has nothing, and the one thing that fills it ----------

export type EmptyPage = "characters" | "upload" | "market" | "ask" | "log" | "changes";
/** The one control under an empty state: a page to open, a job to run, or a link to open. */
export interface EmptyAction { label: string; page?: string; run?: Job; open?: string }
export interface Empty { cause: string; step: string; action?: EmptyAction }
type EmptyContext = { settings: Pick<Settings, "gameFolder" | "upload" | "ask">; engine: Pick<EngineState, "files" | "paused"> };

const EMPTY_DEFAULT: Record<EmptyPage, Empty> = {
  characters: { cause: "Save file read, no named character rows yet", step: "The addon records gold and gear while you play" },
  upload: { cause: "Nothing sent yet", step: "The first upload runs after your next logout", action: { label: "Upload now", run: "upload" } },
  market: { cause: "No full scan in your save file yet", step: "At the auction house, press Everloot scan" },
  ask: { cause: "No question waiting", step: "Type /ask in game, then /reload" },
  log: { cause: "Nothing logged since start", step: "" },
  changes: { cause: "No changes fetched yet", step: "" },
};

/**
 * Why a page is empty, from the engine's own state, most fundamental first: no folder, no save file, paused, the job
 * off, a fetch error, and only then "no data yet" with what produces it.
 */
export function emptyCause(page: EmptyPage, s: EmptyContext, extra: { error?: string } = {}): Empty {
  // The changes feed comes from the site, not the game: the folder and the jobs say nothing about it.
  if (page === "changes") return extra.error ? { cause: extra.error, step: "Try again", action: { label: "Retry", page } } : EMPTY_DEFAULT.changes;
  if (!s.settings.gameFolder) return { cause: "Not watching a game folder", step: "Choose it in Settings", action: { label: "Open Settings", page: "settings" } };
  if (!s.engine.files.length) return { cause: `No Everloot.lua under ${s.settings.gameFolder} yet`, step: "Log out once in the game so it writes the file" };
  if (s.engine.paused) return { cause: "Everloot is paused", step: "Resume on the Overview", action: { label: "Overview", page: "overview" } };
  if (page === "upload" && !s.settings.upload) return { cause: "Upload is off", step: "Turn it on above" };
  if (page === "ask" && !s.settings.ask.enabled) return { cause: "/ask is off", step: "Turn it on above" };
  if (extra.error) return { cause: extra.error, step: "Try again", action: { label: "Retry", page } };
  return EMPTY_DEFAULT[page];
}

/** The block itself: the page's icon, the cause in bold, the step under it, and the action at the end. */
export function emptyState(e: Empty, icon: string): string {
  const a = e.action;
  const attr = a ? (a.page ? `data-page="${esc(a.page)}"` : a.run ? `data-run="${a.run}"` : `data-open="${esc(a.open ?? "")}"`) : "";
  const button = a ? `<button type="button" class="btn small" ${attr}>${esc(a.label)}</button>` : "";
  return `<div class="empty">${icon}<div class="empty-text"><p class="empty-cause">${esc(e.cause)}</p>${e.step ? `<p class="empty-step muted">${esc(e.step)}</p>` : ""}</div>${button}</div>`;
}

// ---------- the thread: the engine's log as the steps the app took ----------

/** Which job wrote a log line. The engine prefixes a job's lines with its name, then an account or a colon. */
export function jobOfLine(text: string): Job | "app" {
  const m = /^(upload|prices|ask)(?=[ :])/.exec(text);
  return m ? (m[1] as Job) : "app";
}

/**
 * The last `n` lines, oldest first so the thread reads down to now, each with its time, its job's icon and its
 * text; errors in the danger colour and the newest marked. An empty log gives "" so the caller can say why.
 */
export function threadLines(log: LogLine[], n: number, icons: Record<Job | "app", string>): string {
  const lines = log.slice(-n);
  return lines.map((l, i) => {
    const job = jobOfLine(l.text);
    const last = i === lines.length - 1 ? " step-last" : "";
    return `<div class="step step-${l.level}${last}" data-job="${job}"><time>${clock(l.at)}</time>${icons[job]}<span class="step-text">${esc(l.text)}</span></div>`;
  }).join("");
}

/**
 * A job page's first row: the state pill, what the job is doing in a sentence, and the last line it wrote with its
 * time. It is a live region, so a screen reader hears the job move without leaving the page.
 */
export function workingStrip(job: Job, s: { engine: Pick<EngineState, "jobs" | "paused"> }, headline: string, lastLine: LogLine | null): string {
  const j = s.engine.jobs[job];
  const kind = pillKind(j, s.engine.paused);
  const last = lastLine ? `<p class="strip-last"><time>${clock(lastLine.at)}</time>${esc(lastLine.text)}</p>` : "";
  return `<section class="strip strip-${kind}" aria-live="polite">${statePill(j, s.engine.paused)}<div class="strip-main"><p class="strip-head">${esc(headline)}</p>${last}</div></section>`;
}

/**
 * The Characters page before any data: the profile's outline, drawn dashed and dim so the player sees what the
 * addon will fill in. Decorative only; the empty state above it says why it is empty.
 */
export function ghostProfile(): string {
  const cols = Array.from({ length: 7 }, () => '<div class="wk-col"></div>').join("");
  const rows = Array.from({ length: 3 }, () => '<tr><td><span class="ghost-line"></span></td><td class="num"><span class="ghost-line short"></span></td><td class="num"><span class="ghost-line short"></span></td><td class="num"><span class="ghost-line short"></span></td><td class="num"><span class="ghost-line short"></span></td></tr>').join("");
  return `<div class="ghost" aria-hidden="true">
    <div class="char-hero">
      <section class="panel river-card"><div class="row between"><h2>30-day money river</h2><span class="muted small">earned and spent, by day</span></div><div class="river"></div></section>
      <section class="panel week-card"><div class="row between"><h2>This week</h2><span class="muted small">earned above · spent below</span></div><div class="week-bars">${cols}</div></section>
    </div>
    <section class="panel"><div class="row between"><h2>Roster</h2><span class="muted small">gold, 7 days, item level, last seen</span></div>
      <div class="tablewrap"><table class="roster"><thead><tr><th>Character</th><th class="num">Gold</th><th class="num">7 days</th><th class="num">Item level</th><th class="num">Last seen</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
  </div>`;
}

/** The title bar's pill: what the app watches, or that it is paused, which matters more. */
export function watchPill(e: Pick<EngineState, "files" | "paused">): string {
  if (e.paused) return '<span class="pill-s pill-paused">Paused</span>';
  const n = e.files.length;
  return n ? `<span class="pill-s pill-ok">Watching ${n} file${n === 1 ? "" : "s"}</span>` : '<span class="pill-s pill-off">Not watching</span>';
}
