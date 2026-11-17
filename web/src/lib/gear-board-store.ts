import { AwsClient } from "aws4fetch";
import type { R2Config } from "./upload-store";

/**
 * Where the retired profile cron kept the scored gear boards, beside the market rollup in the private bucket. The
 * synced gear boards gave way to the armory boards (/armory/rankings), so the object is only deleted now.
 */
export const GEAR_BOARD_KEY = "snapshots/gear-board.json";

/** The uploads bucket's settings, read here rather than through upload-store, as item-view-store.ts does. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}

/**
 * Delete the stored gear boards. True once the object is gone (deleted now, or already absent); false without the
 * cloud store; throws when storage answers with an error.
 */
export async function deleteGearBoard(opts: { r2?: R2Config | null; fetch?: typeof fetch } = {}): Promise<boolean> {
  const r2 = opts.r2 === undefined ? r2FromEnv() : opts.r2;
  if (!r2) return false;
  const client = new AwsClient({ accessKeyId: r2.r2AccessKeyId, secretAccessKey: r2.r2SecretAccessKey, service: "s3", region: "auto" });
  const url = `https://${r2.r2AccountId}.r2.cloudflarestorage.com/${r2.r2Bucket}/${GEAR_BOARD_KEY}`;
  const res = await (opts.fetch ?? fetch)(await client.sign(url, { method: "DELETE" }));
  if (!res.ok && res.status !== 404) throw new Error(`gear board delete failed (${res.status})`);
  return true;
}
