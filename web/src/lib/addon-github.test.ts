import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { addonGithub, addonGithubSummary } from "./addon-github";
import { plainNotes } from "./plain-notes";

// A new repo per test: failed answers are remembered for a few minutes by repo name.
let REPO = "someone/AwesomeAddon";
let counter = 0;
const info = { html_url: "", license: { spdx_id: "MIT" }, archived: false };
const release = { tag_name: "v1.2.0", name: "Spring update", published_at: "2026-10-14T16:50:15Z", html_url: "", body: "Fixed the tooltip." };

beforeEach(() => {
  REPO = `someone/AwesomeAddon${++counter}`;
  info.html_url = `https://github.com/${REPO}`;
  release.html_url = `${info.html_url}/releases/tag/v1.2.0`;
});

function answer(url: string): Response {
  const u = new URL(url);
  if (u.pathname === `/repos/${REPO}`) return Response.json(info);
  if (u.pathname.endsWith("/releases/latest")) return Response.json(release);
  if (u.pathname.endsWith("/commits")) return Response.json([{ commit: { committer: { date: "2026-10-16T08:00:00Z" } } }]);
  if (u.pathname.endsWith("/contributors")) return Response.json([{ login: "a" }, { login: "b" }]);
  if (u.pathname.endsWith("/contents/")) return Response.json([{ name: "README.md", type: "file" }, { name: "Libs", type: "dir" }, { name: "Awesome.toc", type: "file" }]);
  if (u.pathname === "/search/issues") return Response.json({ total_count: 7 });
  throw new Error(`unexpected ${url}`);
}

function stubFetch(respond: (url: string) => Response) {
  const fetch = vi.fn((url: string) => Promise.resolve(respond(url)));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("reads licence, release, last commit, contributors, open issues and the top-level files, folders first", async () => {
  const fetch = stubFetch(answer);
  const result = await addonGithub(REPO);
  expect(result).toEqual({
    status: "ok",
    data: {
      repo: REPO, url: info.html_url, license: "MIT", archived: false, openIssues: 7,
      release: { tag: "v1.2.0", name: "Spring update", date: "2026-10-14", url: release.html_url, notes: "Fixed the tooltip." },
      lastCommit: "2026-10-16",
      contributors: { count: 2, capped: false },
      tree: [{ name: "Libs", kind: "dir" }, { name: "Awesome.toc", kind: "file" }, { name: "README.md", kind: "file" }],
    },
  });
  for (const [url, init] of fetch.mock.calls as unknown as [string, RequestInit & { next?: { revalidate?: number } }][]) {
    expect(url).toMatch(/^https:\/\/api\.github\.com\//);
    expect(init.next?.revalidate).toBe(3600);
  }
});

test("sends the token only when one is set", async () => {
  const withoutToken = stubFetch(answer);
  await addonGithub(REPO);
  expect((withoutToken.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty("Authorization");
  vi.stubEnv("GITHUB_TOKEN", "read-only-token");
  const withToken = stubFetch(answer);
  await addonGithub(REPO);
  expect((withToken.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer read-only-token" });
});

test("a repository that is gone is reported as missing, not as an outage", async () => {
  stubFetch(() => new Response("{}", { status: 404 }));
  expect(await addonGithub(REPO)).toEqual({ status: "missing" });
});

test("a rate limit is reported as unavailable with the reason", async () => {
  stubFetch(() => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
  expect(await addonGithub(REPO)).toEqual({ status: "unavailable", rateLimited: true });
});

test("a server error or a timeout is unavailable, never thrown", async () => {
  stubFetch(() => new Response("{}", { status: 502 }));
  expect(await addonGithub(REPO)).toEqual({ status: "unavailable", rateLimited: false });
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new DOMException("timeout", "TimeoutError"))));
  expect(await addonGithub(REPO)).toEqual({ status: "unavailable", rateLimited: false });
});

test("a repository with no release still returns the rest; a failed part is left unknown", async () => {
  stubFetch((url) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith("/releases/latest")) return new Response("{}", { status: 404 });
    if (pathname === "/search/issues" || pathname.endsWith("/contributors")) return new Response("{}", { status: 500 });
    return answer(url);
  });
  const result = await addonGithub(REPO);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.data).toMatchObject({ release: null, openIssues: null, contributors: null, license: "MIT", lastCommit: "2026-10-16" });
});

test("no stated licence is null, and a name that is not owner/name never reaches GitHub", async () => {
  stubFetch((url) => (new URL(url).pathname === `/repos/${REPO}` ? Response.json({ ...info, license: { spdx_id: "NOASSERTION" } }) : answer(url)));
  const result = await addonGithub(REPO);
  expect(result.status === "ok" && result.data.license).toBeNull();
  const fetch = stubFetch(answer);
  expect(await addonGithub("../../orgs/x")).toEqual({ status: "missing" });
  expect(fetch).not.toHaveBeenCalled();
});

test("a dot-only segment is not a repository", async () => {
  const fetch = stubFetch(answer);
  for (const repo of ["../x", "./x", "x/..", "x/.", "a/b/c", "x"]) expect(await addonGithub(repo)).toEqual({ status: "missing" });
  expect(fetch).not.toHaveBeenCalled();
});

test("a failure is remembered for a few minutes, so an outage is one call per repo, not six per view", async () => {
  const fetch = stubFetch(() => new Response("{}", { status: 502 }));
  await addonGithub(REPO);
  await addonGithub(REPO);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.useFakeTimers();
  vi.advanceTimersByTime(6 * 60_000);
  await addonGithub(REPO);
  vi.useRealTimers();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("calls give up after a short timeout", async () => {
  const fetch = stubFetch(answer);
  await addonGithub(REPO);
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

test("a release link that leaves GitHub is replaced by the releases page, and links are never cut", async () => {
  const long = `${info.html_url}/releases/tag/${"v".repeat(500)}`;
  stubFetch((url) => (new URL(url).pathname.endsWith("/releases/latest") ? Response.json({ ...release, html_url: "https://evil.example/x" }) : answer(url)));
  const off = await addonGithub(REPO);
  expect(off.status === "ok" && off.data.release?.url).toBe(`${info.html_url}/releases`);
  REPO = `someone/AwesomeAddon${++counter}`;
  info.html_url = `https://github.com/${REPO}`;
  stubFetch((url) => (new URL(url).pathname.endsWith("/releases/latest") ? Response.json({ ...release, html_url: long }) : answer(url)));
  const kept = await addonGithub(REPO);
  expect(kept.status === "ok" && kept.data.release?.url).toBe(long);
});

const NL = String.fromCharCode(10);

test("release notes lose their markdown and get an ellipsis when cut", () => {
  const input = ["## Fixes", "- **Bold** and _soft_ and `code`", "* [link](https://x.example) ![img](https://y.example/a.png)", "<b>tag</b>"].join(NL);
  expect(plainNotes(input)).toBe(["Fixes", "- Bold and soft and code", "- link img", "tag"].join(NL));
  const cut = plainNotes("word ".repeat(400), 100)!;
  expect(cut.length).toBeLessThanOrEqual(100);
  expect(cut.endsWith("…")).toBe(true);
  expect(plainNotes("short")).toBe("short");
  expect(plainNotes("   ")).toBeNull();
});

test("the summary reads stars and the newest release in two requests", async () => {
  const fetch = stubFetch((url) => (new URL(url).pathname === `/repos/${REPO}` ? Response.json({ ...info, stargazers_count: 172 }) : answer(url)));
  expect(await addonGithubSummary(REPO)).toEqual({
    status: "ok",
    data: { repo: REPO, url: info.html_url, stars: 172, release: { tag: "v1.2.0", date: "2026-10-14", url: release.html_url } },
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("the summary says when the rate limit was the reason, and remembers the failure", async () => {
  const limited = stubFetch(() => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
  expect(await addonGithubSummary(REPO)).toEqual({ status: "unavailable", rateLimited: true });
  expect(await addonGithubSummary(REPO)).toEqual({ status: "unavailable", rateLimited: true });
  expect(limited).toHaveBeenCalledTimes(1);
  expect(await addonGithubSummary("not a repo")).toEqual({ status: "missing" });
});

const repoOnly = (url: string) => (new URL(url).pathname === `/repos/${REPO}` ? Response.json({ ...info, stargazers_count: 172 }) : null);

test("a rate-limited release read keeps the stars, says the limit was the reason, and is not retried for a while", async () => {
  const fetch = stubFetch((url) => repoOnly(url) ?? new Response("", { status: 429 }));
  const partial = { status: "partial", data: { repo: REPO, url: info.html_url, stars: 172, release: null }, rateLimited: true };
  expect(await addonGithubSummary(REPO)).toEqual(partial);
  expect(await addonGithubSummary(REPO)).toEqual(partial);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("a repository with no release is not asked again on the next view", async () => {
  const fetch = stubFetch((url) => repoOnly(url) ?? new Response("", { status: 404 }));
  const none = { status: "ok", data: { repo: REPO, url: info.html_url, stars: 172, release: null } };
  expect(await addonGithubSummary(REPO)).toEqual(none);
  expect(await addonGithubSummary(REPO)).toEqual(none);
  const releases = fetch.mock.calls.filter(([url]) => String(url).endsWith("/releases/latest"));
  expect(releases).toHaveLength(1);
});

test("a release read that times out is a partial answer, remembered like a failure", async () => {
  const fetch = stubFetch((url) => {
    const ok = repoOnly(url);
    if (ok) return ok;
    throw new DOMException("The operation timed out.", "TimeoutError");
  });
  const partial = { status: "partial", data: { repo: REPO, url: info.html_url, stars: 172, release: null }, rateLimited: false };
  expect(await addonGithubSummary(REPO)).toEqual(partial);
  expect(await addonGithubSummary(REPO)).toEqual(partial);
  expect(fetch).toHaveBeenCalledTimes(2);
});
