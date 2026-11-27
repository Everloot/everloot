import Coins from "@/components/ui/Coins";
import EntityLink from "@/components/EntityLink";
import ItemTip from "@/components/game/ItemTip";
import { DataTable } from "@/components/ui";
import { qualityNamed } from "@/components/ui/quality";
import { stockLabel, type VendorOffer } from "@kb/world-pages";
import type { ComponentProps, ReactNode } from "react";

const stock = (o: VendorOffer): ReactNode => o.limitedStock !== null ? <>stock <span className="font-mono tabular-nums">{o.limitedStock}</span></> : stockLabel(o);

export function VendorGoods({ title, offers, tips, items, evidence }: {
  title: string; offers: VendorOffer[];
  tips: Map<number, NonNullable<ComponentProps<typeof ItemTip>["tip"]>>; items: Map<number, string>;
  evidence?: (offer: VendorOffer) => ReactNode;
}) {
  return (
    <DataTable
      dense
      caption={`What ${title} sells`}
      columns={[
        { key: "item", header: "Item", cell: (o: VendorOffer) => <ItemTip tip={tips.get(o.itemId)}><EntityLink kind="item" id={o.itemId} name={items.get(o.itemId) ?? tips.get(o.itemId)?.name} quality={qualityNamed(tips.get(o.itemId)?.quality)} /></ItemTip> },
        // As the vendor window prints a price: a zero coin is left out ("1s", not "1s 0c").
        { key: "price", header: "Price", numeric: true, cell: (o: VendorOffer) => <Coins copper={o.priceCopper} game /> },
        // Words in the text face; only a stock count is a figure.
        { key: "stock", header: "Stock", nowrap: true, cell: stock },
        ...(evidence ? [{ key: "reported", header: "Reported", cell: evidence }] : [
          { key: "installs", header: "Installs", numeric: true, cell: (o: VendorOffer) => o.reporters },
        ]),
      ]}
      // On a phone the item carries the row: price, stock and the evidence fold into its second line, so the evidence
      // column never squeezes to one word a line.
      meta={(o) => <>{<Coins copper={o.priceCopper} game />} · {stock(o)} · {evidence ? evidence(o) : `${o.reporters} installs`}</>}
      rows={offers}
      rowKey={(o) => `${o.itemId}-${o.priceCopper}`}
    />
  );
}
