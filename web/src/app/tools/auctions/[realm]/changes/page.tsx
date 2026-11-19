import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { AuctionHouse } from "@everloot/protocol";
import { MARKET_RULE, THIN_UNITS, formatCopper, reportersText } from "@kb/market";
import { pageMetadata } from "@/lib/seo";
import { uploadStore } from "@/lib/upload-store";
import { storedMarketBoards, type MarketBoards } from "@/lib/market-boards";
import { reportDates } from "@/lib/auction-report-store";
import { reportHref } from "@/lib/auction-report";
import {
  AH_PATH, HOUSES, changesHref, findBoard, houseCounts, houseParam, houseSlug, itemHref, percent, realmHref, slugParam, slugWords,
} from "@/lib/auction-house";
import { NO_CHANGE_STATES, STATE_RULE, weeklyChanges, type Compared, type NotCompared, type WeeklyChanges } from "@/lib/market-changes";
import { AGREEMENT_NEEDED, Card, Container, DataTable, DataTitle, Disclosure, EmptyState, SectionHeading, type Column } from "@/components/ui";
import { CoinText } from "@/components/ui/Coins";
import type { Crumb } from "@/lib/jsonld";
import { trailFor } from "@/lib/breadcrumbs";
import { auctionNames, itemArt } from "../../art";
import { Contribute, Facts, ItemLink, RealmName, count } from "../../parts";
import { RealmHousePicker } from "../../RealmHousePicker";
import TimeAgo from "../../TimeAgo";

type Search = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ realm: string }>; searchParams?: Promise<Search> };

// The house lives in the query string, so the page is rendered for each request (the stored boards are kept per instance).
export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? "" : value ?? "");
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** The realm's house with the most priced items, in the game's house order on a tie; null when no house has a board. */
function busiestHouseOf(stored: MarketBoards, slug: string): AuctionHouse | null {
  let best: { house: AuctionHouse; items: number } | null = null;
  for (const house of HOUSES) {
    const items = findBoard(stored.boards(house), slug)?.items ?? 0;
    if (items > (best?.items ?? 0)) best = { house, items };
  }
  return best?.house ?? null;
}

/**
 * What the page and its metadata read: the stored boards only (never built from the rollup here), the realm's board
 * for the chosen house, or the busiest house when the URL names none.
 */
async function load(slug: string, search: Search) {
  const house = houseParam(one(search.house) || undefined);
  if (house === undefined) notFound();
  const now = new Date();
  const market = await uploadStore.loadMarket();
  const stored = await storedMarketBoards(market, now);
  const shown = house ?? (stored ? busiestHouseOf(stored, slug) : null);
  const board = stored && shown ? findBoard(stored.boards(shown), slug) : null;
  const realmName = stored ? findBoard(stored.boards(null), slug)?.realm.name ?? null : null;
  return { now, market, stored, house, shown, board, realmName: realmName ?? slugWords(slug) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const slug = slugParam((await props.params).realm);
  if (!slug) return { robots: { index: false, follow: true } };
  const { now, house, shown, board, realmName } = await load(slug, (await props.searchParams) ?? {});
  const changes = board ? weeklyChanges(board, now) : null;
  const where = shown ? `the ${shown} auction house on ${realmName}` : realmName;
  return {
    ...pageMetadata({
      title: `WoW Forever ${realmName} Market Changes This Week`,
      description: `What rose and fell this week in ${where} in WoW: Forever: each item's market value a week apart, units listed, reporters, and the items with no comparison yet, from scans players upload.`,
      path: changesHref({ slug }),
    }),
    // Indexed only as the plain view (no house in the URL), and only with a move to show.
    robots: { index: Boolean(!house && changes && (changes.risersTotal || changes.fallersTotal)), follow: true },
  };
}

/** A reporter count; under 3 the day is public because Everloot's own installs scanned it, and the cell says so. */
const reporterCell = (n: number) => (n < AGREEMENT_NEEDED ? reportersText(n) : n);
const units = (c: { row: Compared["row"] }) => `${c.row.value.quantity.toLocaleString("en-US")}${c.row.value.thin ? " (thin)" : ""}`;

export default async function MarketChangesPage(props: Props) {
  const raw = (await props.params).realm;
  const slug = slugParam(raw);
  if (!slug) notFound();
  const search = (await props.searchParams) ?? {};
  if (decodeURIComponent(raw) !== slug) permanentRedirect(changesHref({ slug }, houseParam(one(search.house) || undefined) ?? null));
  const { now, market, stored, shown, board, realmName } = await load(slug, search);
  const path = changesHref({ slug });
  const trail: Crumb[] = [...trailFor(AH_PATH)!, { name: realmName, path: realmHref({ slug }) }, { name: "Market changes", path }];
  const changes = board ? weeklyChanges(board, now) : null;

  // Names and art for the rows shown, from the stored boards' names first; the art is the item pages' tooltips.
  const ids = changes ? [...changes.risers, ...changes.fallers, ...changes.notCompared].map((c) => c.row.value.itemId) : [];
  const tips = (await itemArt(ids)).tips;
  const names = await auctionNames(ids, tips, stored?.names);
  // The daily report for the week's end day, when the cron has frozen one.
  const report = changes?.endDay && (await reportDates()).includes(changes.endDay) ? reportHref(changes.endDay) : null;

  const realms = stored ? stored.boards(null).map((b) => ({ slug: b.realm.slug, name: b.realm.name, count: b.items })) : [];
  const counts = stored ? houseCounts(stored.boards, now, slug) : undefined;
  const pickHref = (realm: string | null, h: AuctionHouse | null) => changesHref({ slug: realm ?? slug }, h);
  const item = (c: { row: Compared["row"] }) => <ItemLink id={c.row.value.itemId} href={itemHref(c.row.realm, c.row.value.itemId)} tip={tips.get(c.row.value.itemId)} names={names} />;
  const scope = board && shown ? `${realmName}, ${shown} auction house` : realmName;

  const compared = (noun: string, up: boolean): Column<Compared>[] => [
    { key: "item", header: "Item", cell: item },
    { key: "from", header: "From", numeric: true, cell: (c) => <CoinText text={formatCopper(c.move.from.market)} /> },
    { key: "to", header: "To", numeric: true, cell: (c) => <CoinText text={formatCopper(c.move.to.market)} /> },
    { key: "change", header: "Change", numeric: true, cell: (c) => <span className={up ? "text-accent" : "text-fg"}>{percent(c.move.change)}</span> },
    { key: "days", header: "Days compared", numeric: true, cell: (c) => `${c.move.from.day} → ${c.move.to.day}` },
    { key: "units", header: "Units listed", numeric: true, cell: units },
    { key: "reporters", header: "Reporters", numeric: true, cell: (c) => reporterCell(c.row.value.reporters) },
    { key: "state", header: "State", nowrap: true, cell: (c) => `${noun}${c.newestExcluded ? ` (newest day ${c.newestExcluded}, not used)` : ""}` },
  ];
  const comparedTable = (rows: Compared[], total: number, noun: string, up: boolean, caption: string) => (
    <DataTable
      dense
      caption={caption}
      columns={compared(noun, up)}
      rows={rows}
      rowKey={(c) => String(c.row.value.itemId)}
      meta={(c) => <>{formatCopper(c.move.from.market)} → {formatCopper(c.move.to.market)} · {percent(c.move.change)} · {units(c)} units · {c.move.from.day} → {c.move.to.day}</>}
      footer={<span>{rows.length < total ? `${rows.length} of ${count(total, noun === "rose" ? "riser" : "faller")}` : count(total, noun === "rose" ? "riser" : "faller")} · {scope}</span>}
      empty={<p className="px-3 py-4 text-cell text-fg-2">No item {noun} this week on a pair of solid days.</p>}
    />
  );
  const notComparedColumns: Column<NotCompared>[] = [
    { key: "item", header: "Item", cell: item },
    { key: "day", header: "Newest day", numeric: true, cell: (c) => c.row.value.day },
    { key: "value", header: "Value that day", numeric: true, cell: (c) => <CoinText text={formatCopper(c.row.points.at(-1)!.market)} /> },
    { key: "units", header: "Units listed", numeric: true, cell: units },
    { key: "reporters", header: "Reporters", numeric: true, cell: (c) => reporterCell(c.row.value.reporters) },
    { key: "state", header: "State", nowrap: true, cell: (c) => c.state },
  ];
  const statesPresent = changes ? NO_CHANGE_STATES.filter((s) => changes.counts[s] > 0) : [];

  const baselines = (c: WeeklyChanges) => (!c.baselineDays ? "" : c.baselineDays.earliest === c.baselineDays.latest ? ` (these rows use ${c.baselineDays.earliest})` : ` (these rows use ${c.baselineDays.earliest} to ${c.baselineDays.latest})`);
  const period = (c: WeeklyChanges) => (
    <p className="text-meta text-fg-2">
      End: <span className="text-fg">{c.endDay}</span>, each item&apos;s newest solid day (today or yesterday, UTC).
      Start: <span className="text-fg">{c.startDay}</span>, 7 days earlier; a baseline may fall up to 3 days before that{baselines(c)}.
      Each row names its own two days.{c.ownScans && " Some days are public under 3 reporters because Everloot's own installs scanned them; their reporter count says so."}
    </p>
  );

  let body;
  if (!stored) {
    body = <Card><p className="text-fg-2" role="status">The stored market boards are unavailable right now, so this week&apos;s changes are unrecorded, not zero. The page never rebuilds them from the rollup; try again after the next snapshot.</p></Card>;
  } else if (!board || !changes || !shown) {
    body = <EmptyState count={stored.agreement(slug, shown)} message={`No public prices in ${shown ? `the ${shown} auction house on ` : ""}${realmName} yet: a price shows once ${AGREEMENT_NEEDED} players scan the same item there.`} />;
  } else {
    body = (
      <div className="space-y-8">
        {period(changes)}
        <section aria-labelledby="mc-risers">
          <SectionHeading id="mc-risers">Risers</SectionHeading>
          {comparedTable(changes.risers, changes.risersTotal, "rose", true, `Risers this week, ${scope}`)}
        </section>
        <section aria-labelledby="mc-fallers">
          <SectionHeading id="mc-fallers">Fallers</SectionHeading>
          {comparedTable(changes.fallers, changes.fallersTotal, "fell", false, `Fallers this week, ${scope}`)}
        </section>
        <section aria-labelledby="mc-none">
          <SectionHeading id="mc-none" note={changes.unchanged ? `${count(changes.unchanged, "item")} had a baseline at the same value and ${changes.unchanged === 1 ? "is" : "are"} not listed.` : undefined}>No comparison yet</SectionHeading>
          <DataTable
            dense
            caption={`Items with no week comparison, ${scope}`}
            columns={notComparedColumns}
            rows={changes.notCompared}
            rowKey={(c) => String(c.row.value.itemId)}
            meta={(c) => <>{c.state} · {c.row.value.day} · {units(c)} units</>}
            footer={<span>{changes.notCompared.length < changes.notComparedTotal ? `${changes.notCompared.length} of ${count(changes.notComparedTotal, "item")}` : count(changes.notComparedTotal, "item")}: {statesPresent.map((s) => `${changes.counts[s]} ${s}`).join(", ") || "none"} · {scope}</span>}
            empty={<p className="px-3 py-4 text-cell text-fg-2">Every priced item here has a week comparison.</p>}
          />
          {statesPresent.length > 0 && (
            <dl className="mt-3 space-y-1 text-meta text-fg-2">
              {statesPresent.map((s) => <div key={s}><dt className="inline text-fg">{s}:</dt> <dd className="inline">{STATE_RULE[s]}.</dd></div>)}
            </dl>
          )}
        </section>
        <p className="text-meta text-fg-2">
          A move compares two solid days of the same item in this one house. Thin days ({THIN_UNITS} units listed or fewer) and days the market value trims as far from the historical value never drive a move; a row whose newest day is one of those says so and keeps its item page link, where every day is listed.
          Units listed are offered inventory on the scan day, not sales: a change in listings does not establish a sale, and nothing here claims manipulation or a profit.
        </p>
      </div>
    );
  }

  return (
    <Container width="data">
      <article>
        <DataTitle
          title={<>Market changes: <RealmName name={realmName} /></>}
          trail={trail}
          meta={market.state && (
            <Facts items={[
              shown ? `${shown} auction house` : "No house priced yet",
              board && board.updatedAt !== null ? <>Scans up to <TimeAgo at={board.updatedAt} renderedAt={now.getTime()} /></> : "Scan time unrecorded",
              ...(board ? [`${count(board.reporters, "reporter")} this week`] : []),
            ]} />
          )}
        />
        <p className="mb-3 flex flex-wrap gap-x-4 text-sm">
          <Link href={shown ? `${realmHref({ slug })}?house=${houseSlug(shown)}` : realmHref({ slug })} className={link}>Browse prices on {realmName}</Link>
          {report && changes?.endDay && <Link href={report} className={link}>Daily report for {changes.endDay}</Link>}
        </p>
        {stored && (
          <RealmHousePicker realms={realms} realm={slug} house={shown} href={pickHref} counts={counts} remember="save" />
        )}
        <div className="mt-4">{body}</div>
        <div className="mt-8 space-y-4">
          <Contribute />
          <div>
            <Disclosure summary="How are market values made?">
              <p>{MARKET_RULE}</p>
            </Disclosure>
            <Disclosure summary="How is a week move made?">
              <p>The newest solid day of an item (today or yesterday) against its solid day 7 days before, or up to 3 days earlier than that when the house was not scanned on the day. Solid means not thin and not trimmed by the market value. Items with no such pair are listed under No comparison yet with the reason; nothing fills a missing baseline in.</p>
            </Disclosure>
          </div>
        </div>
      </article>
    </Container>
  );
}
