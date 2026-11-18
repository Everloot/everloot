import type { AuctionHouse } from "@everloot/protocol";
import type { ReactNode } from "react";
import { CoinText } from "@/components/ui/Coins";
import { DataTable, EmptyState, SectionHeading, type Column } from "@/components/ui";
import { itemHref } from "@/lib/auction-house";
import { STALE_DAYS } from "@/lib/chat/market-question";
import type { StoredVendorHouse, StoredVendorRow } from "@/lib/vendor-these-store";
import { auctionCut } from "../../../../../kb/src/disenchant";
import { THIN_UNITS, formatCopper } from "../../../../../kb/src/market";
import { ItemLink } from "./parts";
import TimeAgo from "./TimeAgo";

const coins = (copper: number) => <CoinText text={formatCopper(copper)} />;

/** What the page found for the house: its stored list, none built yet, or a store that could not be read. */
export type VendorList =
  | { state: "stored"; list: StoredVendorHouse; dataAsOf: string | null }
  | { state: "missing" }
  | { state: "unavailable" };

function Section({ note, children }: { note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby="vendor-these" data-vendor-these>
      <SectionHeading id="vendor-these" note={note}>Vendor these</SectionHeading>
      {children}
    </section>
  );
}

/**
 * "Vendor these" on a realm's house: the items a vendor pays more for than this house after its cut, as the addon's
 * Sell tab warns. The snapshot cron works the list out (lib/vendor-these-store.ts); this shows the stored copy, how old
 * it is, and says so when it is not built yet, cannot be read, or left items out.
 */
export function VendorThese({ found, house, realm, now }: {
  found: VendorList;
  house: AuctionHouse;
  realm: { slug: string; name: string };
  now: Date;
}) {
  if (found.state === "missing") {
    return <Section><p data-vendor-missing className="text-sm text-fg-2">{"This list isn't built yet. It's worked out when the market updates; check back soon."}</p></Section>;
  }
  const list = found.state === "stored" ? found.list : null;
  if (!list || (list.candidates > 0 && list.unread >= list.candidates)) {
    return <Section><p data-vendor-unavailable className="text-sm text-fg-2">{"Vendor prices are unavailable right now, so this list can't be shown. Try again later."}</p></Section>;
  }
  const where = `the ${house} auction house on ${realm.name}`;
  const cut = `${Math.round(auctionCut(house) * 100)}%`;
  const names = new Map(list.rows.flatMap((v) => (v.name ? [[v.itemId, v.name] as const] : [])));
  const at = found.state === "stored" && found.dataAsOf ? Date.parse(found.dataAsOf) : NaN;
  const columns: Column<StoredVendorRow>[] = [
    { key: "item", header: "Item", cell: (v) => <ItemLink id={v.itemId} href={itemHref(realm, v.itemId)} tip={undefined} names={names} /> },
    { key: "vendor", header: "Vendor pays", numeric: true, cell: (v) => coins(v.vendor) },
    { key: "market", header: "Market value", numeric: true, cell: (v) => coins(v.market) },
    { key: "cut", header: "After cut", numeric: true, cell: (v) => coins(v.afterCut) },
    { key: "more", header: "Vendor pays more", numeric: true, cell: (v) => coins(v.more) },
    { key: "units", header: "Units", numeric: true, cell: (v) => v.quantity.toLocaleString("en-US") },
    { key: "day", header: "Market day", numeric: true, nowrap: true, cell: (v) => v.day },
  ];
  return (
    <Section
      note={`Items a vendor pays more for than ${where} after its ${cut} cut, so posting them loses money. Per unit, the biggest difference first${list.total > list.rows.length ? `; the first ${list.rows.length} of ${list.total.toLocaleString("en-US")}` : ""}.`}
    >
      <DataTable
        dense
        caption={`Items a vendor pays more for than ${where}`}
        columns={columns}
        rows={list.rows}
        rowKey={(v) => String(v.itemId)}
        meta={(v) => <>
          <span className="block">{"Vendor "}{coins(v.vendor)}{" · after cut "}{coins(v.afterCut)}</span>
          <span className="block text-fg">{"Vendor pays "}{coins(v.more)}{" more"}</span>
        </>}
        empty={<EmptyState framed={false} message={list.unread > 0
          ? "No item whose vendor price could be read sells for less than a vendor pays here, after the cut."
          : "No item with a current market here sells for less than a vendor pays, after the cut."} />}
      />
      {list.unread > 0 && (
        <p data-vendor-incomplete className="mt-2 text-meta text-fg-2">
          {`Incomplete: ${list.unread.toLocaleString("en-US")} of ${list.candidates.toLocaleString("en-US")} items with a current market here had no vendor price available when this was built and ${list.unread === 1 ? "is" : "are"} left out.`}
        </p>
      )}
      <p data-vendor-age className="mt-2 text-meta text-fg-2">
        {"Built from the market as of "}
        {Number.isFinite(at) ? <TimeAgo at={at} renderedAt={now.getTime()} /> : "an unrecorded time"}
        {`. Vendor prices: the sell prices in the game files, unconfirmed. Only a current market counts: a market value whose newest day lists more than ${THIN_UNITS} units and is at most ${STALE_DAYS} days old.`}
      </p>
    </Section>
  );
}
