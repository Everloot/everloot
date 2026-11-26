import Coins from "@/components/ui/Coins";
import EntityLink from "@/components/EntityLink";
import ItemTip from "@/components/game/ItemTip";
import { DataTable } from "@/components/ui";
import { qualityNamed } from "@/components/ui/quality";
import { stockLabel, type VendorOffer } from "@kb/world-pages";
import type { ComponentProps, ReactNode } from "react";

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
        { key: "price", header: "Price", numeric: true, cell: (o: VendorOffer) => <Coins copper={o.priceCopper} /> },
        // Words in the text face; only a stock count is a figure.
        { key: "stock", header: "Stock", nowrap: true, cell: (o: VendorOffer) => o.limitedStock !== null ? <>stock <span className="font-mono tabular-nums">{o.limitedStock}</span></> : stockLabel(o) },
        ...(evidence ? [{ key: "reported", header: "Reported", cell: evidence }] : [
          { key: "installs", header: "Installs", numeric: true, cell: (o: VendorOffer) => o.reporters },
        ]),
      ]}
      rows={offers}
      rowKey={(o) => `${o.itemId}-${o.priceCopper}`}
    />
  );
}
