import postsFile from "../../../kb/changes/blue-posts.json";
import { type BlueStore } from "../../../kb/src/blue-posts";
import { sanitizePost } from "../../../kb/src/changes";
import { r2Client, r2Config } from "./upload-store";

export const BLUE_POSTS_KEY = "changes/blue-posts.json";
const STATE_KEY = "changes/blue-fetch-state.json";

export function blueStorage() {
  const config = r2Config();
  if (!config) return null;
  const client = r2Client(config);
  const bucket = process.env.BLUE_BUCKET?.trim() || config.r2Bucket;
  return {
    sign: (key: string, init: RequestInit = {}) => client.sign(
      `https://${config.r2AccountId}.r2.cloudflarestorage.com/${bucket}/${key}`, init,
    ),
  };
}

/** Fail on a broken store; only a missing object is a first run. */
export function bluePosts(value: unknown): BlueStore["posts"] {
  if (!value || typeof value !== "object" || !("posts" in value) || !Array.isArray(value.posts)) throw new Error("Invalid blue posts store");
  return value.posts.map(sanitizePost).filter((post) => post !== null);
}

export async function readBlueStore(): Promise<BlueStore> {
  const storage = blueStorage();
  if (!storage) throw new Error("Blue tracker needs R2 configuration");
  async function read(key: string, seed: unknown) {
    const response = await fetch(await storage!.sign(key), { cache: "no-store" });
    if (response.status === 404) return seed;
    if (!response.ok) throw new Error(`Blue store read failed (${response.status})`);
    return response.json();
  }
  // Fetch state was kept in the Actions cache, never committed: the bundled seed is empty.
  const [posts, state] = await Promise.all([read(BLUE_POSTS_KEY, postsFile), read(STATE_KEY, { fetched: {} })]);
  if (!state || typeof state.fetched !== "object" || state.fetched === null || Array.isArray(state.fetched)) throw new Error("Invalid blue fetch state");
  return { posts: bluePosts(posts), fetched: state.fetched };
}

export async function writeBlueStore(store: BlueStore): Promise<void> {
  const storage = blueStorage();
  if (!storage) throw new Error("Blue tracker needs R2 configuration");
  // Posts first: never advance the fetch watermark past posts that were not saved.
  for (const [key, value] of [[BLUE_POSTS_KEY, { posts: store.posts }], [STATE_KEY, { fetched: store.fetched }]] as const) {
    const response = await fetch(await storage.sign(key, {
      method: "PUT", body: JSON.stringify(value), headers: { "content-type": "application/json" },
    }), { cache: "no-store" });
    if (!response.ok) throw new Error(`Blue store write failed (${response.status})`);
  }
}
