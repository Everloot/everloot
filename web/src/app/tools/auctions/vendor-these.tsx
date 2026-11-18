import type { AuctionHouse } from "@everloot/protocol";
import { CoinText } from "@/components/ui/Coins";
import { DataTable, EmptyState, SectionHeading, type Column } from "@/components/ui";
import type { ItemNames } from "@/lib/auction-house";
import { STALE_DAYS } from "@/lib/chat/market-question";
import { VENDOR_SHOWN, type VendorRow } from "@/lib/vendor-these";
import { auctionCut } from "../../../../../kb/src/disenchant";
import { THIN_UNITS, formatCopper } from "../../../../../kb/src/market";
import type { ItemTip } from "./art";
import { ItemLink } from "./parts";

const coins = (copper: number) => <CoinText text={formatCopper(copper)} />;

/**
 * "Vendor these" on a realm's house: the items a vendor pays more for than this house after its cut, as the addon's
 * Sell tab warns. `rows` come from lib/vendor-these.ts, sorted; the list shows the first VENDOR_SHOWN.
 */
export function VendorThese({ rows, house, realmName, tips, names }: { rows: VendorRow[]; house: AuctionHouse; realmName: string; tips: ReadonlyMap<number, ItemTip>; names: ItemNames }) {
  const where = `the ${house} auction house on ${realmName}`;
  const cut = `${Math.round(auctionCut(house) * 100)}%`;
  const shown = rows.slice(0, VENDOR_SHOWN);
  const columns: Column<VendorRow>[] = [
    { key: "item", header: "Item", cell: (v) => <ItemLink id={v.itemId} href={`/database/items/${v.itemId}`} tip={tips.get(v.itemId)} names={names} /> },
    { key: "vendor", header: "Vendor pays", numeric: true, cell: (v) => coins(v.vendor) },
    { key: "market", header: "Market value", numeric: true, cell: (v) => coins(v.market) },
    { key: "cut", header: "After cut", numeric: true, cell: (v) => coins(v.afterCut) },
    { key: "more", header: "Vendor pays more", numeric: true, cell: (v) => coins(v.more) },
    { key: "units", header: "Units", numeric: true, cell: (v) => v.row.value.quantity.toLocaleString("en-US") },
    { key: "day", header: "Market day", numeric: true, nowrap: true, cell: (v) => v.row.value.day },
  ];
  return (
    <section aria-labelledby="vendor-these" data-vendor-these>
      <SectionHeading
        id="vendor-these"
        note={`Items a vendor pays more for than ${where} after its ${cut} cut, so posting them loses money. Per unit, the biggest difference first${rows.length > VENDOR_SHOWN ? `; the first ${VENDOR_SHOWN} of ${rows.length.toLocaleString("en-US")}` : ""}.`}
      >
        Vendor these
      </SectionHeading>
      <DataTable
        dense
        caption={`Items a vendor pays more for than ${where}`}
        columns={columns}
        rows={shown}
        rowKey={(v) => String(v.itemId)}
        meta={(v) => <>
          <span className="block">{"Vendor "}{coins(v.vendor)}{" · after cut "}{coins(v.afterCut)}</span>
          <span className="block text-fg">{"Vendor pays "}{coins(v.more)}{" more"}</span>
        </>}
        empty={<EmptyState framed={false} message="No item with a current market here sells for less than a vendor pays, after the cut." />}
      />
      <p className="mt-2 text-meta text-fg-2">{`Vendor prices: the sell prices in the game files, unconfirmed. Only a current market counts: a market value whose newest day lists more than ${THIN_UNITS} units and is at most ${STALE_DAYS} days old.`}</p>
    </section>
  );
}
