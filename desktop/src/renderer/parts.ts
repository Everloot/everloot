// Pieces of the page that need no DOM: each returns HTML for app.ts to place, so a test can read the markup.
import type { EngineState, JobStatus } from "../shared/types";

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

/** The title bar's pill: what the app watches, or that it is paused, which matters more. */
export function watchPill(e: Pick<EngineState, "files" | "paused">): string {
  if (e.paused) return '<span class="pill-s pill-paused">Paused</span>';
  const n = e.files.length;
  return n ? `<span class="pill-s pill-ok">Watching ${n} file${n === 1 ? "" : "s"}</span>` : '<span class="pill-s pill-off">Not watching</span>';
}
