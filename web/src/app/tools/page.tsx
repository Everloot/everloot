import type { Metadata } from "next";
import Link from "next/link";
import GameIcon from "@/components/game/GameIcon";
import { Container, PageHeader, SectionHeading } from "@/components/ui";
import { TOOL_LINES, toolGroups } from "@/data/tools";
import { classAndProfessionIcons, emblems, loadSiteAssets, poiIcons, type SiteAssets } from "@/lib/game-assets";
import { trailFor } from "@/lib/breadcrumbs";
import { guildsOn } from "@/lib/guild-switch";
import type { PoiIcons } from "@/lib/map-marks";
import { pageMetadata } from "@/lib/seo";

const description = "Every Everloot tool for WoW: Forever: auction prices and guild boards, the raid, talent and profession planners, guides, and the lists kept on your device.";

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

/** One tool as a card: its game icon (or initial), its name and its one line. */
function ToolCard({ label, href, icon }: { label: string; href: string; icon: string | undefined }) {
  return (
    // The link's area covers the card, so the whole card opens the tool; the name is the link's text.
    <li className="relative flex items-start gap-3 rounded-card border border-line bg-panel p-4 transition-colors focus-within:border-accent hover:border-accent">
      {icon
        ? <GameIcon src={icon} size={36} />
        : <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-line bg-canvas font-semibold text-muted">{label.charAt(0)}</span>}
      <div className="min-w-0 space-y-1">
        <Link href={href} className="font-semibold text-fg after:absolute after:inset-0 after:content-['']">{label}</Link>
        <p className="text-sm text-muted">{TOOL_LINES[href]}</p>
      </div>
    </li>
  );
}

/** Every tool the header offers, as cards under the header's group names (Lookup, Tools, Guides, Profile), in the
 *  menus' order. A tool hidden until polished has no card; with the guild switch on, Guilds replaces the guild board. */
export default async function ToolsPage() {
  const icons = toolIcons(await loadSiteAssets());
  const groups = toolGroups(guildsOn()).filter((g) => g.links.length > 0);
  return (
    <Container>
      <PageHeader title="Tools" lede={description} trail={trailFor("/tools")!} />
      <div className="space-y-10">
        {groups.map((group) => (
          <section key={group.title} aria-labelledby={`tools-${group.title.toLowerCase()}`}>
            <SectionHeading id={`tools-${group.title.toLowerCase()}`}>{group.title}</SectionHeading>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.links.map((l) => <ToolCard key={l.href} label={l.label} href={l.href} icon={icons.get(l.href)} />)}
            </ul>
          </section>
        ))}
      </div>
    </Container>
  );
}
