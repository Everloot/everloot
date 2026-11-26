import type { Metadata } from "next";
import { loadSiteAssets } from "@/lib/game-assets";
import { currencyEntries, currencyHref } from "@/lib/collectibles";
import type { ClientCurrency } from "@kb/client-collections";
import { CollectibleList, collectibleListMetadata, type CollectibleRow } from "../collectible-list";
import type { Search } from "../list-parts";

const META = { title: "WoW Forever Currency List", description: "Currencies in WoW: Forever by name and ID, with their category and cap. From the game files.", path: "/database/currencies" };
export const dynamic = "force-dynamic";

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  return collectibleListMetadata(META, (await props.searchParams) ?? {});
}

export default async function CurrencyListPage(props: { searchParams?: Promise<Search> }) {
  const assets = await loadSiteAssets();
  const rows: (CollectibleRow & ClientCurrency)[] | null = currencyEntries()?.map((c) => ({ ...c, href: currencyHref(c.id, c.name), icon: assets?.currencyIcons.get(c.id) })) ?? null;
  return (
    <CollectibleList
      path={META.path} title="Currencies" noun={["currency", "currencies"]} rows={rows} search={(await props.searchParams) ?? {}}
      note="Every currency the game files list for players; the game's own hidden counters are left out."
      columns={[
        { key: "category", header: "Category", sortBy: (r) => r.category.toLowerCase(), cell: (r) => r.category },
        { key: "max", header: "Cap", numeric: true, sortBy: (r) => r.max ?? null, cell: (r) => r.max?.toLocaleString("en-US") ?? <span className="text-muted">—</span> },
      ]}
    />
  );
}
