import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { EntityIcon } from "@/components/game/EntityIcon";
import GameIcon from "@/components/game/GameIcon";
import { DataTable, Tabs, TooltipFrame } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { parseSegment } from "@/lib/completion-lists";
import { loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { pageMetadata } from "@/lib/seo";
import { petFamiliesBuild, petFamilyEntries, petFamilyHref } from "@/lib/world-events";
import { CLIENT_LABEL } from "@kb/edges";
import { EmptyTab, EntityPage, LINK } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const entryOf = (segment: string) => {
  const id = parseSegment(segment);
  return id === null ? undefined : petFamilyEntries()?.find((f) => f.id === id);
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const family = entryOf((await props.params).id);
  if (!family) return { robots: { index: false, follow: true } };
  return {
    ...pageMetadata({ title: `${family.name} (hunter pet family)`, description: `The ${family.name} hunter pet family in WoW: Forever and the abilities on its skill line. ${CLIENT_LABEL}.`, path: petFamilyHref(family.id, family.name), image: `${petFamilyHref(family.id, family.name)}/opengraph-image` }),
    robots: { index: true, follow: true },
  };
}

/** One row per spell name the page may show (its ranks together, lowest id first); a spell with no shown name keeps its own row. */
interface Ability { key: string; name: string | null; ids: number[] }

export default async function PetFamilyPage(props: Props) {
  const { id: segment } = await props.params;
  const family = entryOf(segment);
  if (!family) notFound();
  const path = petFamilyHref(family.id, family.name);
  if (`/database/pet-families/${segment}` !== path) permanentRedirect(path);
  const [assets, names] = await Promise.all([loadSiteAssets(), family.spellIds.length ? loadSpellNames(CLIENT_LAYER.build.version) : null]);
  const abilities = new Map<string, Ability>();
  for (const id of family.spellIds) {
    const name = names?.names.get(id) ?? null;
    const key = name ?? `#${id}`;
    const row = abilities.get(key) ?? { key, name, ids: [] };
    row.ids.push(id);
    abilities.set(key, row);
  }
  const rows = [...abilities.values()].sort((a, b) => (a.name ?? "~").localeCompare(b.name ?? "~") || a.ids[0]! - b.ids[0]!);
  const trail = [...(trailFor("/database/pet-families") ?? []), { name: family.name, path }];
  const summary = [
    "A hunter pet family in WoW: Forever.",
    "No player report confirms pet families yet.",
    `The game files list it, with ${family.spellIds.length} ${family.spellIds.length === 1 ? "spell" : "spells"} on its own skill line (${family.skillLine}).`,
    "The name is shown from the game files; players have not reported it yet.",
  ];
  return (
    <EntityPage
      name={family.name}
      jsonLd={{ name: family.name, path, identifier: `pet-family:${family.id}` }}
      header={{
        trail, title: family.name,
        icon: <EntityIcon src={assets?.familyIcons.get(family.id)} unconfirmed />,
        meta: ["Hunter pet family", <span key="id" className="tabular-nums">ID {family.id}</span>],
      }}
      box={<TooltipFrame name={family.name} label={`${family.name}, ${CLIENT_LABEL.toLowerCase()}`}><p>Hunter pet family</p></TooltipFrame>}
      facts={[
        { label: "Tamed by", value: <Link href="/classes/hunter" className={LINK}>Hunters</Link> },
        { label: "Skill line", value: family.skillLine, numeric: true },
        { label: "Spells", value: family.spellIds.length, numeric: true },
        { label: "Build", value: petFamiliesBuild() ?? "Unrecorded", numeric: true },
      ]}
      summary={summary}
      main={<Tabs
        label={`${family.name}: relations`}
        tabs={[{
          id: "abilities", label: "Abilities", count: rows.length,
          panel: rows.length ? (
            <DataTable
              dense
              caption={`Spells on the ${family.name} skill line, ${CLIENT_LABEL.toLowerCase()}`}
              columns={[
                {
                  key: "name", header: "Spell", cell: (a) => {
                    const icon = assets?.spellIcons.get(a.ids[0]!);
                    return (
                      <span className="inline-flex items-center gap-2">
                        {icon && <GameIcon src={icon} size={20} />}
                        <Link prefetch={false} href={`/database/spells/${a.ids[0]}`} className={LINK}>{a.name ?? `Spell ${a.ids[0]}`}</Link>
                      </span>
                    );
                  },
                },
                { key: "ranks", header: "Spell ids", cell: (a) => <span className="font-mono text-cell-2 text-muted">{a.ids.join(", ")}</span> },
              ]}
              rows={rows}
              rowKey={(a) => a.key}
            />
          ) : <EmptyTab players={false} action={null} message="The game files list no spells on this family's skill line." />,
        }]}
      />}
      openData={{ report: { type: "Hunter pet family", id: family.id, path }, text: [`${family.name} (hunter pet family ${family.id})`, ...summary, `Source: https://everloot.app${path}`].join("\n") }}
    />
  );
}
