import { z } from "zod";
import { assetsBaseUrl } from "@/lib/talents/assets";

// Model pictures on the item and NPC pages (docs/ASSETS.md, "Model pictures"; docs/DATA_POLICY.md, "Fourth
// extension"). `npm run kb -- client-renders` draws them and the upload puts `renders.json` in the build folder
// beside manifest.json, and the pictures in the bucket's shared `renders/` folder, one level up. Server-side only, like
// lib/game-assets.ts: pages call it while rendering. The API, MCP and data downloads never import it
// (talents/assets.test.ts checks that). With no asset URL, no renders.json, or one that cannot be read in time, there
// is no picture and the pages look as they did.

export const RENDERS_SCHEMA = "everloot.game-renders/1";
/** How long a page keeps renders.json before reading it again. */
const REVALIDATE_SECONDS = 3600;
/** A missing or unreadable renders.json is asked for again after this, not on every page view. */
const MISS_SECONDS = 60;
/** A slow bucket must not hold a page up. */
const FETCH_TIMEOUT_MS = 2500;

const Picture = z.string().regex(/^renders\/[0-9a-f]{32}\.webp$/);
const Id = z.string().regex(/^[1-9]\d*$/);
// Only what the pages use; the counts and skip reasons are for the maintainer.
const RendersSchema = z.object({
  schema: z.literal(RENDERS_SCHEMA),
  size: z.number().int().positive(),
  creatureDisplays: z.record(Id, Picture),
  itemDisplays: z.record(Id, Picture),
  npcs: z.record(Id, z.number().int()),
  items: z.record(Id, z.number().int()),
});

/** A model picture: square, `size` pixels a side, WebP on a transparent background. */
export interface ModelPicture { url: string; size: number }

export interface Renders {
  /** NPC id -> picture, through the NPC's creature display. */
  npcs: Map<number, ModelPicture>;
  /** Item id -> picture, through the item's display. */
  items: Map<number, ModelPicture>;
}

/**
 * The bucket's root, where the shared `renders/` folder is: the asset URL without its build folder
 * ("https://assets.example/wow_classic_beta-70450-84bea423" -> "https://assets.example"). Null when the URL has
 * no build folder.
 */
export function rendersRoot(base: string): string | null {
  try {
    const u = new URL(base);
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    return `${u.origin}${parts.slice(0, -1).map((p) => `/${p}`).join("")}`;
  } catch {
    return null;
  }
}

/** Reads renders.json. Null for anything that is not a valid one; an id whose display has no picture is left out. */
export function parseRenders(json: unknown, base: string): Renders | null {
  const parsed = RendersSchema.safeParse(json);
  const root = rendersRoot(base);
  if (!parsed.success || !root) return null;
  const m = parsed.data;
  const link = (ids: Record<string, number>, pictures: Record<string, string>) => new Map(Object.entries(ids).flatMap(([id, display]) => {
    const file = pictures[String(display)];
    return file ? [[Number(id), { url: `${root}/${file}`, size: m.size }] as const] : [];
  }));
  return { npcs: link(m.npcs, m.creatureDisplays), items: link(m.items, m.itemDisplays) };
}

const kept = new Map<string, { at: number; value: Renders | null }>();
const pending = new Map<string, Promise<Renders | null>>();
/** For tests: forget renders.json reads. */
export const forgetRenders = () => { kept.clear(); pending.clear(); };

/** Fetches and reads renders.json once per build URL and hour (a miss, once a minute). Never throws. */
export async function loadRenders(base: string | null = assetsBaseUrl(), fetcher: typeof fetch = fetch): Promise<Renders | null> {
  if (!base) return null;
  const hit = kept.get(base);
  if (hit && Date.now() - hit.at < (hit.value ? REVALIDATE_SECONDS : MISS_SECONDS) * 1000) return hit.value;
  const inFlight = pending.get(base);
  if (inFlight) return inFlight;
  const read = (async () => {
    let value: Renders | null = null;
    try {
      const res = await fetcher(`${base}/renders.json`, {
        headers: { accept: "application/json" }, next: { revalidate: REVALIDATE_SECONDS }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) value = parseRenders(await res.json(), base);
    } catch {
      value = null;
    }
    kept.set(base, { at: Date.now(), value });
    return value;
  })().finally(() => { pending.delete(base); });
  pending.set(base, read);
  return read;
}
