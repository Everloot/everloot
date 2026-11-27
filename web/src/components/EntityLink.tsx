import Link from "./Link";
import GameIcon from "./game/GameIcon";
import { QUALITY_TEXT, type Quality } from "./ui/quality";
import Badge from "./ui/Badge";

const PAGE = { item: "items", npc: "npcs", quest: "quests", object: "objects", vendor: "vendors", spell: "spells" } as const;
const WORD = { item: "Item", npc: "NPC", quest: "Quest", object: "Object", vendor: "Vendor NPC", spell: "Spell" } as const;

export type EntityKind = keyof typeof PAGE;

export const entityHref = (kind: EntityKind, id: number) => `/database/${PAGE[kind]}/${id}`;

/**
 * A link to a database page: the agreed name (and icon, when the page has one) in place of
 * "Item 1234". Only an entity with no agreed name falls back to its id. Like every /database link it is never
 * prefetched, on view or on hover (see ./Link); `prefetch` is accepted and ignored. An item's name wears its `quality` colour;
 * `unconfirmed` adds the quiet mark of a name only the game files give, as the lists draw it.
 */
export default function EntityLink({ kind, id, name, icon, quality, unconfirmed, prefetch: _prefetch, ...aria }: { kind: EntityKind; id: number; name?: string | null; icon?: string | null; quality?: Quality; unconfirmed?: boolean; prefetch?: boolean; "aria-describedby"?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {icon ? <GameIcon src={icon} size={18} /> : null}
      <Link href={entityHref(kind, id)} {...aria} className={`${quality ? QUALITY_TEXT[quality] : "text-fg"} underline decoration-edge underline-offset-4 hover:decoration-fg`}>{name || `${WORD[kind]} ${id}`}</Link>
      {unconfirmed && <Badge tone="files" />}
    </span>
  );
}
