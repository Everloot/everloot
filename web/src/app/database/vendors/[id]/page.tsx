import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import { pageMetadata } from "@/lib/seo";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { agreedNpc, npcPage, vendorPage } from "@kb/world-pages";
import { zoneByMapId, zoneHref } from "@/lib/zones";
import { npcRelations } from "../../npcs/relations";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { pinLink } from "@/lib/world-map";
import { trailFor } from "@/lib/breadcrumbs";
import { loadItemFacts } from "@/lib/rollup-compute";
import { itemNames, npcNames } from "@/lib/names";
import { entitySummary, reportedLine } from "@/lib/evidence";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { goodsRows, VendorGoods } from "../goods";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import { Tabs, TooltipFrame } from "@/components/ui";
import { hasCard } from "@/lib/tooltip";
import { EMPTY, EmptyTab, EntityPage, known, LINK, PinTable, Unreachable, zoneName, type Pin } from "../../entity";
import { vendorIndexable } from "@/lib/indexable";
import { entityTitle, vendorDescription } from "@/lib/entity-meta";
import { loreFor } from "@/lib/lore-links";
import LoreSection from "@/components/LoreSection";
import { unknownVendor } from "../../unknown";
import EntityMap from "../../EntityMap";
import { entityMapZones } from "../../entity-map";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const facts = await loadWorldFacts();
  const page = vendorPage(Number(params.id), facts);
  if (unknownVendor(page.vendorNpcId, facts)) notFound();
  const name = (facts.unreachable ? undefined : npcNames(facts).get(page.vendorNpcId)) ?? `Vendor ${params.id}`;
  return {
    ...pageMetadata({ title: entityTitle(name, "vendor"), description: vendorDescription({ name, id: page.vendorNpcId, offers: facts.unreachable ? 0 : page.offers.length }), path: `/database/vendors/${params.id}`, image: `${`/database/vendors/${params.id}`}/opengraph-image` }),
    robots: { index: vendorIndexable(page, facts.unreachable), follow: true },
  };
}

interface Place extends Pin { href: string }

const REACTION_LABELS = { friendly: "Friendly", neutral: "Neutral", hostile: "Hostile" } as const;

export default async function VendorPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const facts = await loadWorldFacts();
  const page = vendorPage(Number(params.id), facts);
  if (unknownVendor(page.vendorNpcId, facts)) notFound();
  // Where players saw this vendor stand: the NPC pins that 3 installs agree on, as links to the map.
  const npc = facts.unreachable ? null : npcPage(page.vendorNpcId, facts);
  const places: Place[] = !npc ? [] : npc.pins.flatMap((pin) => {
    const href = pinLink(pin.mapId, pin.x, pin.y);
    return href ? [{ href, mapId: pin.mapId, x: pin.x, y: pin.y, reporters: pin.reporters }] : [];
  });
  const assets = await loadSiteAssets();
  const tips = await loadItemTips(assets, facts.unreachable ? [] : page.offers.map((o) => o.itemId));
  const itemFacts = facts.unreachable || page.offers.length === 0 ? null : await loadItemFacts();
  const items = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  const vendorName = facts.unreachable ? undefined : npcNames(facts).get(page.vendorNpcId);
  const title = vendorName ? `${vendorName} (vendor)` : `Vendor NPC ${page.vendorNpcId}`;
  // Who sells: the NPC's reaction 3 installs agree on and the released zone it stands in, as on its NPC page.
  const reaction = facts.unreachable ? null : agreedNpc(page.vendorNpcId, facts)?.reaction ?? null;
  const zone = places[0] ? zoneByMapId(places[0].mapId) : undefined;
  const zoneLink = zone ? <Link key="zone" href={zoneHref(zone.mapId, zone.name)} className={LINK}>{zone.name}</Link> : null;
  // Each offer with the installs and the date behind it, as the NPC page's Sells tab shows them.
  const { goodsEvidence } = npcRelations(page.vendorNpcId, facts, Date.now());
  const itemsSold = new Set(page.offers.map((o) => o.itemId)).size;
  // Counted on the Sells tab's rows (one per item): every row agreed "not limited" is None, not an unreported fact.
  const rows = goodsRows(page.offers);
  const limited = rows.filter((o) => o.limitedStock !== null).length;
  const stockKnown = rows.length > 0 && rows.every((o) => o.limitedStock !== null || o.unlimited);
  // A vendor is an NPC: its lore page is its NPC's, under the same rule.
  const lore = vendorName ? await loreFor("npc", page.vendorNpcId, vendorName) : null;
  // The map slot draws where the vendor stands; the pin table below is its text.
  const mapZones = entityMapZones(places.map((p) => ({ kind: "vendor", mapId: p.mapId, x: p.x, y: p.y, label: title, agreed: true })), assets?.maps);
  const trail = [...trailFor("/database/vendors")!, { name: title, path: `/database/vendors/${page.vendorNpcId}` }];
  // The page in three lines: what it is, what players reported (prices and positions) with the agreement and the date
  // of the uploads, and where the name came from. Storage down: unrecorded, never "no prices".
  const reportedParts = [
    page.offers.length ? `${page.offers.length} ${page.offers.length === 1 ? "price" : "prices"}` : null,
    places.length ? `${places.length} ${places.length === 1 ? "map position" : "map positions"}` : null,
  ];
  const summary = entitySummary({
    identity: `A vendor in WoW: Forever (NPC ${page.vendorNpcId}).`,
    observed: facts.unreachable ? STORAGE_UNREACHABLE
      : reportedParts.some(Boolean) ? `${reportedLine(reportedParts, facts.dataAsOf ?? null, Date.now())} Each has three installs agreeing.`
      : reportedLine([], null, Date.now()),
    nameFrom: vendorName ? "players" : "none",
  });

  return (
    <EntityPage
      name={title}
      jsonLd={{ name: title, path: `/database/vendors/${page.vendorNpcId}`, identifier: `vendor:${page.vendorNpcId}` }}
      header={{
        trail,
        title,
        meta: [
          "Vendor",
          <Link key="npc" href={`/database/npcs/${page.vendorNpcId}`} className={LINK}>{vendorName ?? "NPC page"}</Link>,
          reaction ? REACTION_LABELS[reaction] : null,
          zoneLink,
          <span key="id" className="tabular-nums">ID {page.vendorNpcId}</span>,
        ],
      }}
      box={
        <TooltipFrame name={title} label={`${title}, as players saw it`}>
          {places[0] && <p>{`${zoneName(places[0].mapId)} at ${places[0].x}, ${places[0].y}`}</p>}
        </TooltipFrame>
      }
      facts={!facts.unreachable && [
        { label: "NPC", value: <Link href={`/database/npcs/${page.vendorNpcId}`} className={LINK}>{vendorName ?? `NPC ${page.vendorNpcId}`}</Link> },
        { label: "Reaction", value: known(reaction && REACTION_LABELS[reaction]) },
        { label: "Zone", value: zoneLink ?? known(null) },
        { label: "Items sold", value: known(itemsSold || null), numeric: true },
        { label: "Limited stock", value: known(limited || (stockKnown ? "None" : null)), numeric: limited > 0 },
        { label: "Map positions", value: known(places.length || null), numeric: true },
      ]}
      summary={summary}
      map={mapZones.length > 0 && <EntityMap name={title} zones={mapZones} />}
      main={<Tabs
        label={`${title}: relations`}
        tabs={[
          {
            // One row per item (goodsRows): an item seen at two prices is one row.
            id: "goods", label: "Sells", count: facts.unreachable ? undefined : itemsSold,
            panel: facts.unreachable ? <Unreachable />
              : page.offers.length ? (
                <VendorGoods title={title} offers={page.offers} tips={tips} items={items} evidence={goodsEvidence} />
              )
              : <EmptyTab message={EMPTY.goods} />,
          },
          {
            id: "map", label: "Map", count: facts.unreachable ? undefined : places.length,
            panel: facts.unreachable ? <Unreachable />
              : places.length ? <PinTable caption={`Where ${title} stands`} rows={places} rowKey={(p) => p.href} />
              : <EmptyTab message={EMPTY.position} />,
          },
        ]}
      />}
      related={<>
        <LoreSection match={lore} />
        {!facts.unreachable && page.offers.length > 0 && <AdSlot slot="inContent" />}
      </>}
      openData={{
        report: { type: "Vendor", id: page.vendorNpcId, path: `/database/vendors/${page.vendorNpcId}` },
        text: [`${vendorName ?? `Vendor NPC ${page.vendorNpcId}`} (vendor ${page.vendorNpcId})`, ...summary, `Source: https://everloot.app/database/vendors/${page.vendorNpcId}`].join("\n"),
        // The vendor is an NPC: its hover card is the public JSON there is, once players have reported the NPC.
        jsonHref: npc && hasCard.npc(npc) ? `/api/tooltip/npc/${page.vendorNpcId}` : undefined,
      }}
    />
  );
}
