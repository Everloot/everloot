import EntityLink from "@/components/EntityLink";
import ItemTip from "@/components/game/ItemTip";
import { DataTable } from "@/components/ui";
import { stockLabel, type VendorOffer } from "../../../../../kb/src/world-pages";
import type { ComponentProps, ReactNode } from "react";

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
        { key: "item", header: "Item", cell: (o: VendorOffer) => <ItemTip tip={tips.get(o.itemId)}><EntityLink kind="item" id={o.itemId} name={items.get(o.itemId) ?? tips.get(o.itemId)?.name} /></ItemTip> },
        { key: "price", header: "Price", numeric: true, cell: (o: VendorOffer) => formatCopper(o.priceCopper) },
        { key: "stock", header: "Stock", numeric: true, cell: (o: VendorOffer) => stockLabel(o) },
        ...(evidence ? [{ key: "reported", header: "Reported", cell: evidence }] : [
          { key: "installs", header: "Installs", numeric: true, cell: (o: VendorOffer) => o.reporters },
        ]),
      ]}
      rows={offers}
      rowKey={(o) => `${o.itemId}-${o.priceCopper}`}
    />
  );
}
