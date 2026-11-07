import { AwsClient } from "aws4fetch";
import type { GearBoardSnapshot } from "./leaderboards";
import type { R2Config } from "./upload-store";

/**
 * Where the profile cron keeps the scored gear boards (profile-pipeline.ts), beside the market rollup in the private
 * bucket. One object; the boards and the character pages read it and never score anything themselves. It holds link
 * ids, so it never leaves the server: a page filters it against the links on the boards right now
 * (leaderboards.ts, loadGearBoard) before printing a row.
 */
export const GEAR_BOARD_KEY = "snapshots/gear-board.json";

/** How long one Worker instance reuses the object it read. The cron writes it every 30 minutes. */
const CACHE_MS = 60_000;

export interface GearBoardStore {
  /** The stored boards, or null when the cron has not written them yet or the object is unusable; throws when storage is out of reach. */
  read(): Promise<GearBoardSnapshot | null>;
  write(snapshot: GearBoardSnapshot): Promise<void>;
}

/** The uploads bucket's settings, read here rather than through upload-store, as item-view-store.ts does. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}
const r2Client = (r2: R2Config) => new AwsClient({ accessKeyId: r2.r2AccessKeyId, secretAccessKey: r2.r2SecretAccessKey, service: "s3", region: "auto" });

function usable(raw: unknown): raw is GearBoardSnapshot {
  const s = raw as Partial<GearBoardSnapshot> | null;
  return !!s && s.version === 1 && typeof s.generatedAt === "string" && typeof s.fullAt === "string"
    && (typeof s.watermark === "string" || s.watermark === null) && Array.isArray(s.entries)
    && !!s.refused && typeof s.refused === "object" && !Array.isArray(s.refused);
}

export function createGearBoardStore(opts: { r2: R2Config | null; fetch?: typeof fetch; now?: () => number }): GearBoardStore {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { at: number; snapshot: GearBoardSnapshot | null } | null = null;
  const url = (r2: R2Config) => `https://${r2.r2AccountId}.r2.cloudflarestorage.com/${r2.r2Bucket}/${GEAR_BOARD_KEY}`;
  return {
    async read() {
      if (cached && now() - cached.at < CACHE_MS) return cached.snapshot;
      if (!opts.r2) return null;
      const res = await doFetch(await r2Client(opts.r2).sign(url(opts.r2), { method: "GET", headers: { "accept-encoding": "identity" } }));
      let snapshot: GearBoardSnapshot | null = null;
      if (res.status !== 404) {
        if (!res.ok) throw new Error(`gear board read failed (${res.status})`);
        try {
          const raw: unknown = JSON.parse(await res.text());
          snapshot = usable(raw) ? raw : null;
        } catch { snapshot = null; }
      }
      cached = { at: now(), snapshot };
      return snapshot;
    },
    async write(snapshot) {
      if (!opts.r2) throw new Error("the gear board needs the cloud store");
      const put = await doFetch(await r2Client(opts.r2).sign(url(opts.r2), {
        method: "PUT", body: JSON.stringify(snapshot), headers: { "content-type": "application/json" },
      }));
      if (!put.ok) throw new Error(`gear board write failed (${put.status})`);
      cached = null;
    },
  };
}

let shared: GearBoardStore | null = null;
/** The store over the Worker's R2 settings, made on first use. */
export function gearBoardStore(): GearBoardStore {
  return (shared ??= createGearBoardStore({ r2: r2FromEnv() }));
}
