import { dropTierLabel } from "@kb/drop-rollup";
import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { hasCard } from "@/lib/tooltip";
import { objectPage, type ObjectDrop } from "@kb/object-page";
import { pendingLine } from "@kb/pending-loot";
import { objectIndexable } from "@/lib/indexable";
import { entityTitle, objectDescription } from "@/lib/entity-meta";
import { formatMeasuredZero } from "@kb/item-page";
import { loadObjectFacts, OBJECT_KIND_LABELS, objectTraits, skillRangeText } from "@/lib/objects";
import { zoneHref } from "@/lib/zones";
import EntityLink from "@/components/EntityLink";
import ItemTip from "@/components/game/ItemTip";
import { qualityNamed } from "@/components/ui/quality";
import { loreFor } from "@/lib/lore-links";
import LoreSection from "@/components/LoreSection";
import { pageMetadata } from "@/lib/seo";
import { DataTable, Tabs, TooltipFrame, type Column } from "@/components/ui";
import type { Crumb } from "@/lib/jsonld";
import { EMPTY, EmptyTab, EntityPage, FREQUENCY, known, LINK, percent, PinTable, Unreachable } from "../../entity";
import { entitySummary, observedLine } from "@/lib/evidence";
import { unknownObject } from "../../unknown";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import EntityMap from "../../EntityMap";
import { entityMapZones } from "../../entity-map";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const facts = await loadObjectFacts();
  const page = objectPage(Number(params.id), facts);
  if (unknownObject(page, facts, facts.unreachable)) notFound();
  const windows = facts.unreachable ? null : page.zero?.kills ?? page.drops[0]?.kills ?? null;
  const name = !facts.unreachable && page.name ? page.name : `Object ${params.id}`;
  return {
    ...pageMetadata({ title: entityTitle(name, "object"), description: objectDescription({ name, id: page.objectId, items: facts.unreachable ? 0 : page.drops.length, windows }), path: `/database/objects/${params.id}`, image: `${`/database/objects/${params.id}`}/opengraph-image` }),
    robots: { index: objectIndexable(page, facts.unreachable), follow: true },
  };
}

type Tips = Awaited<ReturnType<typeof loadItemTips>>;
/** The Contains table: each item with its icon and quality colour when the game files have them, as on NPC pages. */
const columns = (tips: Tips): Column<ObjectDrop>[] => [
  { key: "item", header: "Item", cell: (d) => <ItemTip tip={tips.get(d.itemId)}><EntityLink kind="item" id={d.itemId} name={d.itemName ?? tips.get(d.itemId)?.name} quality={qualityNamed(tips.get(d.itemId)?.quality)} /></ItemTip> },
  { key: "windows", header: "Loot windows", numeric: true, cell: (d) => d.kills },
  { key: "drops", header: "Drops", numeric: true, cell: (d) => d.drops },
  { key: "tier", header: "Reports", cell: (d) => dropTierLabel(d.reporters) },
  { key: "rate", header: FREQUENCY, numeric: true, cell: (d) => percent(d.rate) },
  { key: "installs", header: "Installs", numeric: true, cell: (d) => d.reporters },
];

export default async function ObjectPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const facts = await loadObjectFacts();
  const page = objectPage(Number(params.id), facts);
  if (unknownObject(page, facts, facts.unreachable)) notFound();
  const title = !facts.unreachable && page.name ? page.name : `Object ${page.objectId}`;
  const trail: Crumb[] = [
    ...trailFor("/database/objects")!,
    { name: title, path: `/database/objects/${page.objectId}` },
  ];
  const windows = page.zero?.kills ?? page.drops[0]?.kills;
  const pins = facts.unreachable ? [] : page.pins ?? [];
  // How 3 installs agree it is opened, the skill they had for a herb or ore, and the zones of its agreed spots.
  const traits = facts.unreachable ? undefined : objectTraits(facts, page.objectId).get(page.objectId);
  const kind = traits?.kind ? OBJECT_KIND_LABELS[traits.kind] : null;
  const zones = traits?.zones ?? [];
  const zoneLinks = zones.length ? <span>{zones.map((z, i) => <span key={z.mapId}>{i > 0 && ", "}<Link href={zoneHref(z.mapId, z.name)} className={LINK}>{z.name}</Link></span>)}</span> : null;
  const assets = pins.length || page.drops.length ? await loadSiteAssets() : null;
  const tips = await loadItemTips(assets, facts.unreachable ? [] : page.drops.map((d) => d.itemId));
  // The map slot draws where players saw it on the minimap; the pin table below is its text.
  const mapZones = pins.length ? entityMapZones(pins.map((p) => ({ kind: "object", mapId: p.mapId, x: p.x, y: p.y, label: title, agreed: true })), assets?.maps) : [];
  // The archive files an object under no type of its own, so its page is one of the "other" pages.
  const lore = !facts.unreachable && page.name ? await loreFor("object", page.objectId, page.name) : null;
  // Reported windows the rates leave out: a count under the drops, never a rate.
  const pending = !facts.unreachable && page.pendingLoot ? <p className="py-2 text-meta text-fg-2">{pendingLine(page.pendingLoot)}</p> : null;
  // The page in three lines: what it is, what players found in it, and what is not known.
  const summary = entitySummary({
    identity: kind ? `${kind}${zones[0] ? ` in ${zones.map((z) => z.name).join(", ")}` : ""}` : "A chest, herb, ore vein or fishing pool",
    observed: observedLine(
      [page.drops.length ? `${page.drops.length} ${page.drops.length === 1 ? "item seen" : "items seen"}` : null, windows ? `${windows} ${windows === 1 ? "loot window" : "loot windows"}` : null],
      null,
      Date.now(),
    ),
    nameFrom: title !== `Object ${page.objectId}` ? "players" : "none",
  });

  return (
    <EntityPage
      name={title}
      jsonLd={{ name: title, path: `/database/objects/${page.objectId}`, identifier: `object:${page.objectId}` }}
      // What it is and where, from what 3 installs agree on; no type yet reads as the four kinds it may be.
      header={{ trail, title, meta: [
        "Object",
        kind ?? "chest, herb, ore vein or fishing pool",
        zones[0] ? <Link key="zone" href={zoneHref(zones[0].mapId, zones[0].name)} className={LINK}>{zones[0].name}</Link> : null,
        title !== `Object ${page.objectId}` ? <span key="id" className="tabular-nums">ID {page.objectId}</span> : null,
      ] }}
      box={<TooltipFrame name={title} label={`${title}, as players saw it`} />}
      facts={!facts.unreachable && [
        { label: "Type", value: known(kind) },
        // What players had when they gathered it, not what the game requires: the client files tie no skill to an object.
        ...(traits?.skill ? [{ label: "Players' skill", value: skillRangeText(traits.skill) }] : []),
        { label: zones.length > 1 ? "Zones" : "Zone", value: zoneLinks ?? known(null) },
        { label: "Loot windows", value: known(windows), numeric: true },
        { label: "Items seen", value: known(page.zero ? "None" : page.drops.length || null), numeric: true },
        { label: "Map positions", value: known(page.pins?.length || null), numeric: true },
      ]}
      summary={summary}
      map={mapZones.length > 0 && <EntityMap name={title} zones={mapZones} />}
      main={<Tabs
        label={`${title}: relations`}
        tabs={[{
          // No rates yet but loot on record (none with an item, short of 3 installs, or outside the rates): no count, so the tab and its line stay.
          id: "drops", label: "Contains", count: facts.unreachable || (!page.drops.length && (page.zero || page.queued || pending)) ? undefined : page.drops.length,
          panel: facts.unreachable ? <Unreachable />
            : <>
              {page.drops.length ? <DataTable dense caption={`What players looted from ${title}`} columns={columns(tips)} rows={page.drops} rowKey={(d) => String(d.itemId)} />
                : page.zero ? <p className="py-3 text-meta text-fg">{formatMeasuredZero(page.zero.kills)} · {dropTierLabel(page.zero.reporters)}.</p>
                : <EmptyTab message={page.queued ? EMPTY.queued : EMPTY.drops("this object")} />}
              {pending}
            </>,
        }, {
          id: "map", label: "Map", count: facts.unreachable ? undefined : pins.length,
          panel: facts.unreachable ? <Unreachable />
            : pins.length ? <PinTable caption={`Where players saw ${title} on the minimap`} rows={pins} rowKey={(p) => `${p.mapId}-${p.x}-${p.y}`} />
            : <EmptyTab message={EMPTY.position} />,
        }]}
      />}
      related={<LoreSection match={lore} />}
      openData={{
        report: { type: "Object", id: page.objectId, path: `/database/objects/${page.objectId}` },
        text: [`${title} (object ${page.objectId})`, ...summary, `Source: https://everloot.app/database/objects/${page.objectId}`].join("\n"),
        jsonHref: !facts.unreachable && hasCard.object(page) ? `/api/tooltip/object/${page.objectId}` : undefined,
      }}
    />
  );
}
