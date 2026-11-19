import type { Metadata } from "next";
import Link from "next/link";
import type { AuctionHouse } from "@everloot/protocol";
import JsonLd from "@/components/JsonLd";
import { CoinText } from "@/components/ui/Coins";
import { Card, Container, DataTable, Disclosure, EmptyState, PageHeader, SectionHeading, type Column } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { uploadStore } from "@/lib/upload-store";
import { AH_PATH, busiestHouse, findBoard, itemHref, itemLabel, type ItemNames } from "@/lib/auction-house";
import { loadMarketBoards } from "@/lib/market-boards";
import { DISENCHANT_BUILD, bandValues, chanceText, disenchantDeals, loadDisenchant, materialRows, type BandValue, type Deal, type MaterialRow } from "@/lib/disenchant";
import { bandLabel, unitsRange, type BandYield } from "@kb/disenchant";
import { INDEPENDENT_INSTALLS } from "@kb/drop-rollup";
import { MARKET_RULE, formatCopper } from "@kb/market";
import { auctionNames, itemArt, type ItemTip } from "../auctions/art";
import { Contribute, ItemLink, RealmName } from "../auctions/parts";
import { RealmHousePicker, realmHouseHref, realmHouseParams } from "../auctions/RealmHousePicker";

// The choices live in the query string, so the page is rendered for each request (the rollups are cached by the store).
export const dynamic = "force-dynamic";

const PATH = "/tools/disenchanting";
const HEADING = "Disenchanting";
const lede = "What disenchanting an item gives on WoW: Forever, from the disenchants players recorded, and what that is worth on your auction house.";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "WoW Forever Disenchanting Calculator",
    description: "What disenchanting gives on WoW: Forever by item level band, from recorded disenchants: its value on your auction house and the items worth disenchanting.",
    path: PATH,
  }),
};

type Search = Record<string, string | string[] | undefined>;

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const itemPage = (id: number) => `/database/items/${id}`;

/** The coin text of a value, "at least" when a material had no price. */
function Value({ value, complete }: { value: number; complete: boolean }) {
  return <span className="whitespace-nowrap">{complete ? null : <span className="text-fg-2">at least </span>}<CoinText text={formatCopper(value)} /></span>;
}

export default async function DisenchantingPage(props: { searchParams: Promise<Search> }) {
  const search = await props.searchParams;
  const { realm: slug, house: asked } = realmHouseParams(search);
  const now = new Date();
  const [view, market] = await Promise.all([loadDisenchant(), uploadStore.loadMarket()]);
  const state = market.state;
  const stored = await loadMarketBoards(market, now);
  const realms = stored ? stored.boards(null) : [];
  const realm = slug ? findBoard(realms, slug) : null;
  // A house is its own market: with none asked for, the realm's busiest house, named on the page; never a blend.
  const house: AuctionHouse | null = asked ?? (realm ? busiestHouse(realm.rows)?.house ?? null : null);
  const board = stored && slug && house ? findBoard(stored.boards(house), slug) : null;

  const rated = view.yields.filter((y) => y.state === "rated");
  const collecting = view.yields.filter((y) => y.state === "short").sort((a, b) => b.windows - a.windows);
  const values = bandValues(rated, board, house);
  const deals = disenchantDeals(board, values, view.placer);
  const materials = materialRows(rated, board);

  const ids = [...new Set([...materials.map((m) => m.itemId), ...deals.map((d) => d.itemId)])];
  const tips: Map<number, ItemTip> = ids.length ? (await itemArt(ids)).tips : new Map();
  const names: ItemNames = await auctionNames(ids, tips, stored?.names);
  const realmName = realm?.realm.name ?? null;
  const where = house && realmName ? `the ${house} auction house on ${realmName}` : null;
  // A material links to its price on the chosen house, else to its database page.
  const materialHref = (id: number) => (board ? itemHref(board.realm, id) : itemPage(id));
  const material = (id: number) => <ItemLink id={id} href={materialHref(id)} tip={tips.get(id)} names={names} />;

  const yieldList = (y: BandYield) => (
    <ul className="space-y-0.5">
      {y.rows.map((r) => (
        <li key={r.materialId} className="flex flex-wrap items-baseline gap-x-2">
          {material(r.materialId)}
          <span className="tabular-nums text-fg-2">{`${chanceText(r.chance)} · ${unitsRange(r)} each`}</span>
        </li>
      ))}
    </ul>
  );
  const bandColumns: Column<BandYield>[] = [
    {
      key: "band", header: "Band",
      cell: (y) => (
        <div>
          <div className="text-fg">{bandLabel(y.band)}</div>
          <div className="text-meta tabular-nums text-muted">{`${plural(y.windows, "disenchant")} · ${plural(y.installs, "install")}`}</div>
        </div>
      ),
    },
    { key: "yields", header: "Gives", cell: yieldList },
    ...(board ? [
      { key: "value", header: "Value", numeric: true, cell: (y: BandYield) => { const v = values.get(y.band.id)!; return <Value value={v.value} complete={v.complete} />; } },
      { key: "cut", header: "After cut", numeric: true, cell: (y: BandYield) => { const v = values.get(y.band.id)!; return <Value value={v.afterCut} complete={v.complete} />; } },
    ] : []),
  ];
  const dealColumns: Column<Deal>[] = [
    { key: "item", header: "Item", cell: (d) => <ItemLink id={d.itemId} href={itemHref(d.row.realm, d.itemId)} tip={tips.get(d.itemId)} names={names} /> },
    { key: "band", header: "Band", cell: (d) => <span className="text-fg-2">{bandLabel(d.band.yield.band)}</span> },
    { key: "buy", header: "Min buyout", numeric: true, cell: (d) => <CoinText text={formatCopper(d.row.value.min)} /> },
    { key: "value", header: "Materials after cut", numeric: true, cell: (d) => <CoinText text={formatCopper(d.band.afterCut)} /> },
    { key: "margin", header: "Margin", numeric: true, cell: (d) => <CoinText text={formatCopper(d.margin)} /> },
    { key: "day", header: "Price day", numeric: true, nowrap: true, cell: (d) => d.row.value.day },
  ];
  const materialColumns: Column<MaterialRow>[] = [
    { key: "material", header: "Material", cell: (m) => material(m.itemId) },
    { key: "price", header: "Price", numeric: true, cell: (m) => (m.price === null ? <span className="text-muted">No price</span> : <CoinText text={formatCopper(m.price)} />) },
    {
      key: "from", header: "From",
      cell: (m) => (
        <ul className="space-y-0.5 text-fg-2">
          {m.sources.map((s) => <li key={s.band.id}>{`${bandLabel(s.band)}: ${chanceText(s.chance)}`}</li>)}
        </ul>
      ),
    },
  ];

  const anyFloor = [...values.values()].some((v: BandValue) => !v.complete);

  let prices;
  if (!state) {
    prices = <Card><p className="text-fg-2" role="status">Market values are unavailable right now. They are unrecorded, not zero.</p></Card>;
  } else if (!slug || !house) {
    prices = <EmptyState message={realms.length ? "Pick a realm and an auction house to see what each band is worth there, and which items are worth buying to disenchant." : "No realm has public prices yet: a realm shows here once 3 reporters scan the same item there."} />;
  } else if (!board) {
    prices = <EmptyState message={`No public prices in the ${house} auction house on ${realmName ?? "this realm"} yet: a price shows once 3 reporters scan the same item there.`} />;
  } else {
    prices = (
      <div className="space-y-8">
        <section aria-labelledby="disenchant-deals">
          <SectionHeading id="disenchant-deals" note={`Items listed in ${where} whose band's materials, after the house's cut, are worth more than the item's minimum buyout. Only bands with every material priced; the widest margin first.`}>Buy to disenchant</SectionHeading>
          <DataTable
            dense
            caption={`Items worth buying to disenchant in ${where}`}
            columns={dealColumns}
            rows={deals}
            rowKey={(d) => String(d.itemId)}
            meta={(d) => <>
              <span className="block">{"Buy "}<CoinText text={formatCopper(d.row.value.min)} />{" · materials "}<CoinText text={formatCopper(d.band.afterCut)} /></span>
              <span className="block text-fg">{"Margin "}<CoinText text={formatCopper(d.margin)} /></span>
            </>}
            empty={<EmptyState framed={false} message="Nothing listed here is worth more as materials right now, or the bands it falls in are still collecting." />}
          />
          <p className="mt-2 text-meta text-fg-2">An estimate from the band&apos;s average, not the next result: one disenchant can give less. Prices move; check the listing before you buy.</p>
        </section>
        <section aria-labelledby="disenchant-materials">
          <SectionHeading id="disenchant-materials" note={`Each material's market value in ${where}, else its newest minimum buyout, and the bands that give it.`}>Materials</SectionHeading>
          <DataTable
            dense
            caption={`Disenchanting materials in ${where}`}
            columns={materialColumns}
            rows={materials}
            rowKey={(m) => String(m.itemId)}
            meta={(m) => <>
              <span className="block">{m.price === null ? "No price" : <CoinText text={formatCopper(m.price)} />}</span>
              {m.sources.map((s) => <span key={s.band.id} className="block">{`${bandLabel(s.band)}: ${chanceText(s.chance)}`}</span>)}
            </>}
          />
        </section>
      </div>
    );
  }

  return (
    <Container width="data">
      <JsonLd data={webApplicationJsonLd({ name: HEADING, path: PATH, description: lede })} />
      <PageHeader
        trail={trailFor(PATH)!}
        title={HEADING}
        lede={lede}
        meta={where ? <span>{house} auction house on <RealmName name={realmName!} /></span> : undefined}
        actions={<Link href={AH_PATH} className="btn">Auction House</Link>}
      />
      <div className="space-y-8">
        <RealmHousePicker
          realms={realms.map((b) => ({ slug: b.realm.slug, name: b.realm.name }))}
          realm={slug}
          house={house}
          href={(r, h) => realmHouseHref(PATH, search, r, h)}
          remember="redirect"
        />
        <p data-disenchant-sources className="text-meta text-fg-2">
          {`Bands: found in game files, unconfirmed (build ${DISENCHANT_BUILD}). Results: disenchants recorded by the Everloot addon, shown once ${INDEPENDENT_INSTALLS} installs disenchanted in a band. Prices: players' auction scans, one auction house at a time.`}
        </p>
        <section aria-labelledby="disenchant-bands">
          <SectionHeading id="disenchant-bands" note={where ? `Average material value per disenchant in ${where}${anyFloor ? "; \"at least\" where a material has no price there" : ""}.` : "The chance of each material and how many come out at once."}>What each band gives</SectionHeading>
          {view.unreachable
            ? <Card><p className="text-fg-2" role="status">Disenchant results are unavailable right now. They are unrecorded, not zero.</p></Card>
            : <DataTable
                dense
                caption="Disenchant results by band"
                columns={bandColumns}
                rows={rated}
                rowKey={(y) => String(y.band.id)}
                meta={(y) => {
                  const v = values.get(y.band.id);
                  return <>
                    {y.rows.map((r) => <span key={r.materialId} className="block">{`${itemLabel(r.materialId, names)} ${chanceText(r.chance)} · ${unitsRange(r)} each`}</span>)}
                    {v && <span className="block">Value <Value value={v.value} complete={v.complete} />{" · after cut "}<Value value={v.afterCut} complete={v.complete} /></span>}
                  </>;
                }}
                empty={<EmptyState framed={false} message={`No band has disenchants from ${INDEPENDENT_INSTALLS} installs yet. Disenchant with the addon on and upload: a band shows once ${INDEPENDENT_INSTALLS} installs recorded one in it.`} />}
              />}
          {collecting.length > 0 && (
            <div data-collecting className="mt-3 text-meta text-fg-2">
              <p>Still collecting:</p>
              <ul className="mt-1 grid gap-x-6 gap-y-0.5 lg:grid-cols-2">
                {collecting.map((y) => <li key={y.band.id}>{`${bandLabel(y.band)}: ${plural(y.windows, "disenchant")} from ${plural(y.installs, "install")}, ${y.missingInstalls} more needed.`}</li>)}
              </ul>
            </div>
          )}
        </section>
        {prices}
        <Contribute />
        <div>
          <Disclosure summary="What is a band?">
            <p>The game files sort every armor and weapon piece that can be disenchanted into a band by its kind (armor or weapon), its quality and its item level, and the server draws what comes out from that band&apos;s table. WoW: Forever&apos;s bands are its own: they start at item level 5 and are not the classic ones other addons print. One item is rarely disenchanted often enough to say much on its own, so the disenchants of every item in a band count together. An item the files give no level is placed by the level players&apos; tooltips reported.</p>
          </Disclosure>
          <Disclosure summary="How are the chances and values made?">
            <p>{"A material's chance is the disenchants that gave it out of the band's disenchants. Its average counts every disenchant, the ones that gave none of it too, so the value per disenchant is each material's average times its price, added up. A material with no price on the house is left out and the value is shown as \"at least\". \"After cut\" takes off the house's cut of a sale: 5% on the faction houses, 15% on the neutral one."}</p>
          </Disclosure>
          <Disclosure summary="How are market values made?">
            <p>{MARKET_RULE}</p>
          </Disclosure>
        </div>
      </div>
    </Container>
  );
}
