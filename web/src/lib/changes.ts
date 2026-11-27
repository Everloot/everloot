import postsFile from "../../../kb/changes/blue-posts.json";
import buildsFile from "../../../kb/changes/builds.json";
import manualFile from "../../../kb/curated/manual-changes.json";
import writeupsFile from "../../../kb/curated/blue-writeups.json";
import type { BlueStore } from "@kb/blue-posts";
import { writeupsById, type BlueWriteup } from "@kb/blue-writeups";
import { buildTimeline, groupAnnouncements, manualEntries, postPath, type BuildLike, type ChangeEntry } from "@kb/changes";
import { BLUE_POSTS_KEY, bluePosts, blueStorage } from "./blue-store";
import { keep } from "./kept";

export {
  CHANGE_FILTERS, GAME_LABEL, TYPE_LABEL, blueThreads, buildTimeline, filterTimeline, forumRegions, groupAnnouncements, manualEntries, parseFilter, postIdOfSegment,
  postPath, renderFeed, type BlueThread, type ChangeEntry, type ChangeGame, type ChangeFilter,
} from "@kb/changes";
export type { BlueWriteup } from "@kb/blue-writeups";

/**
 * Builds stay bundled. The blue cron updates posts in R2; the bundled posts cover an unavailable store.
 */
const store = postsFile as unknown as BlueStore;
const builds = (buildsFile as unknown as { builds: BuildLike[] }).builds;

/**
 * How long one instance keeps the timeline. Every page, feed and MCP call that lists changes used to read and parse the
 * whole posts file and build the timeline again, so several at once held several copies (#1354). A post the blue cron
 * adds shows within this long of its "blue" tag.
 */
const TIMELINE_KEEP_MS = 60_000;

/** One read per caller (`share: false`): a Worker cancels work one request awaits on another's behalf (release.ts). */
const timeline = keep<Timeline>(async () => ({ value: await readTimeline() }), { ttlMs: TIMELINE_KEEP_MS, share: false });

/** The timeline, and whether it is the bundled posts because the store was not configured or could not be read. */
interface Timeline { entries: ChangeEntry[]; degraded: boolean }

/**
 * One entry per announcement: a post Blizzard made on both forums is one entry, the other copies under `copies`.
 * Shared by every caller of the instance while it is kept: read it, never sort or change it in place.
 */
export async function loadTimeline(): Promise<ChangeEntry[]> {
  return (await timeline.get()).entries;
}

/**
 * Whether the timeline is the bundled posts because the blue store could not be read (or, as on the deploy's build,
 * is not configured): the newest posts may be missing, so a kept page drawn from it is kept only briefly
 * (lib/degraded-render.ts).
 */
export async function timelineDegraded(): Promise<boolean> {
  return (await timeline.get()).degraded;
}

/**
 * The newest `n` rows of a timeline (newest first), one per title per day (UTC): Blizzard sometimes posts twice under
 * one title in a day, and the folded timeline keeps both. The row is the newest of them; `posts` counts them all.
 */
export function oneRowPerTitleDay(entries: readonly ChangeEntry[], n: number): { entry: ChangeEntry; posts: number }[] {
  const rows = new Map<string, { entry: ChangeEntry; posts: number }>();
  for (const entry of entries) {
    const key = `${entry.at.slice(0, 10)}|${entry.title}`;
    const row = rows.get(key);
    if (row) row.posts += 1;
    else if (rows.size < n) rows.set(key, { entry, posts: 1 });
  }
  return [...rows.values()];
}

/** For tests: forget the kept timeline. */
export const forgetTimeline = () => timeline.forget();

async function readTimeline(): Promise<Timeline> {
  let posts = store.posts;
  let degraded = true;
  try {
    const storage = blueStorage();
    if (storage) {
      const response = await fetch(await storage.sign(BLUE_POSTS_KEY), { next: { tags: ["blue"], revalidate: 600 } });
      if (!response.ok) throw new Error("Blue posts unavailable");
      posts = bluePosts(await response.json());
      degraded = false;
    }
  } catch { /* The bundled posts remain available during a storage outage. */ }
  return { entries: groupAnnouncements([...buildTimeline(posts, builds), ...manualEntries(manualFile)]), degraded };
}

/** Our reviewed write-ups of blue posts (kb/curated/blue-writeups), by post id; bundled like the posts. */
export function loadWriteups(): Map<string, BlueWriteup> {
  return writeupsById(writeupsFile);
}

/** An announcement's write-up, whichever of its copies it was written for. */
export function writeupFor(entry: ChangeEntry, writeups: Map<string, BlueWriteup>): BlueWriteup | null {
  return [entry, ...(entry.copies ?? [])].map((c) => writeups.get(c.id)).find(Boolean) ?? null;
}

const sameAddress = (url: string) => url.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

/** The Everloot page of the Blizzard post a link points at (the announcement or one of its copies), or null. */
export function postPathForUrl(url: string, timeline: ChangeEntry[]): string | null {
  const address = sameAddress(url);
  const entry = timeline.find((e) => e.type !== "build" && [e, ...(e.copies ?? [])].some((c) => c.url !== null && sameAddress(c.url) === address));
  return entry ? postPath(entry) : null;
}

/** Where a stored Blizzard post lives: the WoW forums (any region) and Bluesky. */
const BLUE_POST_HOST = /(?:^|\.)forums\.blizzard\.com$|^bsky\.app$/;

/** Whether a link could be a Blizzard post the timeline stores, from its host alone, so a caller can skip loading the timeline. */
export function couldBeBluePost(url: string): boolean {
  try {
    return BLUE_POST_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
