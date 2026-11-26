import type { Metadata } from "next";
import { toyEntries } from "@/lib/collectibles";
import { shownItemName } from "@/lib/items";
import { loadShownNames } from "@/lib/shown-item-names";
import { CollectibleList, collectibleListMetadata, type CollectibleRow } from "../collectible-list";
import type { Search } from "../list-parts";

const META = { title: "WoW Forever Toy List", description: "Toys in WoW: Forever, each linked to its item page. From the game files.", path: "/database/toys" };
export const dynamic = "force-dynamic";

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  return collectibleListMetadata(META, (await props.searchParams) ?? {});
}

/** A toy is an item: its row is named by the item name rule, as the item page names it, and links that page. */
export default async function ToyListPage(props: { searchParams?: Promise<Search> }) {
  const toys = toyEntries();
  const shown = toys ? await loadShownNames() : null;
  const rows: (CollectibleRow & { itemId: number })[] | null = toys?.map((t) => ({
    id: t.id, itemId: t.itemId, href: `/database/items/${t.itemId}`,
    name: (shown && shownItemName(t.itemId, shown.agreed, shown.matched?.names)?.name) ?? `Item ${t.itemId}`,
  })) ?? null;
  return (
    <CollectibleList
      path={META.path} title="Toys" noun={["toy", "toys"]} rows={rows} search={(await props.searchParams) ?? {}}
      note="Every toy the game files list. A toy is an item, so each links its item page and is named as that page names it."
      columns={[{ key: "item", header: "Item", numeric: true, cell: (r) => <span className="font-mono text-cell-2 text-muted">{r.itemId}</span> }]}
    />
  );
}
