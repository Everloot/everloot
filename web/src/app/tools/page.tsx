import type { Metadata } from "next";
import Link from "next/link";
import GameIcon from "@/components/game/GameIcon";
import { Container, PageHeader } from "@/components/ui";
import { TOOL_GROUPS, TOOL_LINES } from "@/data/tools";
import { classAndProfessionIcons, emblems, loadSiteAssets, poiIcons, type SiteAssets } from "@/lib/game-assets";
import { trailFor } from "@/lib/breadcrumbs";
import type { PoiIcons } from "@/lib/map-marks";
import { pageMetadata } from "@/lib/seo";

const description = "Everloot's planners for WoW: Forever: fill a raid, plan a talent build, and work out a profession.";

export const metadata: Metadata = pageMetadata({ title: "WoW Forever Tools", description, path: "/tools" });

/** Which game icon stands for each tool: a class, a profession, a faction crest or a map legend icon. The first
 *  the asset upload has is used; a tool with none, or one added to the group later, shows its initial. */
type IconPick = { class: string } | { profession: string } | { faction: string } | { poi: keyof PoiIcons };
const TOOL_ICONS: Record<string, IconPick[]> = {
  "/tools/raid": [{ poi: "raid" }, { class: "paladin" }],
  "/tools/talents": [{ class: "mage" }],
  "/tools/professions": [{ profession: "Blacksmithing" }],
  "/tools/farming-routes": [{ poi: "herb" }, { profession: "Herbalism" }],
};

/** Each tool's icon URL, for the tools the asset upload has an icon for. */
function toolIcons(assets: SiteAssets | null): Map<string, string> {
  const { classes, professions } = classAndProfessionIcons(assets);
  const factions = emblems(assets).factions;
  const poi = poiIcons(assets);
  const url = (pick: IconPick) => ("class" in pick ? classes.find((c) => c.key === pick.class)?.icon
    : "profession" in pick ? professions.find((p) => p.key === pick.profession)?.icon
      : "faction" in pick ? factions.get(pick.faction)
        : poi[pick.poi]);
  const out = new Map<string, string>();
  for (const [href, picks] of Object.entries(TOOL_ICONS)) {
    const found = picks.map(url).find(Boolean);
    if (found) out.set(href, found);
  }
  return out;
}

/** The Tools menu as cards, in the menu's order (most used first). Lookup, Guides and Profile pages have their own
 *  menus; a tool hidden until polished has no card. */
export default async function ToolsPage() {
  const icons = toolIcons(await loadSiteAssets());
  const links = TOOL_GROUPS.find((g) => g.title === "Tools")!.links;
  return (
    <Container>
      <PageHeader title="Tools" lede={description} trail={trailFor("/tools")!} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => {
          const icon = icons.get(l.href);
          return (
            // The link's area covers the card, so the whole card opens the tool; the name is the link's text.
            <li key={l.href} className="relative flex items-start gap-3 rounded-card border border-line bg-panel p-4 transition-colors focus-within:border-accent hover:border-accent">
              {icon
                ? <GameIcon src={icon} size={36} />
                : <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-line bg-canvas font-semibold text-muted">{l.label.charAt(0)}</span>}
              <div className="min-w-0 space-y-1">
                <Link href={l.href} className="font-semibold text-fg after:absolute after:inset-0 after:content-['']">{l.label}</Link>
                <p className="text-sm text-muted">{TOOL_LINES[l.href]}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Container>
  );
}
