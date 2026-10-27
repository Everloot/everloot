/**
 * The ecosystem tracker's pure core: the registry of Forever addons and tools, the GitHub metrics kept
 * for each, the Forever-ready check, badges, boards and the join with our own install counts.
 * No network and no file access here: the site, the MCP tool and the refresh command all read through it.
 * Everything is re-checked on the way in, so a hand-edited JSON file cannot widen a limit.
 */

import { INDEPENDENT_INSTALLS } from "./drop-rollup.js";
import { clampText, isoTime, safeHttpUrl } from "./text-safety.js";

export type ProjectKind = "addon" | "tool";

export interface RegistryProject {
  /** Lower-case slug, unique. */
  id: string;
  name: string;
  kind: ProjectKind;
  /** Our own words, at most 160 characters. */
  summary: string;
  /** GitHub "owner/name". */
  repo: string;
  /** Path of the main .toc inside the repo; read only to find its Interface number. */
  toc?: string;
  /** AddOns folder names as the in-game list shows them, for joining our install counts. */
  addonNames: string[];
  /** Day a maintainer checked the project is for WoW: Forever, and the page that shows it. */
  verifiedAt: string;
  evidence: string;
}

export interface Registry {
  schema: 1;
  projects: RegistryProject[];
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const REPO_PART = /^(?!\.+$)[A-Za-z0-9_.-]+$/;
const TOC_PATH = /^[A-Za-z0-9_./-]{1,200}\.toc$/;
const ADDON_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
export const MAX_PROJECTS = 200;

export const validRepo = (repo: unknown): repo is string => {
  if (typeof repo !== "string") return false;
  const parts = repo.split("/");
  return parts.length === 2 && parts.every((p) => REPO_PART.test(p));
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The registry, or an error naming the entry and field. Used by the refresh command, the site and the tests. */
export function parseRegistry(raw: unknown): Registry {
  if (!isRecord(raw) || raw.schema !== 1) throw new Error("ecosystem registry: schema must be 1");
  if (!Array.isArray(raw.projects)) throw new Error("ecosystem registry: projects must be a list");
  if (raw.projects.length > MAX_PROJECTS) throw new Error(`ecosystem registry: at most ${MAX_PROJECTS} projects`);
  const seen = new Set<string>();
  const projects = raw.projects.map((entry, i): RegistryProject => {
    const where = `ecosystem registry: project ${i + 1}`;
    if (!isRecord(entry)) throw new Error(`${where} is not an object`);
    const id = entry.id;
    if (typeof id !== "string" || !ID.test(id)) throw new Error(`${where} has a bad id`);
    if (seen.has(id)) throw new Error(`${where}: duplicate id ${id}`);
    seen.add(id);
    const name = clampText(entry.name, 60);
    if (!name) throw new Error(`${where} (${id}) is missing name`);
    if (entry.kind !== "addon" && entry.kind !== "tool") throw new Error(`${where} (${id}): kind must be addon or tool`);
    const summary = clampText(entry.summary, 160);
    if (!summary || String(entry.summary).length > 160) throw new Error(`${where} (${id}): summary is required and at most 160 characters`);
    if (!validRepo(entry.repo)) throw new Error(`${where} (${id}): repo must be owner/name`);
    if (entry.toc !== undefined && (typeof entry.toc !== "string" || !TOC_PATH.test(entry.toc) || entry.toc.includes(".."))) {
      throw new Error(`${where} (${id}): toc must be a path ending in .toc`);
    }
    const names = entry.addonNames ?? [];
    if (!Array.isArray(names) || names.length > 8 || !names.every((n) => typeof n === "string" && ADDON_NAME.test(n))) {
      throw new Error(`${where} (${id}): addonNames must be up to 8 folder names`);
    }
    const verifiedAt = typeof entry.verifiedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.verifiedAt) ? entry.verifiedAt : null;
    if (!verifiedAt) throw new Error(`${where} (${id}): verifiedAt must be YYYY-MM-DD`);
    const evidence = safeHttpUrl(entry.evidence);
    if (!evidence) throw new Error(`${where} (${id}): evidence must be a web link`);
    return {
      id, name, kind: entry.kind, summary, repo: entry.repo,
      ...(typeof entry.toc === "string" ? { toc: entry.toc } : {}),
      addonNames: names as string[], verifiedAt, evidence,
    };
  });
  return { schema: 1, projects };
}

// ---------------------------------------------------------------- metrics

export interface ProjectMetrics {
  /** ok: read; missing: the repository is gone or private. A project that could not be reached keeps its last ok entry. */
  status: "ok" | "missing";
  fetchedAt: string;
  stars: number | null;
  archived: boolean;
  /** SPDX id, or null ("NOASSERTION" counts as none). */
  license: string | null;
  /** Newest commit on the default branch, ISO time. */
  lastCommit: string | null;
  release: { tag: string; date: string; url: string } | null;
  /** Commits to the default branch in the last 28 days, merge commits included. Null when not read. */
  commits4w: number | null;
  /** Contributors with at least one commit. A count only: no names are kept. */
  contributors: number | null;
  openIssues: number | null;
  closedIssues: number | null;
  /** Median hours to the first reply from someone other than the author, over `responseSample` recent issues. Null when not measured. */
  medianFirstResponseHours: number | null;
  responseSample: number;
  /** Numbers from `## Interface:` in the .toc; null when no .toc was read. */
  interfaces: number[] | null;
}

export interface StarPoint { at: string; stars: number }

export interface Snapshot {
  schema: 1;
  /** When the last successful refresh finished, or null for an empty snapshot. */
  refreshedAt: string | null;
  projects: Record<string, ProjectMetrics>;
  /** One star count per UTC day, newest last, 35 days kept. Only the rising board reads it. */
  history: Record<string, StarPoint[]>;
}

export const EMPTY_SNAPSHOT: Snapshot = { schema: 1, refreshedAt: null, projects: {}, history: {} };

const count = (v: unknown, max = 100_000_000): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);

/** A stored entry with every limit applied again, or null when it cannot be shown. */
export function sanitizeMetrics(raw: unknown): ProjectMetrics | null {
  if (!isRecord(raw)) return null;
  const fetchedAt = isoTime(raw.fetchedAt);
  if (!fetchedAt || (raw.status !== "ok" && raw.status !== "missing")) return null;
  const rel = isRecord(raw.release) ? raw.release : null;
  const tag = rel ? clampText(rel.tag, 100) : "";
  const relDate = rel ? isoTime(rel.date) : null;
  const url = rel ? safeHttpUrl(rel.url) : null;
  const interfaces = Array.isArray(raw.interfaces)
    ? raw.interfaces.filter((n): n is number => Number.isInteger(n) && n > 0 && n < 10_000_000).slice(0, 16)
    : null;
  const response = typeof raw.medianFirstResponseHours === "number" && Number.isFinite(raw.medianFirstResponseHours) && raw.medianFirstResponseHours >= 0
    ? Math.round(raw.medianFirstResponseHours * 10) / 10
    : null;
  return {
    status: raw.status,
    fetchedAt,
    stars: count(raw.stars),
    archived: raw.archived === true,
    license: typeof raw.license === "string" && raw.license !== "NOASSERTION" ? clampText(raw.license, 40) || null : null,
    lastCommit: isoTime(raw.lastCommit),
    release: tag && relDate && url ? { tag, date: relDate, url } : null,
    commits4w: count(raw.commits4w),
    contributors: count(raw.contributors),
    openIssues: count(raw.openIssues),
    closedIssues: count(raw.closedIssues),
    medianFirstResponseHours: response,
    responseSample: count(raw.responseSample, 1000) ?? 0,
    interfaces,
  };
}

export function parseSnapshot(raw: unknown): Snapshot {
  if (!isRecord(raw) || raw.schema !== 1) return EMPTY_SNAPSHOT;
  const projects: Record<string, ProjectMetrics> = {};
  if (isRecord(raw.projects)) {
    for (const [id, value] of Object.entries(raw.projects)) {
      const metrics = sanitizeMetrics(value);
      if (metrics && ID.test(id)) projects[id] = metrics;
    }
  }
  const history: Record<string, StarPoint[]> = {};
  if (isRecord(raw.history)) {
    for (const [id, points] of Object.entries(raw.history)) {
      if (!ID.test(id) || !Array.isArray(points)) continue;
      history[id] = points
        .map((p) => (isRecord(p) ? { at: isoTime(p.at), stars: count(p.stars) } : null))
        .filter((p): p is StarPoint => p !== null && p.at !== null && p.stars !== null)
        .slice(-60);
    }
  }
  return { schema: 1, refreshedAt: isoTime(raw.refreshedAt), projects, history };
}

// ---------------------------------------------------------------- the math

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface IssueSample {
  createdAt: string;
  /** When someone other than the author, and not a bot, first replied; null if nobody has. */
  firstResponseAt: string | null;
}

/**
 * Median hours to the first reply. An issue nobody answered counts as its age, but only once it is a week
 * old: counting it as zero would flatter a silent project, and counting a new one would punish a busy one.
 * Returns null under three usable issues, because a median of one or two says nothing.
 */
export function medianFirstResponse(issues: readonly IssueSample[], now: Date): { hours: number | null; sample: number } {
  const hours: number[] = [];
  for (const issue of issues) {
    const created = Date.parse(issue.createdAt);
    if (!Number.isFinite(created)) continue;
    if (issue.firstResponseAt) {
      const replied = Date.parse(issue.firstResponseAt);
      if (Number.isFinite(replied) && replied >= created) hours.push((replied - created) / HOUR);
    } else if (now.getTime() - created >= 7 * DAY) {
      hours.push((now.getTime() - created) / HOUR);
    }
  }
  const m = hours.length >= 3 ? median(hours) : null;
  return { hours: m === null ? null : Math.round(m * 10) / 10, sample: hours.length };
}

/** Stars gained over the last week, from the newest point at least 6 days old; null without such a point. */
export function starGain(history: readonly StarPoint[], current: number | null, now: Date): number | null {
  if (current === null) return null;
  const cutoff = now.getTime() - 6 * DAY;
  const base = [...history].reverse().find((p) => Date.parse(p.at) <= cutoff);
  if (!base) return null;
  return current - base.stars;
}

const ageDays = (iso: string | null, now: Date) => (iso ? (now.getTime() - Date.parse(iso)) / DAY : null);

// ---------------------------------------------------------------- Forever-ready

export type ForeverReady = "yes" | "no" | "unknown";

/** The numbers on `## Interface:` lines of a .toc (a comma-separated list is allowed). */
export function parseTocInterfaces(toc: string): number[] {
  const out: number[] = [];
  for (const line of toc.split(/\r?\n/)) {
    const m = /^\s*##\s*Interface(?:-[A-Za-z]+)?\s*:\s*(.+)$/i.exec(line);
    if (!m) continue;
    for (const part of m[1].split(",")) {
      const n = /^\s*(\d{4,7})\s*$/.exec(part);
      if (n) out.push(Number(n[1]));
    }
  }
  return [...new Set(out)];
}

/**
 * The Interface number of a Forever build, with the build it was derived from. Blizzard's Interface numbers
 * follow the client version: 1.15.9 is 11509 (a number Olympus ships for the Classic Era build 1.15.9 in
 * kb/changes/builds.json), so 1.60.1 is 16001. The number is not written in the game files we can read:
 * Blizzard's own .toc files carry no `## Interface` line (checked on build 1.60.1.70450), because the client
 * computes it. So it is derived from the version service's version string and stamped with that build. Still
 * to be confirmed in the client with `/dump select(4, GetBuildInfo())`.
 */
export interface ForeverInterface { interface: number; version: string; build: number; derivedFrom: "version" }

/** major * 10000 + minor * 100 + patch, or null for anything that is not a plain x.y.z version. */
export function interfaceFromVersion(version: string): number | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{1,2})(?:\.\d+)?$/.exec(version.trim());
  return m ? Number(m[1]) * 10_000 + Number(m[2]) * 100 + Number(m[3]) : null;
}

/** The Forever products in the version service, WoW Forever's own and the beta (see PRODUCT_GAME in changes.ts). */
export const FOREVER_PRODUCTS: ReadonlySet<string> = new Set(["wowf", "wow_classic_beta"]);

/** The Interface number of the newest known Forever build, or null when none is known. */
export function currentForeverInterface(builds: readonly { product: string; version: string; buildId: number }[]): ForeverInterface | null {
  const newest = builds.filter((b) => FOREVER_PRODUCTS.has(b.product) && interfaceFromVersion(b.version) !== null)
    .sort((a, b) => b.buildId - a.buildId)[0];
  if (!newest) return null;
  return { interface: interfaceFromVersion(newest.version)!, version: newest.version, build: newest.buildId, derivedFrom: "version" };
}

/**
 * yes when the .toc lists the current Forever number, no when it lists numbers and none match (the game would
 * mark it out of date), unknown without a .toc or without a known Forever build.
 */
export function foreverReady(interfaces: readonly number[] | null | undefined, current: ForeverInterface | null): ForeverReady {
  if (!current || !interfaces || interfaces.length === 0) return "unknown";
  return interfaces.includes(current.interface) ? "yes" : "no";
}

// ---------------------------------------------------------------- badges and score

export const BADGES = {
  "forever-ready": "Forever-ready: its .toc lists an Interface number we accept for Forever",
  active: "Active: a commit in the last 30 days",
  "fresh-release": "Fresh release: a GitHub release in the last 30 days",
  responsive: "Responsive: median first reply within 48 hours over at least 3 recent issues",
  "open-license": "Licensed: its repository declares an open-source licence",
  archived: "Archived: the author has archived the repository",
} as const;
export type BadgeId = keyof typeof BADGES;

export function badgesFor(metrics: ProjectMetrics | null, ready: ForeverReady, now: Date): BadgeId[] {
  const out: BadgeId[] = [];
  if (ready === "yes") out.push("forever-ready");
  if (!metrics || metrics.status !== "ok") return out;
  const commitAge = ageDays(metrics.lastCommit, now);
  if (!metrics.archived && commitAge !== null && commitAge <= 30) out.push("active");
  const releaseAge = ageDays(metrics.release?.date ?? null, now);
  if (!metrics.archived && releaseAge !== null && releaseAge <= 30) out.push("fresh-release");
  if (metrics.medianFirstResponseHours !== null && metrics.medianFirstResponseHours <= 48) out.push("responsive");
  if (metrics.license) out.push("open-license");
  if (metrics.archived) out.push("archived");
  return out;
}

/**
 * Best-maintained score, 0 to 100, and the formula is public (docs/design/specs/2026-10-18-ecosystem-tracker.md).
 * Each part is worth points; a part GitHub cannot show for this project is left out of both sides, so a
 * project is never scored down for data that does not exist (no releases, few issues, no token). At least
 * 40 points must be measurable, or the score is null. Archived projects have no score.
 */
export function maintenanceScore(metrics: ProjectMetrics | null, now: Date): number | null {
  if (!metrics || metrics.status !== "ok" || metrics.archived) return null;
  let earned = 0;
  let available = 0;
  const commitAge = ageDays(metrics.lastCommit, now);
  if (commitAge !== null) {
    available += 30;
    earned += commitAge <= 30 ? 30 : commitAge <= 90 ? 15 : 0;
  }
  const releaseAge = ageDays(metrics.release?.date ?? null, now);
  if (releaseAge !== null) {
    available += 20;
    earned += releaseAge <= 180 ? 20 : releaseAge <= 365 ? 10 : 0;
  }
  if (metrics.openIssues !== null && metrics.closedIssues !== null && metrics.openIssues + metrics.closedIssues >= 5) {
    available += 20;
    earned += (20 * metrics.closedIssues) / (metrics.openIssues + metrics.closedIssues);
  }
  if (metrics.medianFirstResponseHours !== null) {
    available += 20;
    const h = metrics.medianFirstResponseHours;
    earned += h <= 24 ? 20 : h <= 72 ? 15 : h <= 168 ? 8 : 0;
  }
  available += 10;
  earned += metrics.license ? 10 : 0;
  return available >= 40 ? Math.round((earned / available) * 100) : null;
}

// ---------------------------------------------------------------- join and views

/** What the join needs from the install rollup (kb/src/addon-rollup.ts). */
export interface InstallCount { name: string; installs: number }

/**
 * Installs for a project: the most any of its folder names reaches, and only from three installs up. The
 * rollup already applies the rule; it is applied again here so a caller that passes raw counts cannot publish
 * a smaller number. Null means "not counted", never zero. The same install can report several folders of one
 * addon, so counts are not added together.
 */
export function joinInstalls(addonNames: readonly string[], popular: readonly InstallCount[] | null): number | null {
  if (!popular || addonNames.length === 0) return null;
  const wanted = new Set(addonNames.map((n) => n.toLowerCase()));
  const counts = popular.filter((a) => wanted.has(a.name.toLowerCase())).map((a) => a.installs);
  const best = counts.length ? Math.max(...counts) : 0;
  return best >= INDEPENDENT_INSTALLS ? best : null;
}

export interface ProjectView {
  id: string;
  name: string;
  kind: ProjectKind;
  summary: string;
  repo: string;
  url: string;
  addonNames: string[];
  installs: number | null;
  metrics: ProjectMetrics | null;
  foreverReady: ForeverReady;
  badges: BadgeId[];
  maintenanceScore: number | null;
  starGain7d: number | null;
}

export interface EcosystemView {
  refreshedAt: string | null;
  /** What Forever-ready is compared against, stamped with its build; null when no Forever build is known. */
  forever: ForeverInterface | null;
  projects: ProjectView[];
  /** False when our install counts could not be read: "not counted" then means "unknown". */
  installsAvailable: boolean;
}

export function buildView(registry: Registry, snapshot: Snapshot, popular: readonly InstallCount[] | null, now: Date, forever: ForeverInterface | null): EcosystemView {
  const projects = registry.projects.map((p): ProjectView => {
    const metrics = snapshot.projects[p.id] ?? null;
    const ready = foreverReady(metrics?.status === "ok" ? metrics.interfaces : null, forever);
    return {
      id: p.id, name: p.name, kind: p.kind, summary: p.summary, repo: p.repo,
      url: `https://github.com/${p.repo}`,
      addonNames: p.addonNames,
      installs: joinInstalls(p.addonNames, popular),
      metrics,
      foreverReady: ready,
      badges: badgesFor(metrics, ready, now),
      maintenanceScore: maintenanceScore(metrics, now),
      starGain7d: metrics?.status === "ok" ? starGain(snapshot.history[p.id] ?? [], metrics.stars, now) : null,
    };
  });
  return { refreshedAt: snapshot.refreshedAt, forever, projects, installsAvailable: popular !== null };
}

// ---------------------------------------------------------------- boards

import { BOARD_IDS, ECOSYSTEM_BOARD_FILTERS, type BoardId } from "@everloot/protocol";
export { BOARD_IDS, ECOSYSTEM_BOARD_FILTERS, type BoardId };

export interface BoardRow { project: ProjectView; display: string }
export interface Board { id: BoardId; title: string; rule: string; rows: BoardRow[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dayOf = (iso: string) => iso.slice(0, 10);
const ranked = (v: ProjectView) => v.metrics?.status === "ok" && !v.metrics.archived;
const byName = (a: ProjectView, b: ProjectView) => a.name.localeCompare(b.name);

/**
 * The five boards. Ties break on the name, so the order never depends on registry order. Archived projects and
 * projects whose repository is gone appear on no board. Boards rank projects, never people.
 */
export function buildBoards(view: EcosystemView, now: Date): Board[] {
  const live = view.projects.filter(ranked);
  const rank = (items: ProjectView[], value: (v: ProjectView) => number, display: (v: ProjectView) => string, tie?: (a: ProjectView, b: ProjectView) => number): BoardRow[] =>
    [...items].sort((a, b) => value(b) - value(a) || (tie?.(a, b) ?? 0) || byName(a, b)).map((project) => ({ project, display: display(project) }));
  const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

  return [
    {
      id: "installed", title: "Most installed",
      rule: `Installs from Everloot uploads, listed from ${INDEPENDENT_INSTALLS} installs up.`,
      rows: rank(view.projects.filter((v) => ranked(v) && v.installs !== null), (v) => v.installs!, (v) => plural(v.installs!, "install", "installs")),
    },
    {
      id: "rising", title: "Rising",
      rule: "Stars gained over the last 7 days, from the daily star counts we keep. Needs a week of history.",
      rows: rank(live.filter((v) => (v.starGain7d ?? 0) > 0), (v) => v.starGain7d!, (v) => `+${plural(v.starGain7d!, "star", "stars")} in 7 days`),
    },
    {
      id: "active", title: "Most active",
      rule: "Commits to the default branch in the last 4 weeks.",
      rows: rank(live.filter((v) => (v.metrics!.commits4w ?? 0) > 0), (v) => v.metrics!.commits4w!, (v) => plural(v.metrics!.commits4w!, "commit", "commits") + " in 4 weeks", (a, b) => time(b.metrics!.lastCommit) - time(a.metrics!.lastCommit)),
    },
    {
      id: "release", title: "Freshest release",
      rule: "Newest GitHub release by date.",
      rows: rank(live.filter((v) => v.metrics!.release), (v) => time(v.metrics!.release!.date), (v) => `${v.metrics!.release!.tag}, ${dayOf(v.metrics!.release!.date)}`),
    },
    {
      id: "maintained", title: "Best maintained",
      rule: "A 0 to 100 score from recent commits, recent releases, issues closed, first-reply time and a declared licence. Parts GitHub cannot show are left out, not counted as zero.",
      rows: rank(live.filter((v) => v.maintenanceScore !== null), (v) => v.maintenanceScore!, (v) => `${v.maintenanceScore} of 100`, (a, b) => time(b.metrics!.lastCommit) - time(a.metrics!.lastCommit)),
    },
  ].map((b) => ({ ...b, rows: b.rows })) as Board[];
}

// ---------------------------------------------------------------- MCP answer

export interface EcosystemArgs {
  board: (typeof ECOSYSTEM_BOARD_FILTERS)[number];
  forever_ready_only?: boolean;
  limit: number;
}

/** The text the `ecosystem_projects` tool returns. Null view means the tracker is not connected. */
/** The rows the tool shows for these arguments: a board's ranking or the A to Z list, filtered and cut to the limit. */
export function pickEcosystemRows(view: EcosystemView, args: EcosystemArgs, now: Date): BoardRow[] {
  const limit = Math.min(Math.max(Math.trunc(args.limit), 1), 25);
  let rows: BoardRow[];
  if (args.board === "all") {
    rows = [...view.projects].sort(byName).map((project) => ({ project, display: "" }));
  } else {
    rows = buildBoards(view, now).find((b) => b.id === args.board)!.rows;
  }
  if (args.forever_ready_only) rows = rows.filter((r) => r.project.foreverReady === "yes");
  return rows.slice(0, limit);
}

/** The structured answer beside the text: the same rows, with GitHub facts flattened and the data's state stated. */
export function ecosystemProjectsStructured(view: EcosystemView | null, args: EcosystemArgs, now: Date = new Date()): object {
  if (!view) return { connected: false, refreshedAt: null, installsAvailable: false, forever: null, board: args.board, projects: [] };
  const projects = pickEcosystemRows(view, args, now).map(({ project: p, display }, i) => {
    const m = p.metrics?.status === "ok" ? p.metrics : null;
    return {
      ...(args.board === "all" ? {} : { rank: i + 1 }),
      ...(display ? { display } : {}),
      id: p.id, name: p.name, kind: p.kind, summary: p.summary, repo: p.repo, url: p.url,
      installs: p.installs, stars: m?.stars ?? null, release: m?.release ?? null, lastCommit: m?.lastCommit ?? null, commits4w: m?.commits4w ?? null,
      foreverReady: p.foreverReady, badges: p.badges, maintenanceScore: p.maintenanceScore,
    };
  });
  const forever = view.forever ? { interface: view.forever.interface, version: view.forever.version, build: view.forever.build } : null;
  return { connected: true, refreshedAt: view.refreshedAt, installsAvailable: view.installsAvailable, forever, board: args.board, projects };
}

export function handleEcosystemProjects(view: EcosystemView | null, args: EcosystemArgs, now: Date = new Date()): string {
  if (!view) return "The ecosystem tracker is not connected here. This is not an empty list.";
  const age = view.refreshedAt ? `GitHub data refreshed ${view.refreshedAt.slice(0, 16).replace("T", " ")} UTC.` : "GitHub data not refreshed yet.";
  const lines: string[] = [];
  const shown = pickEcosystemRows(view, args, now);
  if (shown.length === 0) {
    return `No projects match. ${age}${view.installsAvailable ? "" : " Install counts are unavailable right now."}`;
  }
  for (const [i, { project: p, display }] of shown.entries()) {
    const m = p.metrics?.status === "ok" ? p.metrics : null;
    const bits = [
      display || null,
      p.installs !== null ? plural(p.installs, "install", "installs") : null,
      m?.stars != null ? plural(m.stars, "star", "stars") : null,
      m?.release ? `release ${m.release.tag} (${dayOf(m.release.date)})` : null,
      m?.lastCommit ? `last commit ${dayOf(m.lastCommit)}` : null,
      `Forever-ready: ${p.foreverReady === "unknown" ? "not checked" : p.foreverReady}`,
    ].filter(Boolean);
    lines.push(`${args.board === "all" ? "-" : `${i + 1}.`} ${p.name} [${p.kind}]: ${p.summary}\n   ${bits.join(" · ")}\n   Repository: ${p.url}`);
  }
  const notes = [
    age,
    "Stars, releases and commits are read from GitHub's public API; installs are Everloot upload counts, listed from 3 installs, and a missing count means not counted.",
    view.forever
      ? `Forever-ready compares each .toc with Interface ${view.forever.interface}, derived from Forever build ${view.forever.version} and not yet confirmed in the client.`
      : "Forever-ready is not checked: no Forever build is known.",
    view.installsAvailable ? null : "Install counts are unavailable right now.",
  ].filter(Boolean);
  return `${lines.join("\n")}\n\n${notes.join(" ")}`;
}
