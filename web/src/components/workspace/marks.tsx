import type { ReactNode } from "react";
import GameIcon from "@/components/game/GameIcon";
import type { Faction } from "@/lib/player-workspace";
import type { WorkspaceIcons } from "@/lib/workspace-icons";

// The small visual pieces Plans and Alts on this device share: a class in its colour with its icon, a faction with its
// crest, a level, professions and plans as chips. Icons only when the page has the asset folder; the words always.

// Written out in full so Tailwind can see each class name.
const CLASS_TEXT: Record<string, string> = {
  warrior: "text-class-warrior", paladin: "text-class-paladin", hunter: "text-class-hunter",
  rogue: "text-class-rogue", priest: "text-class-priest", shaman: "text-class-shaman",
  mage: "text-class-mage", warlock: "text-class-warlock", druid: "text-class-druid",
};
const CLASS_EDGE: Record<string, string> = {
  warrior: "border-l-class-warrior", paladin: "border-l-class-paladin", hunter: "border-l-class-hunter",
  rogue: "border-l-class-rogue", priest: "border-l-class-priest", shaman: "border-l-class-shaman",
  mage: "border-l-class-mage", warlock: "border-l-class-warlock", druid: "border-l-class-druid",
};
const FACTION_TEXT: Record<Faction, string> = { alliance: "text-q-rare", horde: "text-danger" };
const FACTION_NAME: Record<Faction, string> = { alliance: "Alliance", horde: "Horde" };

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A left edge in the class's colour, for a list row; plain without a class. */
export const classEdge = (slug: string | null) => `border-l-4 pl-3 ${slug ? CLASS_EDGE[slug] ?? "border-l-line" : "border-l-line"}`;

/** The class's icon, or a blank square of the same size so rows line up. */
export function ClassIcon({ slug, icons, size = 36 }: { slug: string | null; icons: WorkspaceIcons; size?: number }) {
  const src = slug ? icons.classes[slug] : undefined;
  if (src) return <GameIcon src={src} size={size} />;
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-sm border border-line bg-canvas" style={{ width: size, height: size }} />;
}

export function ClassName({ slug }: { slug: string }) {
  return <span className={`font-medium ${CLASS_TEXT[slug] ?? "text-fg"}`}>{titleCase(slug)}</span>;
}

export function FactionTag({ faction, icons }: { faction: Faction; icons: WorkspaceIcons }) {
  const src = icons.factions[faction];
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${FACTION_TEXT[faction]}`}>
      {src && <GameIcon src={src} size={16} className="border-0" />}
      {FACTION_NAME[faction]}
    </span>
  );
}

export function Chip({ children, href }: { children: ReactNode; href?: string }) {
  const style = "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 text-sm text-fg-2 [overflow-wrap:anywhere]";
  return href ? <a href={href} className={`${style} no-underline hover:border-edge hover:text-accent`}>{children}</a> : <span className={style}>{children}</span>;
}

/** Professions as chips with their icons. Spans, not a list, so a row's own list item holds no others. */
export function ProfessionChips({ professions, icons }: { professions: string[]; icons: WorkspaceIcons }) {
  if (professions.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-1.5">
      <span className="sr-only">Professions: </span>
      {professions.map((p, i) => (
        <Chip key={p}>{icons.professions[p] && <GameIcon src={icons.professions[p]} size={16} className="border-0" />}{p}{i < professions.length - 1 && <span className="sr-only">,</span>}</Chip>
      ))}
    </p>
  );
}

/** The class icon with the level in its corner. The level is said in words beside it, so the corner is not read out. */
export function ClassIconWithLevel({ slug, level, icons }: { slug: string | null; level: number | null; icons: WorkspaceIcons }) {
  return (
    <span className="relative inline-block shrink-0">
      <ClassIcon slug={slug} icons={icons} size={40} />
      {level !== null && (
        <span aria-hidden="true" className="absolute -bottom-1.5 -right-1.5 min-w-5 rounded-full border border-edge bg-canvas px-1 text-center font-mono text-[10px] leading-4 text-fg">{level}</span>
      )}
    </span>
  );
}

/** The "Example" marker every example carries, so a sample is never read as the visitor's own. */
export function ExampleTag() {
  return <span className="inline-flex h-5 items-center rounded-full border border-warning px-2 font-mono text-[11px] uppercase tracking-wide text-warning">Example</span>;
}
