import Coins from "@/components/ui/Coins";
import EntityLink from "@/components/EntityLink";
import ItemTip from "@/components/game/ItemTip";
import { DataTable } from "@/components/ui";
import { qualityNamed } from "@/components/ui/quality";
import { stockLabel, type VendorOffer } from "@kb/world-pages";
import type { ComponentProps, ReactNode } from "react";

/**
 * One row per item. An item 3 installs agree on at two or more prices is shown at the highest, the one a player with
 * no discount pays, and the lower ones ride along as what players also saw: the data says only that both were seen,
 * so the note calls the discount likely, never which reputation gave it.
 */
export type GoodsRow = VendorOffer & { otherPrices: number[] };
export function goodsRows(offers: readonly VendorOffer[]): GoodsRow[] {
  const byItem = new Map<number, VendorOffer[]>();
  for (const o of offers) byItem.set(o.itemId, [...(byItem.get(o.itemId) ?? []), o]);
  return [...byItem.values()].map((list) => {
    const base = list.reduce((a, b) => (b.priceCopper > a.priceCopper ? b : a));
    return { ...base, otherPrices: list.filter((o) => o !== base).map((o) => o.priceCopper).sort((a, b) => b - a) };
  });
}

const otherPrices = (o: GoodsRow): ReactNode => o.otherPrices.length > 0 && (
  <span data-other-prices className="block text-meta text-muted">
    {"players also saw "}
    {o.otherPrices.map((c, i) => <span key={c}>{i > 0 && ", "}<Coins copper={c} game /></span>)}
    {" (likely a reputation discount)"}
  </span>
);

const stock = (o: VendorOffer): ReactNode => o.limitedStock !== null ? <>stock <span className="font-mono tabular-nums">{o.limitedStock}</span></> : stockLabel(o);

export function VendorGoods({ title, offers, tips, items, evidence }: {
  title: string; offers: VendorOffer[];
  tips: Map<number, NonNullable<ComponentProps<typeof ItemTip>["tip"]>>; items: Map<number, string>;
  evidence?: (offer: VendorOffer) => ReactNode;
}) {
  const rows = goodsRows(offers);
  return (
    <DataTable
      dense
      caption={`What ${title} sells`}
      columns={[
        { key: "item", header: "Item", cell: (o: GoodsRow) => <ItemTip tip={tips.get(o.itemId)}><EntityLink kind="item" id={o.itemId} name={items.get(o.itemId) ?? tips.get(o.itemId)?.name} quality={qualityNamed(tips.get(o.itemId)?.quality)} /></ItemTip> },
        // As the vendor window prints a price: a zero coin is left out ("1s", not "1s 0c").
        { key: "price", header: "Price", numeric: true, cell: (o: GoodsRow) => <><Coins copper={o.priceCopper} game />{otherPrices(o)}</> },
        // Words in the text face; only a stock count is a figure.
        { key: "stock", header: "Stock", nowrap: true, cell: (o: GoodsRow) => stock(o) },
        ...(evidence ? [{ key: "reported", header: "Reported", cell: evidence }] : [
          { key: "installs", header: "Installs", numeric: true, cell: (o: GoodsRow) => o.reporters },
        ]),
      ]}
      // On a phone the item carries the row: price, stock and the evidence fold into its second line, so the evidence
      // column never squeezes to one word a line.
      meta={(o) => <>{<Coins copper={o.priceCopper} game />} · {stock(o)} · {evidence ? evidence(o) : `${o.reporters} installs`}{otherPrices(o)}</>}
      rows={rows}
      rowKey={(o) => `${o.itemId}-${o.priceCopper}`}
    />
  );
}
