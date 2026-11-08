import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { npcPage, stockLabel, vendorPage, type VendorOffer } from "../../../../../../kb/src/world-pages";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { pinLink } from "@/lib/world-map";
import { trailFor } from "@/lib/breadcrumbs";
import { loadItemFacts } from "@/lib/rollup-compute";
import { itemNames, npcNames } from "@/lib/names";
import { entitySummary, observedLine } from "@/lib/evidence";
import EntityLink from "@/components/EntityLink";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import ItemTip from "@/components/game/ItemTip";
import { Container, DataTable, Facts, InShort, Tabs, TooltipFrame } from "@/components/ui";
import { EmptyTab, EntityHeader, EntityTop, known, LINK, MAP_LINK_HEADER, MapName, ShowOnMap, Unreachable, zoneName } from "../../entity";
import { vendorIndexable } from "@/lib/indexable";
import { entityTitle, vendorDescription } from "@/lib/entity-meta";

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

function formatCopper(copper: number): string {
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  const coins = copper % 100;
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold}g`);
  if (silver > 0 || gold > 0) parts.push(`${silver}s`);
  parts.push(`${coins}c`);
  return parts.join(" ");
}

interface Place { href: string; mapId: number; x: number; y: number }

export default async function VendorPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const facts = await loadWorldFacts();
  const page = vendorPage(Number(params.id), facts);
  if (unknownVendor(page.vendorNpcId, facts)) notFound();
  // Where players saw this vendor stand: the NPC pins that 3 installs agree on, as links to the map.
  const places: Place[] = facts.unreachable ? [] : npcPage(page.vendorNpcId, facts).pins.flatMap((pin) => {
    const href = pinLink(pin.mapId, pin.x, pin.y);
    return href ? [{ href, mapId: pin.mapId, x: pin.x, y: pin.y }] : [];
  });
  const assets = await loadSiteAssets();
  const tips = await loadItemTips(assets, facts.unreachable ? [] : page.offers.map((o) => o.itemId));
  const itemFacts = facts.unreachable || page.offers.length === 0 ? null : await loadItemFacts();
  const items = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  const vendorName = facts.unreachable ? undefined : npcNames(facts).get(page.vendorNpcId);
  const title = vendorName ? `${vendorName} (vendor)` : `Vendor NPC ${page.vendorNpcId}`;
  const trail = [...trailFor("/database/vendors")!, { name: title, path: `/database/vendors/${page.vendorNpcId}` }];
  // The page in three lines: what it sells, where players saw it, and where the name came from.
  const summary = entitySummary({
    identity: page.offers.length ? `${page.offers.length} ${page.offers.length === 1 ? "price" : "prices"} reported` : "No prices reported yet",
    observed: observedLine([places.length ? `${places.length} ${places.length === 1 ? "map position" : "map positions"}` : null], null, Date.now()),
    named: Boolean(vendorName),
  });

  return (
    <Container width="data">
      <article>
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
        <Tabs
          label={`${title}: relations`}
          tabs={[
            {
              id: "goods", label: "Goods", count: facts.unreachable ? undefined : page.offers.length,
              panel: facts.unreachable ? <Unreachable />
                : page.offers.length ? (
                  <DataTable
                    dense
                    caption={`What ${title} sells`}
                    columns={[
                      { key: "item", header: "Item", cell: (o: VendorOffer) => <ItemTip tip={tips.get(o.itemId)}><EntityLink kind="item" id={o.itemId} name={items.get(o.itemId) ?? tips.get(o.itemId)?.name} /></ItemTip> },
                      { key: "price", header: "Price", numeric: true, cell: (o: VendorOffer) => formatCopper(o.priceCopper) },
                      { key: "stock", header: "Stock", numeric: true, cell: (o: VendorOffer) => stockLabel(o) },
                      { key: "installs", header: "Reporters", numeric: true, cell: (o: VendorOffer) => o.reporters },
                    ]}
                    rows={page.offers}
                    rowKey={(o) => `${o.itemId}-${o.priceCopper}`}
                  />
                )
                : <EmptyTab message="No agreed goods yet." />,
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
                : <EmptyTab message="No agreed position yet." />,
            },
          ]}
        />
        {!facts.unreachable && page.offers.length > 0 && <div className="mt-6"><AdSlot slot="inContent" /></div>}
      </article>
    </Container>
  );
}
