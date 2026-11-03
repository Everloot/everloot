// What GitHub's public REST API says about an addon's repository, cached for an hour per request.
// GITHUB_TOKEN is optional; without it GitHub allows 60 requests an hour per IP, which a shared host
// can exhaust, so a profile costs six requests and the answer says when the limit was the reason.
// A failed answer is remembered for a few minutes, so an outage costs one short call per repo, not six per view.
// Nothing here throws: a missing repo and an unreachable GitHub are different answers, and a page
// that cannot be filled in still renders.

import { plainNotes } from "./plain-notes";

const API = "https://api.github.com";
const SEGMENT = /^(?!\.+$)[A-Za-z0-9_.-]+$/;
const validRepo = (repo: string) => repo.split("/").length === 2 && repo.split("/").every((part) => SEGMENT.test(part));
const FAILURE_MS = 5 * 60_000;
const TIMEOUT_MS = 3000;
const GITHUB = "https://github.com/";
const TREE_LIMIT = 40;

export interface AddonGithub {
  repo: string;
  url: string;
  /** SPDX id, or null when GitHub has none ("NOASSERTION" counts as none). */
  license: string | null;
  archived: boolean;
  /** Open issues without pull requests, or null when the count could not be read. */
  openIssues: number | null;
  /** Newest release, or null when the repository has none. */
  release: { tag: string; name: string | null; date: string; url: string; notes: string | null } | null;
  lastCommit: string | null;
  /** Contributors counted up to GitHub's page of 100. */
  contributors: { count: number; capped: boolean } | null;
  tree: { name: string; kind: "dir" | "file" }[];
}

export type AddonGithubResult =
  | { status: "ok"; data: AddonGithub }
  | { status: "missing" }
  | { status: "unavailable"; rateLimited: boolean };

class GithubError extends Error {
  constructor(readonly code: number, readonly rateLimited = false) { super(`GitHub ${code}`); }
}

async function get(path: string): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "everloot.app", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: 3600 },
  } as RequestInit);
  if (!response.ok) {
    const limited = response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
    throw new GithubError(response.status, limited);
  }
  return response.json();
}

/** A part that can fail without spoiling the page: null means unknown. */
async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

const day = (iso: unknown) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
/** A GitHub link whole, or null: a URL is never cut, and one that leaves GitHub is not shown. */
const githubUrl = (value: unknown) => (typeof value === "string" && value.startsWith(GITHUB) ? value : null);

const failures = new Map<string, { until: number; result: AddonGithubResult }>();

export async function addonGithub(repo: string): Promise<AddonGithubResult> {
  if (!validRepo(repo)) return { status: "missing" };
  const remembered = failures.get(repo);
  if (remembered && remembered.until > Date.now()) return remembered.result;
  const result = await read(repo);
  if (result.status !== "ok") failures.set(repo, { until: Date.now() + FAILURE_MS, result });
  else failures.delete(repo);
  return result;
}

async function read(repo: string): Promise<AddonGithubResult> {
  let info: { html_url?: string; license?: { spdx_id?: string } | null; archived?: boolean };
  try {
    info = (await get(`/repos/${repo}`)) as typeof info;
  } catch (error) {
    if (error instanceof GithubError && (error.code === 404 || error.code === 410)) return { status: "missing" };
    return { status: "unavailable", rateLimited: error instanceof GithubError && error.rateLimited };
  }
  if (!info || !githubUrl(info.html_url)) return { status: "unavailable", rateLimited: false };

  const [release, commits, contributors, contents, issues] = await Promise.all([
    optional(async () => {
      try {
        return (await get(`/repos/${repo}/releases/latest`)) as Record<string, unknown>;
      } catch (error) {
        if (error instanceof GithubError && error.code === 404) return null; // no release yet
        throw error;
      }
    }),
    optional(() => get(`/repos/${repo}/commits?per_page=1`) as Promise<{ commit?: { committer?: { date?: string } } }[]>),
    optional(() => get(`/repos/${repo}/contributors?per_page=100`) as Promise<unknown[]>),
    optional(() => get(`/repos/${repo}/contents/`) as Promise<{ name?: string; type?: string }[]>),
    optional(() => get(`/search/issues?per_page=1&q=${encodeURIComponent(`repo:${repo} is:issue is:open`)}`) as Promise<{ total_count?: number }>),
  ]);

  const tag = text(release?.tag_name, 100);
  const published = day(release?.published_at);
  const spdx = info.license?.spdx_id;
  return {
    status: "ok",
    data: {
      repo,
      url: info.html_url as string,
      license: spdx && spdx !== "NOASSERTION" ? spdx : null,
      archived: info.archived === true,
      openIssues: typeof issues?.total_count === "number" ? issues.total_count : null,
      release: release && tag && published
        ? {
            tag,
            date: published,
            name: text(release.name, 120),
            url: githubUrl(release.html_url) ?? `${info.html_url}/releases`,
            notes: plainNotes(release.body),
          }
        : null,
      lastCommit: Array.isArray(commits) ? day(commits[0]?.commit?.committer?.date) : null,
      contributors: Array.isArray(contributors) ? { count: contributors.length, capped: contributors.length >= 100 } : null,
      tree: Array.isArray(contents)
        ? contents
            .filter((entry) => typeof entry?.name === "string")
            .map((entry) => ({ name: entry.name as string, kind: entry.type === "dir" ? ("dir" as const) : ("file" as const) }))
            .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1))
            .slice(0, TREE_LIMIT)
        : [],
    },
  };
}

/** What a leaderboard row needs: stars and the newest release, two requests instead of a profile's six. */
export interface AddonGithubSummary {
  repo: string;
  url: string;
  stars: number | null;
  release: { tag: string; date: string; url: string } | null;
}

export type AddonGithubSummaryResult =
  | { status: "ok"; data: AddonGithubSummary }
  /** The repository was read but its newest release could not be: `data.release` is null for that reason, not for none. */
  | { status: "partial"; data: AddonGithubSummary; rateLimited: boolean }
  | { status: "missing" }
  | { status: "unavailable"; rateLimited: boolean };

const summaryFailures = new Map<string, { until: number; result: AddonGithubSummaryResult }>();
/** Repositories GitHub said have no release, until when: the answer is kept as long as a cached request would be. */
const noRelease = new Map<string, number>();
const NO_RELEASE_MS = 3600_000;

/**
 * Stars and the newest release of one repository, under the same cache, timeout and failure memory as addonGithub.
 * A failed release read counts as a failure too: the partial answer is remembered, so the next views do not retry it.
 */
export async function addonGithubSummary(repo: string): Promise<AddonGithubSummaryResult> {
  if (!validRepo(repo)) return { status: "missing" };
  const remembered = summaryFailures.get(repo);
  if (remembered && remembered.until > Date.now()) return remembered.result;
  const result = await readSummary(repo);
  if (result.status !== "ok") summaryFailures.set(repo, { until: Date.now() + FAILURE_MS, result });
  else summaryFailures.delete(repo);
  return result;
}

async function readSummary(repo: string): Promise<AddonGithubSummaryResult> {
  let info: { html_url?: string; stargazers_count?: number };
  try {
    info = (await get(`/repos/${repo}`)) as typeof info;
  } catch (error) {
    if (error instanceof GithubError && (error.code === 404 || error.code === 410)) return { status: "missing" };
    return { status: "unavailable", rateLimited: error instanceof GithubError && error.rateLimited };
  }
  const url = info ? githubUrl(info.html_url) : null;
  if (!url) return { status: "unavailable", rateLimited: false };
  const data = { repo, url, stars: typeof info.stargazers_count === "number" ? info.stargazers_count : null, release: null };
  if ((noRelease.get(repo) ?? 0) > Date.now()) return { status: "ok", data };
  let release: Record<string, unknown>;
  try {
    release = (await get(`/repos/${repo}/releases/latest`)) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GithubError && error.code === 404) {
      noRelease.set(repo, Date.now() + NO_RELEASE_MS);
      return { status: "ok", data };
    }
    return { status: "partial", data, rateLimited: error instanceof GithubError && error.rateLimited };
  }
  noRelease.delete(repo);
  const tag = text(release?.tag_name, 100);
  const date = day(release?.published_at);
  return {
    status: "ok",
    data: { ...data, release: release && tag && date ? { tag, date, url: githubUrl(release.html_url) ?? `${url}/releases` } : null },
  };
}
