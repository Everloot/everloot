import type { Metadata } from "next";
import { petEntries, petHref } from "@/lib/collectibles";
import type { ClientPet } from "@kb/client-collections";
import { CollectibleList, collectibleListMetadata, type CollectibleRow } from "../collectible-list";
import type { Search } from "../list-parts";

const META = { title: "WoW Forever Companion Pet List", description: "Companion pets in WoW: Forever by name and ID, with the spell that summons each. From the game files.", path: "/database/pets" };
export const dynamic = "force-dynamic";

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  return collectibleListMetadata(META, (await props.searchParams) ?? {});
}

export default async function PetListPage(props: { searchParams?: Promise<Search> }) {
  const rows: (CollectibleRow & ClientPet)[] | null = petEntries()?.map((p) => ({ ...p, href: petHref(p.id, p.name) })) ?? null;
  return (
    <CollectibleList
      path={META.path} title="Companion pets" noun={["companion pet", "companion pets"]} rows={rows} search={(await props.searchParams) ?? {}}
      note="Every companion pet species the game files list, named by its creature. No player report confirms a pet yet."
      columns={[{ key: "spell", header: "Summon spell", numeric: true, cell: (r) => <span className="font-mono text-cell-2 text-muted">{r.spellId}</span> }]}
    />
  );
}
