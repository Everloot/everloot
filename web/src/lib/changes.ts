import postsFile from "../../../kb/changes/blue-posts.json";
import buildsFile from "../../../kb/changes/builds.json";
import manualFile from "../../../kb/curated/manual-changes.json";
import writeupsFile from "../../../kb/curated/blue-writeups.json";
import type { BlueStore } from "../../../kb/src/blue-posts";
import { writeupsById, type BlueWriteup } from "../../../kb/src/blue-writeups";
import { buildTimeline, groupAnnouncements, manualEntries, postPath, type BuildLike, type ChangeEntry } from "../../../kb/src/changes";
import { BLUE_POSTS_KEY, bluePosts, blueStorage } from "./blue-store";

export {
  CHANGE_FILTERS, GAME_LABEL, TYPE_LABEL, blueThreads, buildTimeline, filterTimeline, forumRegions, groupAnnouncements, manualEntries, parseFilter, postIdOfSegment,
  postPath, renderFeed, type BlueThread, type ChangeEntry, type ChangeGame, type ChangeFilter,
} from "../../../kb/src/changes";
export type { BlueWriteup } from "../../../kb/src/blue-writeups";

/**
 * Builds stay bundled. The blue cron updates posts in R2; the bundled posts cover an unavailable store.
 */
const store = postsFile as unknown as BlueStore;
const builds = (buildsFile as unknown as { builds: BuildLike[] }).builds;

/** One entry per announcement: a post Blizzard made on both forums is one entry, the other copies under `copies`. */
export async function loadTimeline(): Promise<ChangeEntry[]> {
  let posts = store.posts;
  try {
    const storage = blueStorage();
    if (storage) {
      const response = await fetch(await storage.sign(BLUE_POSTS_KEY), { next: { tags: ["blue"], revalidate: 600 } });
      if (!response.ok) throw new Error("Blue posts unavailable");
      posts = bluePosts(await response.json());
    }
  } catch { /* The bundled posts remain available during a storage outage. */ }
  return groupAnnouncements([...buildTimeline(posts, builds), ...manualEntries(manualFile)]);
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
