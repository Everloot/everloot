import { hideHome } from "../shared/diagnostics";
import { ago, gold as goldOrDash } from "../renderer/format";
import type { CharactersInfo, Job, JobStatus, LogLine, ScanAge, UpdateCheck } from "../shared/types";

/**
 * Tools the chat model can call that read the player's own save files on this computer, beside
 * the MCP server's tools over Everloot's public data. They return text only, nothing leaves the
 * machine through them, and each result ends with a Source line so the page lists it like any
 * other. The reads go through the same functions the Characters and Market pages use. Paths are
 * shown with the user folder hidden, as Copy diagnostics does, since the text goes to the provider.
 */

export interface LocalTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(input: Record<string, unknown>): string;
}

export interface LocalData {
  characters(): CharactersInfo;
  /** Every realm's last full scan, newest first; at is null when a realm was never scanned. */
  scans(): ScanAge[];
  /** The realms the player follows for the prices file. */
  followed(): string[];
  status(): AppStatus;
}

/** What the app knows about itself, for the status tool: the same facts the Overview shows. */
export interface AppStatus {
  version: string;
  gameFolder: string | null;
  files: number;
  paused: boolean;
  switches: Record<Job, boolean>;
  jobs: Record<Job, JobStatus>;
  addonInstalled: string | null;
  update: UpdateCheck | null;
  /** The newest error lines from the log, newest last. */
  errors: LogLine[];
}

export const LOCAL_SOURCE = "this computer (your Everloot.lua; shared with your selected model provider for this answer)";
export const STATUS_SOURCE = "this computer (the Everloot Desktop App's own status)";

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

/** The page's gold text, with "unknown" rather than a dash for the model. */
export const gold = (copper: number | null): string => (copper === null ? "unknown" : goldOrDash(copper));

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

const JOB_LABEL: Record<Job, string> = { upload: "Upload", prices: "Prices", ask: "/ask answers" };

const jobLine = (job: Job, on: boolean, j: JobStatus): string => {
  if (!on) return `${JOB_LABEL[job]}: turned off in Settings`;
  const when = j.at ? ` at ${j.at}` : "";
  switch (j.state) {
    case "off": return `${JOB_LABEL[job]}: off`;
    case "idle": return `${JOB_LABEL[job]}: on, waiting for the next write to the save file`;
    case "running": return `${JOB_LABEL[job]}: running now`;
    case "ok": return `${JOB_LABEL[job]}: ok${when}${j.message ? `, ${j.message}` : ""}`;
    case "error": return `${JOB_LABEL[job]}: FAILED${when}: ${j.message}`;
  }
};

export function localTools(data: LocalData, now: () => number = Date.now): LocalTool[] {
  return [
    {
      name: "my_characters",
      description: "The player's own characters from the save files on this computer: gold now and at its peak, gold earned and spent in the last seven days, item level and gear slots, level and class, achievements, exalted reputations and titles. Use for any question about the player's characters, gold or progress.",
      inputSchema: NO_ARGS,
      run: () => {
        const info = data.characters();
        if (!info.characters.length && !info.progress.length) return `No characters in the account files yet. The addon writes them after a login; the app reads Everloot.lua from the game folder.\nSource: ${LOCAL_SOURCE}`;
        const lines = info.characters.map((c) => {
          const net = c.week.earned - c.week.spent;
          const parts = [`${c.character}-${c.realm}: ${gold(c.gold)}`];
          if (c.peakGold !== null && c.peakGold !== c.gold) parts.push(`peak ${gold(c.peakGold)}`);
          parts.push(`last 7 days earned ${gold(c.week.earned)}, spent ${gold(c.week.spent)}, net ${net < 0 ? "-" : "+"}${gold(Math.abs(net))}`);
          if (c.itemLevel !== null) parts.push(`item level ${c.itemLevel} over ${c.gearSlots} slots`);
          if (sum(c.spent)) parts.push(`spent by category all time: ${Object.entries(c.spent).map(([k, v]) => `${k} ${gold(v)}`).join(", ")}`);
          return parts.join("; ");
        });
        for (const p of info.progress) {
          lines.push(`${p.key}: level ${p.level} ${p.class}, ${p.achievements} achievements (${p.achievementsInProgress} in progress), ${p.exalted} of ${p.reputations} reputations exalted, ${p.titles} titles`);
        }
        return `${lines.join("\n")}\nSource: ${LOCAL_SOURCE}`;
      },
    },
    {
      name: "my_realm_scans",
      description: "When the player last ran a full auction house scan on each realm, and which realms the prices file follows. Use for questions about scan freshness, which realms have the player's data, or whether to scan again.",
      inputSchema: NO_ARGS,
      run: () => {
        const t = now();
        const scans = data.scans();
        const followed = data.followed();
        const lines = scans.map((s) => `${s.realm}: last full scan ${s.at ? `${s.at} (${ago(s.at, t)})` : "never"}`);
        if (!lines.length) lines.push("No auction scans in the account files yet. A scan is started in game with the addon's scan button.");
        lines.push(followed.length ? `Realms followed for the prices file: ${followed.join(", ")}` : "No realms followed for the prices file beyond the scanned ones.");
        return `${lines.join("\n")}\nSource: ${LOCAL_SOURCE}`;
      },
    },
    {
      name: "my_app_status",
      description: "What the Everloot Desktop App is doing on this computer: the game folder and account files it watches, whether upload, prices and /ask answers are on and their last result or error, the installed addon version, whether a newer app release exists, and the latest error lines from its log. Use when the player asks whether their data is uploading, why something failed, or what version they run.",
      inputSchema: NO_ARGS,
      run: () => {
        const s = data.status();
        const lines = [
          `Everloot Desktop App ${s.version}${s.paused ? ", paused from the tray" : ""}`,
          s.gameFolder ? `Game folder: ${hideHome(s.gameFolder)}, watching ${s.files} account file${s.files === 1 ? "" : "s"}${s.files ? "" : " (no Everloot.lua found; log in once with the addon enabled)"}` : "Game folder: not set; the app does nothing until Settings points at the product folder",
          ...(["upload", "prices", "ask"] as Job[]).map((job) => jobLine(job, s.switches[job], s.jobs[job])),
          s.addonInstalled ? `Addon installed: ${s.addonInstalled}` : "Addon: not installed in that game folder; the Addon page installs it",
          s.update ? (s.update.newer ? `A newer app release exists: ${s.update.latest} (current ${s.update.current}); the Overview links to it` : `App release: current (${s.update.current})`) : "App release check: not run yet or GitHub unreachable",
        ];
        if (s.errors.length) lines.push("Latest errors in the log:", ...s.errors.map((l) => `  ${l.at} ${hideHome(l.text)}`));
        else lines.push("No errors in the log.");
        return `${lines.join("\n")}\nSource: ${STATUS_SOURCE}`;
      },
    },
  ];
}
