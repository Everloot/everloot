import Link from "next/link";
import GameIcon from "@/components/game/GameIcon";
import { withClassContext, type ClassContext } from "@/lib/class-context";
import { professionHref, type ProfessionInfo } from "@/lib/professions";

/**
 * The professions as a row of links, with their game icons when the asset files have them and plain names when
 * not, so the row is never empty. `current` marks the page's own profession.
 */
export default function ProfessionPicker({ professions, icons, current, context }: {
  professions: readonly ProfessionInfo[];
  /** Profession name in lower case → icon URL. */
  icons: Map<string, string>;
  current?: string;
  context: ClassContext | null;
}) {
  return (
    <nav aria-label="Professions" className="flex flex-wrap gap-2">
      {professions.map((p) => {
        const on = p.slug === current;
        const icon = icons.get(p.name.toLowerCase());
        return (
          <Link
            key={p.slug}
            href={withClassContext(professionHref(p.slug), context)}
            aria-current={on ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-control border px-3 text-sm ${on ? "border-accent text-fg" : "border-line text-fg-2 hover:border-accent hover:text-fg"}`}
          >
            {icon && <GameIcon src={icon} size={24} />}
            {p.name}
          </Link>
        );
      })}
    </nav>
  );
}
