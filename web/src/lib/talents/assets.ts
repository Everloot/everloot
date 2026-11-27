import { z } from "zod";

// Blizzard's icons, tooltip text and window art for the talent calculator (docs/DATA_POLICY.md,
// "Blizzard's icons, tooltip text and window frame"). They live in asset storage, never in git. The
// calculator reads a build-stamped manifest (written by `npm run kb -- client-assets`, uploaded as
// docs/ASSETS.md describes) from NEXT_PUBLIC_GAME_ASSETS_URL. With no URL, or a manifest that cannot
// be read, it returns null and the page keeps its text tiles. This is the only module that knows the
// URL: the API, MCP and data downloads never import it (assets.test.ts checks that).

export const MANIFEST_SCHEMA = "everloot.game-assets/1";
export const CREDIT =
  "Icons, tooltip text and interface art are © Blizzard Entertainment, Inc. Everloot is a fan project and is not affiliated with or endorsed by Blizzard.";

// A path inside the asset folder: letters, digits, dot, dash, underscore, slash; never `..` or a scheme.
const path = z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/).refine((p) => !p.split("/").some((s) => s === ".." || s === ""), "bad path");
/** The same rule for the site-wide reader (lib/game-assets.ts). */
export const assetPath = path;
const file = z.object({ file: path, width: z.number().int().positive(), height: z.number().int().positive() });
const text = z.object({ text: z.string(), unresolved: z.array(z.string()) });

const manifest = z.object({
  schema: z.literal(MANIFEST_SCHEMA),
  label: z.string(),
  build: z.object({ version: z.string().min(1), buildId: z.number().int() }),
  spells: z.record(z.string(), z.object({
    name: z.string().nullable(),
    icon: path.nullable(),
    passive: z.boolean().nullable(),
    description: text.nullable(),
    // The text at each rank (index 0 is rank 1), from the talent's curves. Manifests extracted before build 71139's
    // curves were read have none.
    ranks: z.array(text).optional(),
  })),
  // Newer manifests leave the icon list out (each talent names its icon); older ones still carry it.
  icons: z.record(z.string(), file).optional(),
  frames: z.record(z.string(), file),
  backgrounds: z.record(z.string(), z.object({ element: z.string(), nearest: z.boolean() })),
});

/** A talent's tooltip text; `partial` when it holds a placeholder for a value the files do not give. */
export interface TalentText { text: string; partial: boolean }

export interface GameAssets {
  /** The game build the files came from. */
  version: string;
  label: string;
  /**
   * By trait definition id (TalentEntry.definitionId). `text` holds the spell's stored amounts; `ranks`, where the
   * files give them, the text at each rank (index 0 is rank 1).
   */
  spells: Map<number, { icon: string | null; passive: boolean | null; text: string | null; partial: boolean; ranks?: TalentText[] }>;
  /** Frame pieces by the client's name for them, as ready URLs. */
  frames: Map<string, { url: string; width: number; height: number }>;
  /** `class:Tree name` -> frame piece name. */
  backgrounds: Map<string, { element: string; nearest: boolean }>;
}

/** The configured asset folder with no trailing slash, or null when it is unset or not an http(s) URL. */
export function assetsBaseUrl(raw: string | undefined = process.env.NEXT_PUBLIC_GAME_ASSETS_URL): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Reads a manifest. Null for anything that is not a valid one, so a bad upload shows the text tiles, not an error. */
export function parseManifest(json: unknown, base: string): GameAssets | null {
  const parsed = manifest.safeParse(json);
  if (!parsed.success) return null;
  const m = parsed.data;
  const url = (p: string) => `${base}/${p}`;
  const spells: GameAssets["spells"] = new Map();
  for (const [id, s] of Object.entries(m.spells)) {
    const n = Number(id);
    if (!Number.isInteger(n)) continue;
    spells.set(n, {
      icon: s.icon ? url(`icons/${s.icon}`) : null, passive: s.passive, text: s.description?.text ?? null, partial: (s.description?.unresolved.length ?? 0) > 0,
      ranks: s.ranks?.map((r) => ({ text: r.text, partial: r.unresolved.length > 0 })),
    });
  }
  if (spells.size === 0) return null;
  const frames = new Map(Object.entries(m.frames).map(([name, f]) => [name, { url: url(f.file), width: f.width, height: f.height }]));
  return { version: m.build.version, label: m.label, spells, frames, backgrounds: new Map(Object.entries(m.backgrounds)) };
}

/** Fetches and reads the manifest. Never throws: any failure is null. */
export async function loadGameAssets(base: string | null = assetsBaseUrl(), fetcher: typeof fetch = fetch): Promise<GameAssets | null> {
  if (!base) return null;
  try {
    const res = await fetcher(`${base}/manifest.json`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return parseManifest(await res.json(), base);
  } catch {
    return null;
  }
}

/** Frame pieces the in-game look needs. Without all of these the nodes keep the plain look (icons and tooltips still show). */
const NEEDED = ["circle", "square"].flatMap((s) => ["gray", "green", "yellow"].map((st) => `talents-node-${s}-${st}`));
export const hasNodeFrames = (a: GameAssets): boolean => NEEDED.every((n) => a.frames.has(n));
