import { OpenDataManifest } from "@kb/open-data/manifest";
import { BULK_URL } from "@/lib/docs/connect-data";

/**
 * The newest open data export, read from the public bulk bucket (`web/scripts/upload-open-data.mjs` writes it):
 * `open-data/latest.json` names a folder, and the folder's `manifest.json` says what is in it. The page prints only
 * what the manifest says, so a count on the page is a count in the files. No bucket address, or no export yet,
 * is a state of its own: the page says so, and never prints a number.
 */
export type OpenDataState =
  | { state: "none" }
  | { state: "unreachable" }
  | { state: "ok"; manifest: OpenDataManifest; stamp: string; base: string };

const STAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z$/;

export async function loadOpenData(base: string | null = BULK_URL, fetcher: typeof fetch = fetch): Promise<OpenDataState> {
  if (!base) return { state: "none" };
  const get = async (path: string) => {
    const res = await fetcher(`${base}/${path}`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) } as RequestInit);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return res.json() as Promise<unknown>;
  };
  try {
    const latest = await get("open-data/latest.json");
    if (latest === null) return { state: "none" };
    const { stamp, manifest: path } = (latest ?? {}) as { stamp?: unknown; manifest?: unknown };
    // The pointer may name only the manifest of its own folder, so a bad pointer cannot send the page elsewhere.
    if (typeof stamp !== "string" || !STAMP.test(stamp) || path !== `open-data/${stamp}/manifest.json`) return { state: "unreachable" };
    const manifest = OpenDataManifest.safeParse(await get(path));
    return manifest.success ? { state: "ok", manifest: manifest.data, stamp, base: `${base}/open-data/${stamp}` } : { state: "unreachable" };
  } catch {
    return { state: "unreachable" };
  }
}
