import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { entityPageJsonLd } from "@/lib/jsonld";
import AdSlot from "@/components/AdSlot";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { npcPage, vendorPage } from "../../../../../../kb/src/world-pages";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { pinLink } from "@/lib/world-map";
import { trailFor } from "@/lib/breadcrumbs";
import { loadItemFacts } from "@/lib/rollup-compute";
import { itemNames, npcNames } from "@/lib/names";
import { entitySummary, reportedLine } from "@/lib/evidence";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { VendorGoods } from "../goods";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import { Container, DataTable, Facts, InShort, OpenData, Tabs, TooltipFrame } from "@/components/ui";
import { hasCard } from "@/lib/tooltip";
import { EmptyTab, EntityHeader, EntityTop, known, LINK, MAP_LINK_HEADER, MapName, ShowOnMap, Unreachable, zoneName } from "../../entity";
import { vendorIndexable } from "@/lib/indexable";
import { entityTitle, vendorDescription } from "@/lib/entity-meta";
import { loreFor } from "@/lib/lore-links";
import LoreSection from "@/components/LoreSection";

export const dynamic = "force-dynamic";

/** An NPC no vendor row names: a 404 (uploads are the only list of vendors). Unreachable storage rules nothing out. */
const unknownVendor = (vendorNpcId: number, facts: Awaited<ReturnType<typeof loadWorldFacts>>) =>
  !facts.unreachable && !facts.vendors.some((r) => r.vendorNpcId === vendorNpcId);

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const facts = await loadWorldFacts();
  const page = vendorPage(Number(params.id), facts);
  if (unknownVendor(page.vendorNpcId, facts)) notFound();
  const name = (facts.unreachable ? undefined : npcNames(facts).get(page.vendorNpcId)) ?? `Vendor ${params.id}`;
  return {
    ...pageMetadata({ title: entityTitle(name, "vendor"), description: vendorDescription({ name, id: page.vendorNpcId, offers: facts.unreachable ? 0 : page.offers.length }), path: `/database/vendors/${params.id}` }),
    robots: { index: vendorIndexable(page, facts.unreachable), follow: true },
  };
}

interface Place { href: string; mapId: number; x: number; y: number }

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
    return href ? [{ href, mapId: pin.mapId, x: pin.x, y: pin.y }] : [];
  });
  const assets = await loadSiteAssets();
  const tips = await loadItemTips(assets, facts.unreachable ? [] : page.offers.map((o) => o.itemId));
  const itemFacts = facts.unreachable || page.offers.length === 0 ? null : await loadItemFacts();
  const items = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  const vendorName = facts.unreachable ? undefined : npcNames(facts).get(page.vendorNpcId);
  const title = vendorName ? `${vendorName} (vendor)` : `Vendor NPC ${page.vendorNpcId}`;
  // A vendor is an NPC: its lore page is its NPC's, under the same rule.
  const lore = vendorName ? await loreFor("npc", page.vendorNpcId, vendorName) : null;
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
    named: Boolean(vendorName),
  });

  return (
    <Container width="data">
      <article>
        <JsonLd data={entityPageJsonLd({ name: title, path: `/database/vendors/${page.vendorNpcId}`, identifier: `vendor:${page.vendorNpcId}` })} />
        <EntityHeader
          trail={trail}
          title={title}
          meta={["Vendor", <Link key="npc" href={`/database/npcs/${page.vendorNpcId}`} className={LINK}>{vendorName ? `NPC ${page.vendorNpcId}` : "NPC page"}</Link>]}
        />
        <EntityTop
          box={
            <TooltipFrame name={title} label={`${title}, as players saw it`}>
              {places[0] && <p>{`${zoneName(places[0].mapId)} at ${places[0].x}, ${places[0].y}`}</p>}
            </TooltipFrame>
          }
          facts={!facts.unreachable && (
            <Facts
              layout="list"
              label={`${title}: quick facts`}
              items={[
                { label: "Goods", value: known(page.offers.length ? `${page.offers.length} prices` : null) },
                { label: "Map positions", value: known(places.length || null), numeric: true },
              ]}
            />
          )}
        />
        <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
        <OpenData
          text={[`${vendorName ?? `Vendor NPC ${page.vendorNpcId}`} (vendor ${page.vendorNpcId})`, ...summary, `Source: https://everloot.app/database/vendors/${page.vendorNpcId}`].join("\n")}
          // The vendor is an NPC: its hover card is the public JSON there is, once players have reported the NPC.
          jsonHref={npc && hasCard.npc(npc) ? `/api/tooltip/npc/${page.vendorNpcId}` : undefined}
        />
        <Tabs
          label={`${title}: relations`}
          tabs={[
            {
              id: "goods", label: "Goods", count: facts.unreachable ? undefined : page.offers.length,
              panel: facts.unreachable ? <Unreachable />
                : page.offers.length ? (
                  <VendorGoods title={title} offers={page.offers} tips={tips} items={items} />
                )
                : <EmptyTab message="No agreed goods yet. An item shows once 3 installs see it for sale." />,
            },
            {
              id: "map", label: "Map", count: facts.unreachable ? undefined : places.length,
              panel: facts.unreachable ? <Unreachable />
                : places.length ? (
                  <DataTable
                    dense
                    caption={`Where ${title} stands`}
                    columns={[
                      { key: "map", header: "Map", cell: (p: Place) => <MapName mapId={p.mapId} /> },
                      { key: "where", header: "Position", numeric: true, cell: (p: Place) => `${p.x}, ${p.y}` },
                      { key: "show", header: MAP_LINK_HEADER, cell: (p: Place) => <ShowOnMap href={p.href} mapId={p.mapId} x={p.x} y={p.y} /> },
                    ]}
                    rows={places}
                    rowKey={(p) => p.href}
                  />
                )
                : <EmptyTab message="No agreed position yet. A pin needs 3 installs at the same spot." />,
            },
          ]}
        />
        <div className="mt-6 space-y-6 empty:hidden">
          <LoreSection match={lore} />
        </div>
        {!facts.unreachable && page.offers.length > 0 && <div className="mt-6"><AdSlot slot="inContent" /></div>}
      </article>
    </Container>
  );
}
