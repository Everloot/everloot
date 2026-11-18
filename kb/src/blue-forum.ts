import { clampExcerpt, clampText, isoTime } from "./text-safety.js";
import type { BlueGame, BluePost, BlueRegion } from "./blue-posts.js";

/**
 * The Blizzard WoW forums (Discourse) as a blue-post source: regions, categories, the staff roster and
 * the parsers for the three JSON answers the tracker reads. Pure functions only; the fetching is in
 * blue-posts.ts.
 *
 * How a blue post is found. Blizzard's forums run Discourse's group tracker: every topic in a list
 * carries `first_tracked_post` when someone in a tracked group posted in it, and the topic itself lists
 * every tracked post number (`tracked_posts`). That is the forum's own blue marker, so a run lists the
 * Forever and Classic categories by last activity, opens only the topics that changed and carry a staff
 * post (or a poster on the staff roster), and keeps the staff posts in them. Tracked groups whose name
 * contains "mvp" (cs-mvp, wow-mvp) are players with a green name, not Blizzard, and are ignored.
 */

export interface RegionConfig {
  host: string;
  /** Category id -> game and name. Ids differ between regions (EU 348 is Burning Crusade Classic). */
  categories: Map<number, { game: BlueGame; name: string }>;
  /** Topic lists read per run, newest activity first. A parent category's list includes its sub-categories. */
  lists: { key: string; path: string }[];
}

const cats = (game: BlueGame, rows: [number, string][]) => rows.map(([id, name]) => [id, { game, name }] as const);

/** Category ids and slugs from each forum's /en/wow/site.json, read 2026-10-19; US bug-report category 352 rechecked 2026-11-17 (parent 346). */
export const REGIONS: Record<BlueRegion, RegionConfig> = {
  us: {
    host: "https://us.forums.blizzard.com",
    categories: new Map([
      ...cats("forever", [[346, "WoW: Forever"], [347, "WoW: Forever General Discussion"], [348, "WoW: Forever Community Connections"], [349, "WoW: Forever Beta Discussion"], [352, "WoW Forever Bug Report"]]),
      ...cats("classic", [
        [197, "WoW Classic"], [172, "WoW Classic General Discussion"], [335, "The Burning Crusade Classic"],
        [254, "Mists of Pandaria Classic Discussion"], [199, "WoW Classic Bug Report"], [201, "WoW Classic New Guild Listings"],
        [200, "Classic Connections"], [302, "Season of Discovery"], [296, "WoW Classic Hardcore"], [350, "Burning Crusade Classic Zul'Aman PTR"],
      ]),
    ]),
    lists: [
      { key: "forever", path: "c/wow-forever/346" },
      // "In Development" holds the Forever beta forum (349), the Classic PTR (350) and retail PTRs, which are dropped by category.
      { key: "in-development", path: "c/in-development/23" },
      { key: "classic", path: "c/wow-classic/197" },
    ],
  },
  eu: {
    host: "https://eu.forums.blizzard.com",
    categories: new Map([
      ...cats("forever", [[359, "WoW: Forever"], [360, "WoW: Forever General Discussion"], [361, "WoW: Forever Community Connections"], [362, "WoW: Forever Beta Discussion"]]),
      ...cats("classic", [
        [249, "WoW Classic"], [265, "WoW Classic General Discussion"], [348, "The Burning Crusade Classic"],
        [288, "Mists of Pandaria Classic Discussion"], [317, "Season of Discovery"], [311, "WoW Classic Hardcore"],
        [250, "WoW Classic Guild Recruitment"], [251, "Classic Connections"], [363, "Burning Crusade Classic Zul'Aman PTR"],
      ]),
    ]),
    lists: [
      { key: "forever", path: "c/wow-forever/359" },
      { key: "in-development", path: "c/in-development/21" },
      { key: "classic", path: "c/wow-classic/249" },
    ],
  },
};

export const BLUE_REGIONS = Object.keys(REGIONS) as BlueRegion[];

/** The game a forum post is about, by its region's category alone, or null (retail and anything else is dropped). */
export function gameOf(categoryId: number | undefined, region: BlueRegion = "us"): { game: BlueGame; category: string } | null {
  if (categoryId === undefined) return null;
  const hit = REGIONS[region].categories.get(categoryId);
  return hit ? { game: hit.game, category: hit.name } : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const int = (v: unknown): number | null => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

/** Tracked groups that are players (MVPs, green names) rather than Blizzard staff. */
export const isBlueGroup = (group: string) => group !== "" && !/mvp/i.test(group);

// ---- roster and overrides ----

export interface StaffMember { id: number; username: string; title: string }

/** The forum's published staff list (`/en/wow/about.json`): every moderator and admin with their forum title. */
export function parseAbout(json: unknown): StaffMember[] {
  if (!isRecord(json) || !Array.isArray(json.users)) throw new Error("not a Discourse about.json answer");
  const out: StaffMember[] = [];
  for (const u of json.users) {
    if (!isRecord(u)) continue;
    const id = int(u.id);
    const username = str(u.username);
    if (id && username) out.push({ id, username, title: clampText(u.title, 100) });
  }
  return out;
}

/** Hand corrections on top of the automatic roster, from kb/curated/blue-accounts.json. Usernames match case-insensitively. */
export interface BlueOverrides {
  /** Always kept, even when the forum's lists do not name them as staff. */
  include: { region: BlueRegion; username: string; title: string }[];
  /** Never kept. */
  exclude: { region: BlueRegion; username: string }[];
  /** Posts whose role is one of these titles are not kept (unless the author is in `include`). */
  excludeTitles: string[];
  /** The role to show for an author whose forum title is missing or wrong. */
  titles: { region: BlueRegion; username: string; title: string }[];
}

export const emptyOverrides = (): BlueOverrides => ({ include: [], exclude: [], excludeTitles: [], titles: [] });

export function parseOverrides(json: unknown): BlueOverrides {
  if (!isRecord(json)) throw new Error("blue overrides: not an object");
  const region = (v: unknown, where: string): BlueRegion => {
    if (v === "us" || v === "eu") return v;
    throw new Error(`blue overrides: ${where} needs a region of "us" or "eu"`);
  };
  const list = (key: string) => {
    const v = json[key] ?? [];
    if (!Array.isArray(v)) throw new Error(`blue overrides: ${key} must be a list`);
    return v.map((row: unknown) => {
      if (!isRecord(row) || !str(row.username)) throw new Error(`blue overrides: every ${key} entry needs a username`);
      return { region: region(row.region, key), username: str(row.username), title: str(row.title) };
    });
  };
  const include = list("include");
  const titles = list("titles");
  for (const row of [...include, ...titles]) if (!row.title) throw new Error(`blue overrides: ${row.username} needs a title`);
  const excludeTitles = json.excludeTitles ?? [];
  if (!Array.isArray(excludeTitles) || excludeTitles.some((t) => typeof t !== "string")) throw new Error("blue overrides: excludeTitles must be a list of titles");
  return { include, exclude: list("exclude").map(({ region: r, username }) => ({ region: r, username })), excludeTitles, titles };
}

/** Who counts as Blizzard staff in one region, and with which title. */
export interface StaffIndex {
  ids: Set<number>;
  titleById: Map<number, string>;
  include: Map<string, string>;
  exclude: Set<string>;
  excludeTitles: Set<string>;
  titles: Map<string, string>;
}

export function staffIndex(region: BlueRegion, roster: StaffMember[], overrides: BlueOverrides): StaffIndex {
  const mine = <T extends { region: BlueRegion; username: string }>(rows: T[]) => rows.filter((r) => r.region === region);
  return {
    ids: new Set(roster.map((s) => s.id)),
    titleById: new Map(roster.filter((s) => s.title).map((s) => [s.id, s.title])),
    include: new Map(mine(overrides.include).map((r) => [r.username.toLowerCase(), r.title])),
    exclude: new Set(mine(overrides.exclude).map((r) => r.username.toLowerCase())),
    excludeTitles: new Set(overrides.excludeTitles.map((t) => t.toLowerCase())),
    titles: new Map(mine(overrides.titles).map((r) => [r.username.toLowerCase(), r.title])),
  };
}

// ---- topic lists ----

export interface ListedTopic {
  id: number;
  bumpedAt: string;
  pinned: boolean;
  /** The group of the topic's first tracked post, or null when nobody tracked posted in it. */
  trackedGroup: string | null;
  posterIds: number[];
}

/** One page of `/c/<path>/l/latest.json`. `full` says whether another page may follow. */
export function parseTopicList(json: unknown): { topics: ListedTopic[]; full: boolean } {
  if (!isRecord(json) || !isRecord(json.topic_list) || !Array.isArray(json.topic_list.topics)) throw new Error("not a Discourse topic list");
  const topics: ListedTopic[] = [];
  for (const t of json.topic_list.topics) {
    if (!isRecord(t)) continue;
    const id = int(t.id);
    const bumpedAt = isoTime(t.bumped_at) ?? isoTime(t.last_posted_at);
    if (!id || !bumpedAt) continue;
    const first = isRecord(t.first_tracked_post) ? str(t.first_tracked_post.group) : "";
    const posterIds = Array.isArray(t.posters) ? t.posters.map((p) => (isRecord(p) ? int(p.user_id) : null)).filter((n): n is number => n !== null) : [];
    topics.push({ id, bumpedAt, pinned: t.pinned === true || t.pinned_globally === true, trackedGroup: first || null, posterIds });
  }
  const perPage = int(json.topic_list.per_page) ?? 30;
  return { topics, full: json.topic_list.topics.length >= perPage && typeof json.topic_list.more_topics_url === "string" };
}

/** Worth opening: a blue tracked post, or a poster on the staff roster or the include list. */
export function isCandidate(topic: ListedTopic, staff: StaffIndex): boolean {
  if (topic.trackedGroup && isBlueGroup(topic.trackedGroup)) return true;
  return topic.posterIds.some((id) => staff.ids.has(id));
}

// ---- topics and posts ----

export interface TopicInfo { id: number; slug: string; title: string; categoryId: number | null }

export interface TopicView {
  topic: TopicInfo;
  /** Post numbers the forum marks as posted by a tracked Blizzard group. */
  tracked: number[];
  /** Every tracked post number seen, MVPs included: the chain to follow. */
  chain: number[];
  posts: Record<string, unknown>[];
}

const postsOf = (json: Record<string, unknown>): Record<string, unknown>[] =>
  isRecord(json.post_stream) && Array.isArray(json.post_stream.posts) ? json.post_stream.posts.filter(isRecord) : [];

/** `/t/<id>.json`: the topic, its tracked post numbers and the first posts. */
export function parseTopicView(json: unknown): TopicView {
  if (!isRecord(json) || !int(json.id) || !isRecord(json.post_stream)) throw new Error("not a Discourse topic");
  const posts = postsOf(json);
  const marks = [...(Array.isArray(json.tracked_posts) ? json.tracked_posts.map(trackedMark) : []), ...nextTracked(posts)].filter((m): m is TrackedMark => m !== null);
  const numbers = (rows: TrackedMark[]) => [...new Set(rows.map((m) => m.n))].sort((a, b) => a - b);
  return {
    topic: { id: int(json.id)!, slug: cleanSlug(json.slug), title: clampText(json.title, 200), categoryId: int(json.category_id) },
    tracked: numbers(marks.filter((m) => isBlueGroup(m.group))),
    chain: numbers(marks),
    posts,
  };
}

export interface TrackedMark { n: number; group: string }

/** A tracked-post marker: the post number and the poster's group (Blizzard or MVP). */
const trackedMark = (t: unknown): TrackedMark | null => {
  if (!isRecord(t)) return null;
  const n = int(t.post_number);
  return n ? { n, group: str(t.group) } : null;
};

/**
 * The forum keeps its staff posts as a chain: every loaded post names the next tracked post in the topic
 * (`next_tracked_post`), and a topic view lists only the first one plus the links of the posts it loaded.
 * So the numbers known so far are the topic's list plus every loaded post's link. The chain runs through MVP
 * posts too, so it is followed through them, but only Blizzard groups count as blue.
 */
export function nextTracked(posts: Record<string, unknown>[]): TrackedMark[] {
  return posts.map((p) => trackedMark(p.next_tracked_post)).filter((m): m is TrackedMark => m !== null);
}

/** Discourse slugs may carry non-ASCII letters (an en dash); they are kept percent-encoded so the link stays plain ASCII. */
export function cleanSlug(raw: unknown): string {
  const slug = str(raw);
  let encoded = slug;
  try { encoded = /%[0-9a-f]{2}/i.test(slug) ? slug : encodeURIComponent(slug); } catch { return "topic"; }
  return /^(?:[a-z0-9-]|%[0-9a-f]{2}){1,200}$/i.test(encoded) ? encoded : "topic";
}

/** `/t/<id>/posts.json?post_number=<n>&asc=true`: the next posts after n. */
export function parsePostChunk(json: unknown): Record<string, unknown>[] {
  if (!isRecord(json) || !isRecord(json.post_stream)) throw new Error("not a Discourse post list");
  return postsOf(json);
}

/** Quotes of other posts and link previews are someone else's words, so they never reach an excerpt. */
export function ownWords(cooked: unknown): string {
  let html = str(cooked);
  // Innermost first, so a quote inside a quote goes too.
  for (let i = 0; i < 10; i++) {
    const next = html.replace(/<aside\b[^>]*>(?:(?!<aside\b)[\s\S])*?<\/aside>/gi, " ");
    if (next === html) break;
    html = next;
  }
  return html;
}

const displayName = (username: string, name: string) => clampText(name, 100) || username.replace(/-\d+$/, "");

export const postId = (region: BlueRegion, id: number) => (region === "us" ? `forum:${id}` : `forum:${region}:${id}`);

export function topicUrl(region: BlueRegion, slug: string, topicId: number, postNumber = 1): string {
  return `${REGIONS[region].host}/en/wow/t/${slug}/${topicId}${postNumber === 1 ? "" : `/${postNumber}`}`;
}

/**
 * The staff posts among `posts`, as stored blue posts. A post counts when the forum tracks it as a blue
 * post or its author is on the roster or the include list; never a deleted, hidden, opted-out or
 * small-action post, an excluded author or title, or a topic outside the Forever and Classic categories.
 */
export function bluePostsOf(
  region: BlueRegion, view: { topic: TopicInfo; tracked: number[] }, posts: Record<string, unknown>[], staff: StaffIndex, now: Date,
): BluePost[] {
  const game = gameOf(view.topic.categoryId ?? undefined, region);
  if (!game || !view.topic.title) return [];
  const tracked = new Set(view.tracked);
  const out: BluePost[] = [];
  for (const p of posts) {
    const id = int(p.id);
    const postNumber = int(p.post_number);
    const userId = int(p.user_id);
    const username = str(p.username);
    const postedAt = isoTime(p.created_at);
    if (!id || !postNumber || !userId || !username || !postedAt) continue;
    if (p.post_type !== 1 || p.hidden === true || p.deleted_at || p.user_deleted === true || p.opted_out === true) continue;
    if (int(p.topic_id) !== null && int(p.topic_id) !== view.topic.id) continue;
    const key = username.toLowerCase();
    if (staff.exclude.has(key)) continue;
    const included = staff.include.has(key);
    if (!included && !tracked.has(postNumber) && !staff.ids.has(userId)) continue;
    const role = staff.titles.get(key) || clampText(p.user_title, 100) || staff.titleById.get(userId) || staff.include.get(key) || "";
    if (!included && staff.excludeTitles.has(role.toLowerCase())) continue;
    const edited = Number(p.version) > 1 ? isoTime(p.updated_at) : null;
    out.push({
      id: postId(region, id),
      source: "forum",
      region,
      url: topicUrl(region, view.topic.slug, view.topic.id, postNumber),
      title: view.topic.title,
      author: displayName(username, str(p.name)),
      role,
      postedAt,
      editedAt: edited,
      category: game.category,
      game: game.game,
      kind: /hotfix/i.test(view.topic.title) ? "hotfix" : "post",
      excerpt: clampExcerpt(ownWords(p.cooked)),
      topicId: view.topic.id,
      topicSlug: view.topic.slug,
      postNumber,
      startedThread: postNumber === 1,
      firstSeen: now.toISOString(),
    });
  }
  return out;
}
