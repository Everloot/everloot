import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  BLUE_REGIONS, REGIONS, bluePostsOf, emptyOverrides, isBlueGroup, isCandidate, nextTracked, parseAbout, parseOverrides, parsePostChunk, parseTopicList,
  parseTopicView, staffIndex, type BlueOverrides, type ListedTopic, type StaffIndex, type StaffMember,
} from "./blue-forum.js";
import { sanitizePost } from "./changes.js";
import { clampExcerpt, clampText, isoTime, plainText } from "./text-safety.js";

export { clampExcerpt as excerptOf, plainText } from "./text-safety.js";
export { gameOf } from "./blue-forum.js";

/**
 * Official Blizzard posts about WoW: Forever (and Classic), for the "what changed" page.
 *
 * What it reads, and nothing else:
 *  - the Blizzard WoW forums' public Discourse JSON, US and EU English, after checking each host's robots.txt:
 *    the staff list (`about.json`, at most once a day), the Forever and Classic topic lists sorted by last
 *    activity, and only the topics among them that changed and carry a staff post (see blue-forum.ts);
 *  - the official World of Warcraft account's public Bluesky feed.
 * What it keeps per post: source, region, link, topic, title, author, role, times, category, game and an
 * excerpt of at most two sentences. Blizzard's post text is Blizzard's, so there is never a full copy here.
 * Players' posts are read with the topic but never kept. The research behind these choices is in the
 * Everloot wiki note 2026-10-18-blue-tracker-sources.
 *
 * Budget: a scheduled run makes at most `maxRequests` requests (default 40) in all, 1.5 s apart per host.
 */

export type BlueSource = "forum" | "bluesky";
export type BlueGame = "forever" | "classic";
export type BlueRegion = "us" | "eu";

export interface BluePost {
  /** Stable across runs: `forum:<post id>` (US), `forum:eu:<post id>` or `bluesky:<record key>`. */
  id: string;
  source: BlueSource;
  /** Which forum a forum post is on. Absent for Bluesky. */
  region?: BlueRegion;
  /** The original, which every page shows prominently. Null only if a stored link was not a web link. */
  url: string | null;
  /** Forum posts: the topic's title. */
  title: string;
  author: string;
  /** The author's published forum title, such as "Community Manager"; empty when unknown. */
  role: string;
  postedAt: string;
  /** Not every source says; null means unknown, not never. */
  editedAt: string | null;
  category: string;
  game: BlueGame;
  kind: "post" | "hotfix";
  /** At most two sentences of the original; see clampExcerpt. */
  excerpt: string;
  /** Forum posts: the topic, so every blue reply in one thread can be listed together. */
  topicId?: number;
  topicSlug?: string;
  /** 1 for the post that opened the topic. */
  postNumber?: number;
  /** True when this post opened the topic; false for a reply. */
  startedThread?: boolean;
  /** One line a maintainer may write by hand. Never filled automatically, never overwritten by a fetch. */
  summary?: string;
  firstSeen: string;
}

export interface Validators { etag?: string; lastModified?: string }

/** What the next run needs to stay polite. Kept in the Actions cache or on the maintainer's machine, not in git. */
export interface FetchState extends Validators {
  /** When this source was last read in full, ISO. */
  at: string;
  /** Do not ask again before this time (a Retry-After we were given), ISO. */
  notBefore?: string;
  /** Bluesky: newest post time seen. Topic lists: newest activity time fully handled. */
  newestSeen?: string;
  /** Roster sources: the forum's staff list as last read. */
  staff?: StaffMember[];
}

export interface BlueStore {
  posts: BluePost[];
  fetched: Record<string, FetchState>;
}

export const BLUESKY_ACTOR = "worldofwarcraft.blizzard.com";
export const BLUESKY_FEED = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${BLUESKY_ACTOR}&filter=posts_no_replies&limit=30`;
export const USER_AGENT = "Everloot/1.0 (+https://everloot.app; hello@everloot.app)";
export const MAX_PAGES = 3;
const PAGE_SIZE = 30;
/** Topics per list page; Discourse allows up to 100, which costs a third of the requests of the default 30. */
export const LIST_PAGE_SIZE = 100;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface PageInfo { count: number; oldest: string | null; newest: string | null; next: string | null }

/** A Forever-specific signal: the game's name, its beta, its hashtag, or a link to its pages. Bare "forever" is not one. */
const FOREVER_SIGNAL = /\b(?:wow|world of warcraft)\s*:?\s*forever\b|\bforever beta\b|#wowforever\b|worldofwarcraft\.blizzard\.com\/[a-z-]+\/forever|forums\.blizzard\.com\/[a-z]+\/wow\/c\/wow-forever/i;
const CLASSIC_SIGNAL = /\b(?:wow|world of warcraft)\s+classic\b|\b(?:burning crusade|mists of pandaria|wrath of the lich king|cataclysm) classic\b|\bclassic (?:era|anniversary)\b|\bseason of discovery\b/i;

/** Every link a Bluesky record carries: facets and an external-link embed. */
function recordLinks(record: Record<string, unknown>): string[] {
  const links: string[] = [];
  if (Array.isArray(record.facets)) {
    for (const facet of record.facets) {
      if (!isRecord(facet) || !Array.isArray(facet.features)) continue;
      for (const feature of facet.features) if (isRecord(feature) && typeof feature.uri === "string") links.push(feature.uri);
    }
  }
  const embed = record.embed;
  if (isRecord(embed) && isRecord(embed.external) && typeof embed.external.uri === "string") links.push(embed.external.uri);
  return links;
}

/** Newest and oldest time of a Bluesky page, ignoring a pinned post (it sits first whatever its age). */
export function blueskyPageInfo(json: unknown): PageInfo {
  if (!isRecord(json) || !Array.isArray(json.feed)) throw new Error("not a Bluesky author feed");
  const times = json.feed
    .filter((i) => isRecord(i) && !(isRecord(i.reason) && /reasonPin/.test(str(i.reason.$type))))
    .map((i) => (isRecord(i) && isRecord(i.post) && isRecord(i.post.record) ? isoTime(i.post.record.createdAt) : null))
    .filter((t): t is string => t !== null)
    .sort();
  return { count: json.feed.length, oldest: times[0] ?? null, newest: times.at(-1) ?? null, next: typeof json.cursor === "string" && json.cursor ? json.cursor : null };
}

/**
 * The official WoW account's own posts about Forever or Classic. Replies and reposts are skipped; a pinned
 * post is kept when it matches. The title is the first line and the excerpt is what follows it, never the same words twice.
 */
export function parseBlueskyFeed(json: unknown, now: Date): BluePost[] {
  if (!isRecord(json) || !Array.isArray(json.feed)) throw new Error("not a Bluesky author feed");
  const posts: BluePost[] = [];
  for (const item of json.feed) {
    if (!isRecord(item) || !isRecord(item.post)) continue;
    if (isRecord(item.reason) && /reasonRepost/.test(str(item.reason.$type))) continue;
    const post = item.post;
    const record = post.record;
    const author = post.author;
    if (!isRecord(record) || !isRecord(author) || str(author.handle) !== BLUESKY_ACTOR || isRecord(record.reply)) continue;
    const key = str(post.uri).split("/").pop() ?? "";
    const text = str(record.text).trim();
    const postedAt = isoTime(record.createdAt);
    if (!/^[a-z0-9]+$/i.test(key) || !text || !postedAt) continue;
    const haystack = `${text}\n${recordLinks(record).join("\n")}`;
    const game = FOREVER_SIGNAL.test(haystack) ? "forever" : CLASSIC_SIGNAL.test(haystack) ? "classic" : null;
    if (!game) continue;
    const firstLine = plainText(text.split(/\n/).find((l) => l.trim()) ?? text);
    const title = firstLine.length > 100 ? `${firstLine.slice(0, 99).replace(/\s+\S*$/, "")}…` : firstLine;
    const whole = plainText(text);
    const core = title.replace(/…$/, "");
    const rest = (whole.startsWith(core) ? whole.slice(core.length) : whole).replace(/^[\s.:;,\-–—]+/, "");
    posts.push({
      id: `bluesky:${key}`,
      source: "bluesky",
      url: `https://bsky.app/profile/${BLUESKY_ACTOR}/post/${key}`,
      title,
      author: clampText(author.displayName, 100) || "World of Warcraft",
      role: "Official account",
      postedAt,
      editedAt: null,
      category: "Bluesky",
      game,
      kind: /hotfix/i.test(text) ? "hotfix" : "post",
      excerpt: clampExcerpt(rest),
      firstSeen: now.toISOString(),
    });
  }
  return posts;
}

/** Add new posts, refresh the ones already known. A maintainer's summary and the first-seen time are kept. */
export function mergePosts(store: BlueStore, incoming: BluePost[]): { store: BlueStore; added: BluePost[] } {
  const byId = new Map(store.posts.map((p) => [p.id, p]));
  const added: BluePost[] = [];
  for (const post of incoming) {
    const known = byId.get(post.id);
    if (!known) {
      byId.set(post.id, post);
      added.push(post);
    } else {
      byId.set(post.id, { ...post, firstSeen: known.firstSeen, ...(known.summary ? { summary: known.summary } : {}) });
    }
  }
  const posts = [...byId.values()].sort((a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id));
  return { store: { ...store, posts }, added };
}

// ---- robots.txt ----

interface RobotsRule { allow: boolean; pattern: RegExp; length: number }

function ruleFor(path: string, allow: boolean): RobotsRule | null {
  if (path === "") return null; // an empty Disallow allows everything; an empty Allow changes nothing
  const body = path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return { allow, pattern: new RegExp(`^${body.endsWith("\\$") ? `${body.slice(0, -2)}$` : body}`), length: path.length };
}

/**
 * Whether robots.txt lets `agent` fetch `pathAndQuery`. The most specific group naming the agent wins,
 * otherwise `*`; within it the longest matching rule wins and Allow beats Disallow on a tie (RFC 9309).
 * An empty `User-agent:` names nobody.
 */
export function robotsAllows(robotsText: string, pathAndQuery: string, agent = "everloot"): boolean {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const line of robotsText.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    const colon = clean.indexOf(":");
    if (colon < 0) continue;
    const field = clean.slice(0, colon).trim().toLowerCase();
    const value = clean.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      if (value) current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      const rule = ruleFor(value, field === "allow");
      if (rule) current.rules.push(rule);
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: RobotsRule | null = null;
  for (const rule of chosen.flatMap((g) => g.rules)) {
    if (!rule.pattern.test(pathAndQuery)) continue;
    if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

// ---- storage ----

export const emptyStore = (): BlueStore => ({ posts: [], fetched: {} });

/** The committed posts file. Every post is re-clamped on the way in, so a hand-edited file cannot widen a limit. */
export function loadStore(path: string): BlueStore {
  if (!existsSync(path)) return emptyStore();
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.posts)) throw new Error(`${path} is not a blue post store`);
  const posts = (parsed.posts as unknown[]).map(sanitizePost).filter((p): p is BluePost => p !== null).map(withThread);
  return { posts, fetched: {} };
}

/**
 * Posts stored before the forum reader kept the topic carry it only in their link. Fill region, topic and
 * post number from it, so every stored forum post can be grouped by thread.
 */
export function withThread(post: BluePost): BluePost {
  if (post.source !== "forum" || post.topicId !== undefined || !post.url) return post;
  const m = /^https:\/\/(us|eu)\.forums\.blizzard\.com\/en\/wow\/t\/((?:[a-z0-9-]|%[0-9a-f]{2})+)\/(\d+)(?:\/(\d+))?$/i.exec(post.url);
  if (!m) return post;
  const postNumber = m[4] ? Number(m[4]) : 1;
  return { ...post, region: m[1].toLowerCase() as BlueRegion, topicId: Number(m[3]), topicSlug: m[2], postNumber, startedThread: postNumber === 1 };
}

/** Written beside the target and renamed into place, so a crash never leaves half a store. Posts only: fetch state stays out of git. */
export function saveStore(path: string, store: BlueStore): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify({ posts: store.posts }, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

/** The politeness state (last asked, validators, Retry-After, staff list) of the previous run; empty if there was none. */
export function loadFetchState(path: string): Record<string, FetchState> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) && isRecord(parsed.fetched) ? (parsed.fetched as Record<string, FetchState>) : {};
  } catch {
    return {};
  }
}

export function saveFetchState(path: string, fetched: Record<string, FetchState>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify({ fetched }, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

/** kb/curated/blue-accounts.json: hand corrections on top of the forum's own staff list. */
export function loadOverrides(path: string): BlueOverrides {
  return parseOverrides(JSON.parse(readFileSync(path, "utf8")));
}

// ---- polite fetching ----

export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

export interface IngestOptions {
  store: BlueStore;
  overrides?: BlueOverrides;
  fetcher: Fetcher;
  now: Date;
  /** Forums to read. Default both. */
  regions?: BlueRegion[];
  /** A source asked less than this long ago is skipped. Default 25 minutes. */
  minIntervalMs?: number;
  /** Pause between two requests to the same host. Default 1.5 s. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Requests a run may make in all, robots.txt included. Default 40. */
  maxRequests?: number;
  /**
   * Milliseconds a run may spend before it starts no new request, as `maxRequests` does: it ends like a spent request
   * budget and the next run continues from the saved place. Unset means no limit (the one-off backfill). A scheduled
   * run that outlasts the platform's wall limit is cut off before its results are saved, and loses all its progress.
   */
  deadlineMs?: number;
  /** The clock `deadlineMs` reads; tests drive it. Default Date.now. */
  clock?: () => number;
  /** List pages per topic list and run. Default 4 (400 topics). */
  maxListPages?: number;
  /** The staff list is read again once it is older than this. Default 24 hours. */
  rosterMaxAgeMs?: number;
  /** Skip Bluesky (the backfill reads the forums only). */
  forumOnly?: boolean;
}

export interface IngestResult {
  store: BlueStore;
  added: BluePost[];
  skipped: string[];
  errors: { source: string; error: string }[];
  /** Requests made, by kind. */
  requests: Record<string, number>;
}

/** A server that says "slow down" or fails ends the forum pass; the next scheduled run tries again. */
class Backoff extends Error {
  constructor(message: string, readonly notBefore?: string) { super(message); }
}
/** The run's request budget is spent. */
class BudgetSpent extends Error {}

function retryAfter(res: Response, now: Date): string | undefined {
  const value = res.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  const at = Number.isFinite(seconds) ? now.getTime() + seconds * 1000 : Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const HOUR = 3_600_000;

/** The topic list path for one page. */
export const listPath = (path: string, page: number) => `/en/wow/${path}/l/latest.json?per_page=${LIST_PAGE_SIZE}${page ? `&page=${page}` : ""}`;

/**
 * Everything a forum pass needs: the polite GET, the robots check, the staff list and opening one topic.
 * Shared by the scheduled run and the one-off backfill.
 */
function session(opts: IngestOptions) {
  const delay = opts.delayMs ?? 1500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budget = opts.maxRequests ?? 40;
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const overrides = opts.overrides ?? emptyOverrides();
  const s = {
    store: opts.store,
    added: [] as BluePost[],
    skipped: [] as string[],
    errors: [] as { source: string; error: string }[],
    requests: {} as Record<string, number>,
    backedOff: false,
  };
  const lastRequest = new Set<string>();
  const robots = new Map<BlueRegion, string>();
  const staff = new Map<BlueRegion, StaffIndex>();

  const setState = (key: string, state: FetchState) => { s.store = { ...s.store, fetched: { ...s.store.fetched, [key]: state } }; };
  const spent = () => Object.values(s.requests).reduce((a, b) => a + b, 0);
  const merge = (posts: BluePost[]) => {
    const merged = mergePosts(s.store, posts);
    s.store = merged.store;
    s.added.push(...merged.added);
  };

  /** One GET with the rules every request follows. `stateKey` receives a Retry-After. */
  const get = async (kind: string, host: string, url: string, headers: Record<string, string>, stateKey: string): Promise<Response> => {
    if (spent() >= budget) throw new BudgetSpent(`request budget of ${budget} spent`);
    const outOfTime = () => opts.deadlineMs !== undefined && clock() - started >= opts.deadlineMs;
    if (outOfTime()) throw new BudgetSpent(`time budget of ${Math.round(opts.deadlineMs! / 1000)} s spent`);
    if (lastRequest.has(host)) {
      await sleep(delay);
      if (outOfTime()) throw new BudgetSpent(`time budget of ${Math.round(opts.deadlineMs! / 1000)} s spent`);
    }
    lastRequest.add(host);
    s.requests[kind] = (s.requests[kind] ?? 0) + 1;
    const res = await opts.fetcher(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
    if (res.status === 429 || res.status >= 500) {
      const notBefore = retryAfter(res, opts.now);
      const previous = s.store.fetched[stateKey];
      setState(stateKey, { ...(previous ?? { at: opts.now.toISOString() }), ...(notBefore ? { notBefore } : {}) });
      throw new Backoff(`HTTP ${res.status}`, notBefore);
    }
    // A redirect could lead somewhere robots.txt was never read for, so it is reported, not followed.
    if (res.status >= 300 && res.status < 400 && res.status !== 304) throw new Error(`HTTP ${res.status} redirect not followed`);
    return res;
  };

  const hostKey = (region: BlueRegion) => `host:${region}`;

  /** GET JSON from a forum, after robots.txt. A 404 or 403 is null (a topic deleted or made private since it was listed). */
  const forumJson = async (kind: string, region: BlueRegion, path: string): Promise<unknown | null> => {
    const rules = robots.get(region);
    if (rules === undefined) throw new Error("robots.txt not read");
    if (!robotsAllows(rules, path)) throw new Error(`robots.txt disallows ${path}`);
    const res = await get(kind, region, `${REGIONS[region].host}${path}`, { Accept: "application/json" }, hostKey(region));
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res.json();
  };

  /** robots.txt for a forum host, read once per run before anything else on that host. False when it could not be read. */
  const readRobots = async (region: BlueRegion): Promise<boolean> => {
    const state = s.store.fetched[hostKey(region)];
    if (state?.notBefore && Date.parse(state.notBefore) > opts.now.getTime()) {
      s.skipped.push(`forum ${region}: asked to wait until ${state.notBefore}`);
      return false;
    }
    try {
      const res = await get("robots", region, `${REGIONS[region].host}/robots.txt`, {}, hostKey(region));
      if (res.status === 404) robots.set(region, "");
      else if (res.ok) robots.set(region, await res.text());
      else throw new Error(`robots.txt: HTTP ${res.status}`);
      return true;
    } catch (err) {
      if (err instanceof Backoff) s.backedOff = true;
      if (err instanceof BudgetSpent) throw err;
      s.errors.push({ source: `forum ${region}`, error: message(err).startsWith("robots.txt") ? message(err) : `robots.txt: ${message(err)}` });
      return false;
    }
  };

  /** The staff list, from the state when it is fresh enough, else from about.json. A failed read keeps the old list. */
  const loadStaff = async (region: BlueRegion): Promise<StaffIndex> => {
    const key = `roster:${region}`;
    const state = s.store.fetched[key];
    let roster = state?.staff ?? [];
    const maxAge = opts.rosterMaxAgeMs ?? 24 * HOUR;
    if (!state || opts.now.getTime() - Date.parse(state.at) >= maxAge) {
      try {
        const json = await forumJson("roster", region, "/en/wow/about.json");
        if (json === null) throw new Error("about.json: not found");
        roster = parseAbout(json);
        setState(key, { at: opts.now.toISOString(), staff: roster });
      } catch (err) {
        if (err instanceof Backoff || err instanceof BudgetSpent) throw err;
        s.errors.push({ source: key, error: message(err) });
      }
    }
    const index = staffIndex(region, roster, overrides);
    staff.set(region, index);
    return index;
  };

  /** Stored post numbers per topic, so a topic opened again only fetches the staff posts not yet kept. */
  const knownNumbers = (region: BlueRegion, topicId: number) =>
    new Set(s.store.posts.filter((p) => p.source === "forum" && (p.region ?? "us") === region && p.topicId === topicId).map((p) => p.postNumber));

  /**
   * Open one topic and keep its staff posts. The forum chains its staff posts (each post names the next
   * one), so this reads the topic from the last staff post already kept (or from the start: a new topic,
   * or `fromStart` for the backfill), then follows the chain 20 posts at a time to the end. A re-opened
   * topic usually costs one request. Null when the topic is gone.
   */
  const openTopic = async (region: BlueRegion, topicId: number, fromStart = false): Promise<BluePost[] | null> => {
    const known = knownNumbers(region, topicId);
    const last = fromStart ? 0 : Math.max(0, ...[...known].filter((n): n is number => typeof n === "number"));
    const json = await forumJson("topic", region, last > 1 ? `/en/wow/t/${topicId}/${last}.json` : `/en/wow/t/${topicId}.json`);
    if (json === null) return null;
    const view = parseTopicView(json);
    if (view.topic.id !== topicId) throw new Error(`topic ${topicId}: answer is for topic ${view.topic.id}`);
    const posts = [...view.posts];
    const loaded = new Set(posts.map((p) => p.post_number));
    const tracked = new Set(view.tracked);
    const chain = new Set(view.chain);
    const asked = new Set<number>();
    for (;;) {
      // Re-reading from the last kept post, only the chain after it matters.
      const n = [...chain].filter((m) => !loaded.has(m) && !asked.has(m) && (fromStart || (m > last && !known.has(m)))).sort((a, b) => a - b)[0];
      if (n === undefined) break;
      // A number a chunk does not bring back (deleted since) is not asked for twice.
      asked.add(n);
      const chunk = await forumJson("posts", region, `/en/wow/t/${topicId}/posts.json?post_number=${n - 1}&asc=true`);
      const more = chunk === null ? [] : parsePostChunk(chunk);
      posts.push(...more);
      for (const p of more) loaded.add(p.post_number);
      for (const m of nextTracked(more)) {
        chain.add(m.n);
        if (isBlueGroup(m.group)) tracked.add(m.n);
      }
    }
    return bluePostsOf(region, { ...view, tracked: [...tracked] }, posts, staff.get(region)!, opts.now);
  };
  return { s, get, setState, merge, forumJson, readRobots, loadStaff, openTopic, budget };
}

/**
 * One scheduled pass, within `maxRequests` requests:
 *  1. the official Bluesky feed (one request, as before);
 *  2. per forum region: robots.txt, the staff list when it is a day old, then each Forever and Classic topic
 *     list by last activity, page by page (100 topics a page) until it reaches the activity time the last
 *     run handled, at most `maxListPages` pages; then each listed topic that changed since and carries a
 *     staff post is opened, oldest change first, and its staff posts are kept.
 * A list's handled time only moves past a topic once that topic was read, so a run cut short by the budget,
 * an error or a 429 picks up where it stopped. A list that needed more than `maxListPages` pages leaves a gap,
 * reported in `skipped`; `blue-backfill` fills it. Any 429 or server error ends the forum pass and records
 * Retry-After; redirects are never followed.
 */
export async function ingestBluePosts(opts: IngestOptions): Promise<IngestResult> {
  const minInterval = opts.minIntervalMs ?? 25 * 60_000;
  const maxPages = opts.maxListPages ?? 4;
  const x = session(opts);
  const { s } = x;

  if (!opts.forumOnly) {
    try {
      await readBluesky(x, opts, minInterval);
    } catch (err) {
      // A spent budget is a normal stop, not a source failure: the forum pass below ends at once too.
      if (err instanceof BudgetSpent) s.skipped.push(`bluesky: ${message(err)}`);
      else s.errors.push({ source: "bluesky", error: message(err) });
    }
  }

  try {
    for (const region of opts.regions ?? BLUE_REGIONS) {
      if (s.backedOff) { s.skipped.push(`forum ${region}: stopped after an earlier slow-down`); continue; }
      if (!(await x.readRobots(region))) continue;
      try {
        const staff = await x.loadStaff(region);
        for (const list of REGIONS[region].lists) {
          const key = `list:${region}:${list.key}`;
          const state = s.store.fetched[key];
          if (state && opts.now.getTime() - Date.parse(state.at) < minInterval) { s.skipped.push(`${key}: asked less than ${Math.round(minInterval / 60000)} minutes ago`); continue; }
          try {
            await readList(x, opts.now, region, key, list.path, state, staff, maxPages);
          } catch (err) {
            if (err instanceof Backoff || err instanceof BudgetSpent) throw err;
            s.errors.push({ source: key, error: message(err) });
          }
        }
      } catch (err) {
        if (err instanceof BudgetSpent) throw err;
        if (err instanceof Backoff) s.backedOff = true;
        s.errors.push({ source: `forum ${region}`, error: message(err) });
      }
    }
  } catch (err) {
    if (!(err instanceof BudgetSpent)) throw err;
    s.skipped.push(`stopped: ${message(err)}; the next run continues from here`);
  }
  // Fetch state from the per-account reader this replaced.
  const fetched = Object.fromEntries(Object.entries(s.store.fetched).filter(([k]) => !k.startsWith("forum:")));
  return { store: { ...s.store, fetched }, added: s.added, skipped: s.skipped, errors: s.errors, requests: s.requests };
}

type Session = ReturnType<typeof session>;

/** One topic list: pages back to the last handled activity time, then the changed topics with a staff post. */
async function readList(x: Session, now: Date, region: BlueRegion, key: string, path: string, state: FetchState | undefined, staff: StaffIndex, maxPages: number) {
  const { s } = x;
  const since = state?.newestSeen ?? null;
  const listed: ListedTopic[] = [];
  let reached = since === null;
  let pages = 0;
  for (let page = 0; page < maxPages; page++) {
    const json = await x.forumJson("list", region, listPath(path, page));
    if (json === null) throw new Error(`topic list ${path}: not found`);
    const { topics, full } = parseTopicList(json);
    listed.push(...topics);
    pages++;
    // Pinned topics sit on top whatever their age, so only the others say how far back a page reaches.
    const oldest = topics.filter((t) => !t.pinned).map((t) => t.bumpedAt).sort()[0];
    // A first run reads one page and starts from there; history is the backfill's job.
    if (since === null || !full || (oldest !== undefined && oldest <= since)) { reached = true; break; }
  }
  const newest = listed.map((t) => t.bumpedAt).sort().at(-1) ?? since;
  if (!reached) s.skipped.push(`${key}: more than ${pages} pages changed since ${since}; older changes were not listed (run blue-backfill to fill the gap)`);
  const todo = listed
    .filter((t) => (since === null || t.bumpedAt > since) && isCandidate(t, staff))
    .sort((a, b) => a.bumpedAt.localeCompare(b.bumpedAt) || a.id - b.id);
  const seen = new Set<number>();
  let handled = since;
  for (const topic of todo) {
    if (seen.has(topic.id)) continue;
    seen.add(topic.id);
    try {
      const posts = await x.openTopic(region, topic.id);
      if (posts === null) s.skipped.push(`${key}: topic ${topic.id} is gone`);
      else x.merge(posts);
    } catch (err) {
      // Stop here: the handled time stays before this topic, so the next run opens it again.
      x.setState(key, { at: now.toISOString(), ...(handled ? { newestSeen: handled } : {}) });
      if (err instanceof Backoff || err instanceof BudgetSpent) throw err;
      s.errors.push({ source: `${key}: topic ${topic.id}`, error: message(err) });
      return;
    }
    handled = topic.bumpedAt;
  }
  x.setState(key, { at: now.toISOString(), ...(newest ? { newestSeen: newest } : {}) });
}

/** The Bluesky feed, page by page up to MAX_PAGES, stopping at what the last read already showed. */
async function readBluesky(x: Session, opts: IngestOptions, minInterval: number) {
  const { s } = x;
  const key = "bluesky";
  const state = s.store.fetched[key];
  if (state?.notBefore && Date.parse(state.notBefore) > opts.now.getTime()) { s.skipped.push(`${key}: asked to wait until ${state.notBefore}`); return; }
  if (state && opts.now.getTime() - Date.parse(state.at) < minInterval) { s.skipped.push(`${key}: asked less than ${Math.round(minInterval / 60000)} minutes ago`); return; }
  const found: BluePost[] = [];
  let validators: Validators = {};
  let newest: string | null = null;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (page === 0 && state?.etag) headers["If-None-Match"] = state.etag;
    if (page === 0 && state?.lastModified) headers["If-Modified-Since"] = state.lastModified;
    const res = await x.get("bluesky", "bluesky", cursor ? `${BLUESKY_FEED}&cursor=${encodeURIComponent(cursor)}` : BLUESKY_FEED, headers, key);
    if (res.status === 304) {
      // Nothing new. A 304 that omits a validator does not erase the one we hold.
      const next: FetchState = { ...state, at: opts.now.toISOString() };
      const etag = res.headers.get("etag");
      const lastModified = res.headers.get("last-modified");
      if (etag) next.etag = etag;
      if (lastModified) next.lastModified = lastModified;
      delete next.notBefore;
      x.setState(key, next);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const measured = blueskyPageInfo(json);
    found.push(...parseBlueskyFeed(json, opts.now));
    if (page === 0) {
      validators = { ...(res.headers.get("etag") ? { etag: res.headers.get("etag")! } : {}), ...(res.headers.get("last-modified") ? { lastModified: res.headers.get("last-modified")! } : {}) };
      newest = measured.newest;
    }
    cursor = measured.next;
    const reachedKnown = state?.newestSeen !== undefined && measured.oldest !== null && measured.oldest <= state.newestSeen;
    if (reachedKnown || measured.count < PAGE_SIZE || !cursor) break;
  }
  x.merge(found);
  const newestSeen = [newest, state?.newestSeen].filter((t): t is string => !!t).sort().at(-1);
  x.setState(key, { at: opts.now.toISOString(), ...validators, ...(newestSeen ? { newestSeen } : {}) });
}

export interface BackfillOptions extends Omit<IngestOptions, "minIntervalMs" | "maxListPages" | "forumOnly"> {
  /** Games to walk. */
  games: BlueGame[];
  /** Stop listing a topic list at topics whose last activity is older than this (ISO); the whole list when absent. */
  since?: string;
  /** Pages per topic list at most. Default: no cap besides the request budget. */
  maxListPages?: number;
}

/**
 * The one-off history: walk every page of each Forever (and, if asked, Classic) topic list, back to `since`
 * or the first topic, and open every topic that carries a staff post. Same rules and pace as the scheduled
 * run; only the request budget is larger. Not for the cron. Lists are walked one after the other, Forever first.
 */
export async function backfillBluePosts(opts: BackfillOptions): Promise<IngestResult & { topics: number; pages: number }> {
  const x = session({ ...opts, forumOnly: true });
  const { s } = x;
  let topicsOpened = 0;
  let pagesRead = 0;
  const wanted = new Set(opts.games);
  try {
    for (const region of opts.regions ?? BLUE_REGIONS) {
      if (s.backedOff || !(await x.readRobots(region))) continue;
      const staff = await x.loadStaff(region);
      const ordered = [...REGIONS[region].lists].sort((a, b) => Number(b.key !== "classic") - Number(a.key !== "classic"));
      for (const list of ordered) {
        const game: BlueGame = list.key === "classic" ? "classic" : "forever";
        // "In Development" also holds the Classic PTR; it is walked with Forever.
        if (!wanted.has(game)) continue;
        const done = new Set<number>();
        for (let page = 0; opts.maxListPages === undefined || page < opts.maxListPages; page++) {
          const json = await x.forumJson("list", region, listPath(list.path, page));
          if (json === null) break;
          pagesRead++;
          const { topics, full } = parseTopicList(json);
          for (const t of topics) {
            if (done.has(t.id) || !isCandidate(t, staff)) continue;
            done.add(t.id);
            try {
              const posts = await x.openTopic(region, t.id, true);
              topicsOpened++;
              if (posts) x.merge(posts);
            } catch (err) {
              if (err instanceof Backoff || err instanceof BudgetSpent) throw err;
              s.errors.push({ source: `list:${region}:${list.key}: topic ${t.id}`, error: message(err) });
            }
          }
          const oldest = topics.filter((t) => !t.pinned).map((t) => t.bumpedAt).sort()[0];
          if (!full || (opts.since && oldest !== undefined && oldest < opts.since)) break;
        }
      }
    }
  } catch (err) {
    if (err instanceof Backoff) s.errors.push({ source: "forum", error: `stopped: ${message(err)}` });
    else if (err instanceof BudgetSpent) s.skipped.push(`stopped: ${message(err)}`);
    else throw err;
  }
  return { store: s.store, added: s.added, skipped: s.skipped, errors: s.errors, requests: s.requests, topics: topicsOpened, pages: pagesRead };
}
