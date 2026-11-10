import { z } from "zod";
import { privateStoreFromEnv, readNamesFile, PRIVATE_MALFORMED, PRIVATE_UNREACHABLE } from "./game-assets";
import { assetsBaseUrl } from "./talents/assets";
import { CLIENT_LAYER } from "./items";
import { npcPage, npcReportedName, type WorldFacts } from "../../../kb/src/world-pages";

export interface WikiEntityNames { version: string; names: Map<number | string, { name: string; wikiPage: string }> }

/** Private build-stamped names: normalized NPC names, and legacy id-keyed spells (inert on the current dump). */
export async function loadWikiEntityNames(kind: "npc" | "spell"): Promise<WikiEntityNames | null> {
  const base = assetsBaseUrl();
  if (!base) return null;
  const schema = z.object({
    schema: z.literal(`everloot.wiki-${kind}-names/${kind === "npc" ? 2 : 1}`), build: z.object({ version: z.string() }),
    wiki: z.object({ licence: z.literal("CC-BY-SA-4.0") }),
    names: z.record(kind === "npc" ? z.string().min(1) : z.string().regex(/^[1-9]\d*$/), z.object({ n: z.string().min(1), w: z.string().regex(/^[^\s"<>]+$/) })),
  });
  const result = await readNamesFile(`wiki-${kind}-names.json`, CLIENT_LAYER.build.version, base, privateStoreFromEnv(), (raw) => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? { version: parsed.data.build.version, names: new Map<string | number, { name: string; wikiPage: string }>(Object.entries(parsed.data.names).map(([id, n]) =>
      [kind === "npc" ? id : Number(id), { name: n.n, wikiPage: `https://warcraft.wiki.gg/wiki/${n.w}` }])) } : null;
  });
  return result === PRIVATE_UNREACHABLE || result === PRIVATE_MALFORMED ? null : result;
}

/** Three-install agreement wins; otherwise only a unanimous report matching an NPC wiki name is shown. */
export function shownNpcName(id: number, facts: WorldFacts & { unreachable?: boolean }, wiki: WikiEntityNames | null) {
  const preferred = facts.unreachable ? null : npcPage(id, facts).name;
  const candidate = facts.unreachable || preferred ? null : npcReportedName(id, facts);
  const fallback = candidate ? wiki?.names.get(candidate) : undefined;
  return { name: preferred || fallback?.name, fromWiki: Boolean(fallback), wikiPage: fallback?.wikiPage };
}

export function shownEntityName(id: number, preferred: string | null | undefined, wiki: WikiEntityNames | null) {
  const fallback = preferred ? undefined : wiki?.names.get(id);
  return { name: preferred || fallback?.name, fromWiki: Boolean(fallback), wikiPage: fallback?.wikiPage };
}
