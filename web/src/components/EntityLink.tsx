import Link from "next/link";
import GameIcon from "./game/GameIcon";

const PAGE = { item: "items", npc: "npcs", quest: "quests", object: "objects", vendor: "vendors", spell: "spells" } as const;
const WORD = { item: "Item", npc: "NPC", quest: "Quest", object: "Object", vendor: "Vendor NPC", spell: "Spell" } as const;

export type EntityKind = keyof typeof PAGE;

export const entityHref = (kind: EntityKind, id: number) => `/database/${PAGE[kind]}/${id}`;

/**
 * A link to a database page: the agreed name (and icon, when the page has one) in place of
 * "Item 1234". Only an entity with no agreed name falls back to its id. It is not prefetched as the page loads, since
 * tables and tabs hold dozens of these and the database answers a burst of prefetches with 429s; Next still prefetches
 * one on hover or focus. Pass `prefetch` to load a lone link eagerly.
 */
export default function EntityLink({ kind, id, name, icon, prefetch = false, ...aria }: { kind: EntityKind; id: number; name?: string | null; icon?: string | null; prefetch?: boolean; "aria-describedby"?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {icon ? <GameIcon src={icon} size={18} /> : null}
      <Link href={entityHref(kind, id)} prefetch={prefetch} {...aria} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{name || `${WORD[kind]} ${id}`}</Link>
    </span>
  );
}
