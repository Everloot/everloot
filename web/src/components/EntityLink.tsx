import Link from "next/link";
import GameIcon from "./game/GameIcon";

const PAGE = { item: "items", npc: "npcs", quest: "quests", object: "objects", vendor: "vendors" } as const;
const WORD = { item: "Item", npc: "NPC", quest: "Quest", object: "Object", vendor: "Vendor NPC" } as const;

export type EntityKind = keyof typeof PAGE;

export const entityHref = (kind: EntityKind, id: number) => `/database/${PAGE[kind]}/${id}`;

/**
 * A link to a database page: the agreed name (and icon, when the page has one) in place of
 * "Item 1234". Only an entity with no agreed name falls back to its id.
 */
export default function EntityLink({ kind, id, name, icon, ...aria }: { kind: EntityKind; id: number; name?: string | null; icon?: string | null; "aria-describedby"?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {icon ? <GameIcon src={icon} size={18} /> : null}
      <Link href={entityHref(kind, id)} {...aria} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{name || `${WORD[kind]} ${id}`}</Link>
    </span>
  );
}
