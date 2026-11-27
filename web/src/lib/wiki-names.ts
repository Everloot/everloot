import type { TokenKind } from "@kb/wiki/page";
import { entityHref } from "@/components/EntityLink";
import { factionHref, loadCatalog } from "@/lib/completion-lists";
import { PRIVATE_UNREACHABLE, readQuestNames } from "@/lib/game-assets";
import gameBuild from "@/data/game-data/build-version.json";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { loadShownNames, tokenNamer } from "@/lib/shown-item-names";
import { inlinesOf, type WikiPage } from "@/lib/wiki";
import { zoneByMapId, zoneHref } from "@/lib/zones";

/** What a token renders: the name the site may show and its database page; no link when the page does not exist. */
export interface TokenTarget { name: string; href: string | null }

const WORD: Record<TokenKind, string> = { item: "Item", npc: "NPC", quest: "Quest", zone: "Zone", faction: "Faction" };

export const tokenKey = (kind: TokenKind, id: number) => `${kind}:${id}`;

/**
 * The name and link of every entity token on a page: item, NPC and quest names by `tokenNamer` (shown-item-names.ts,
 * under the policy at the top of names.ts), a released zone's name, an agreed faction. Anything without one reads "Item N".
 * Only the sources a page's tokens need are read.
 */
export async function resolveTokens(page: Pick<WikiPage, "blocks">): Promise<Map<string, TokenTarget>> {
  return (await readTokens(page)).tokens;
}

/**
 * `resolveTokens`, and whether a source a token needed could not be read (its name may then read "Item N"): a kept
 * page drawn that way is kept only briefly (lib/degraded-render.ts).
 */
export async function readTokens(page: Pick<WikiPage, "blocks">): Promise<{ tokens: Map<string, TokenTarget>; degraded: boolean }> {
  const ids: Record<TokenKind, Set<number>> = { item: new Set(), npc: new Set(), quest: new Set(), zone: new Set(), faction: new Set() };
  for (const b of page.blocks) for (const run of inlinesOf(b)) for (const t of run) if (t.kind === "entity") ids[t.entity].add(t.id);

  const [shown, world, questRead, catalog] = await Promise.all([
    ids.item.size ? loadShownNames() : null,
    ids.npc.size || ids.quest.size ? loadWorldFacts() : null,
    ids.quest.size ? readQuestNames(gameBuild.version) : null,
    ids.faction.size ? loadCatalog() : null,
  ]);
  const questWiki = questRead === PRIVATE_UNREACHABLE ? null : questRead;
  const degraded = shown?.degraded === true || world?.unreachable === true || questRead === PRIVATE_UNREACHABLE || (ids.faction.size > 0 && catalog === null);
  const nameOf = tokenNamer({ shown, world, questWiki });

  const out = new Map<string, TokenTarget>();
  const fallback = (kind: TokenKind, id: number) => `${WORD[kind]} ${id}`;
  for (const kind of ["item", "npc", "quest"] as const) {
    for (const id of ids[kind]) out.set(tokenKey(kind, id), { name: nameOf(kind, id) ?? fallback(kind, id), href: entityHref(kind, id) });
  }
  for (const id of ids.zone) {
    const zone = zoneByMapId(id);
    out.set(tokenKey("zone", id), zone ? { name: zone.name, href: zoneHref(zone.mapId, zone.name) } : { name: fallback("zone", id), href: null });
  }
  for (const id of ids.faction) {
    const faction = catalog?.factions.find((f) => f.factionId === id);
    out.set(tokenKey("faction", id), faction ? { name: faction.name, href: factionHref(faction.factionId, faction.name) } : { name: fallback("faction", id), href: null });
  }
  return { tokens: out, degraded };
}
