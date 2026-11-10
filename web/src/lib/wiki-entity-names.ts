import { z } from "zod";
import { privateStoreFromEnv, readNamesFile, PRIVATE_MALFORMED, PRIVATE_UNREACHABLE } from "./game-assets";
import { assetsBaseUrl } from "./talents/assets";
import { CLIENT_LAYER } from "./items";

export interface WikiEntityNames { version: string; names: Map<number, { name: string; wikiPage: string }> }

/** The same private, build-stamped wiki names as items and quests, matched by infobox id. */
export async function loadWikiEntityNames(kind: "npc" | "spell"): Promise<WikiEntityNames | null> {
  const base = assetsBaseUrl();
  if (!base) return null;
  const schema = z.object({
    schema: z.literal(`everloot.wiki-${kind}-names/1`), build: z.object({ version: z.string() }),
    wiki: z.object({ licence: z.literal("CC-BY-SA-4.0") }),
    names: z.record(z.string().regex(/^[1-9]\d*$/), z.object({ n: z.string().min(1), w: z.string().regex(/^[^\s"<>]+$/) })),
  });
  const result = await readNamesFile(`wiki-${kind}-names.json`, CLIENT_LAYER.build.version, base, privateStoreFromEnv(), (raw) => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? { version: parsed.data.build.version, names: new Map(Object.entries(parsed.data.names).map(([id, n]) =>
      [Number(id), { name: n.n, wikiPage: `https://warcraft.wiki.gg/wiki/${n.w}` }])) } : null;
  });
  return result === PRIVATE_UNREACHABLE || result === PRIVATE_MALFORMED ? null : result;
}

export function shownEntityName(id: number, preferred: string | null | undefined, wiki: WikiEntityNames | null) {
  const fallback = preferred ? undefined : wiki?.names.get(id);
  return { name: preferred || fallback?.name, fromWiki: Boolean(fallback), wikiPage: fallback?.wikiPage };
}
