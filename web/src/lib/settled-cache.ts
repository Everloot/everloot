import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSettledList, type SettledList } from "@kb/settled-list";

/**
 * The Desktop App's copy of the settled list (kb/src/settled-list.ts, docs/design/specs/2026-10-21-coverage-plateau-design.md,
 * section 4). Node only, and free of the server's storage code, so the app bundles it without the site's stack: the
 * server side is settled-store.ts.
 */

/** A client build as the addon writes it (protocol `CLIENT_BUILD`). */
export const BUILD_PATTERN = /^\d+(\.\d+)+$/;

/** Once a day (weekly after the plateau, a later step). */
export const APP_REFRESH_MS = 24 * 3_600_000;
/** A copy older than this is not used when the site is out of reach: a fact may have gone to recheck since. */
export const APP_STALE_MS = 7 * 24 * 3_600_000;

interface AppCopy { fetchedAt: number; etag: string | null; list: SettledList }

/**
 * The settled list for a build, as the Desktop App keeps it in its data folder (`settled-<build>.json`): fetched from
 * `/api/coverage/settled` at most once a day, revalidated with its ETag. When the site is out of reach a copy up to
 * a week old is used; past that, or with no build, nothing is skipped.
 */
export async function appSettledList(opts: { folder: string; endpoint: string; build: string | undefined; fetch?: typeof fetch; now?: () => number }): Promise<SettledList | null> {
  const { folder, build } = opts;
  if (!build || !BUILD_PATTERN.test(build) || build.length > 32) return null;
  const now = (opts.now ?? Date.now)();
  const path = join(folder, `settled-${build}.json`);
  let copy: AppCopy | null = null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AppCopy>;
    const list = parseSettledList(raw.list);
    if (list && list.build === build && typeof raw.fetchedAt === "number") copy = { fetchedAt: raw.fetchedAt, etag: typeof raw.etag === "string" ? raw.etag : null, list };
  } catch { /* no copy yet */ }
  if (copy && now - copy.fetchedAt < APP_REFRESH_MS) return copy.list;
  const save = (next: AppCopy) => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(next));
    renameSync(`${path}.tmp`, path);
    return next.list;
  };
  try {
    const url = new URL(`/api/coverage/settled?build=${encodeURIComponent(build)}`, opts.endpoint).href;
    const res = await (opts.fetch ?? fetch)(url, { headers: copy?.etag ? { "if-none-match": copy.etag } : {}, signal: AbortSignal.timeout(15_000) });
    if (res.status === 304 && copy) return save({ ...copy, fetchedAt: now });
    if (!res.ok) throw new Error(`settled list ${res.status}`);
    const list = parseSettledList(await res.json());
    if (!list || list.build !== build) throw new Error("settled list unreadable");
    return save({ fetchedAt: now, etag: res.headers.get("etag"), list });
  } catch {
    return copy && now - copy.fetchedAt < APP_STALE_MS ? copy.list : null;
  }
}
