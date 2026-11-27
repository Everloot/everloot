import type { Metadata } from "next";
import EntityLink from "@/components/EntityLink";
import { CLIENT_LAYER } from "@kb/client-layer-file";
import { loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
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
  const [assets, spellNames] = await Promise.all([loadSiteAssets(), loadSpellNames(CLIENT_LAYER.build.version)]);
  const rows: (CollectibleRow & ClientPet)[] | null = petEntries()?.map((p) => ({ ...p, href: petHref(p.id, p.name), icon: assets?.petIcons.get(p.id) })) ?? null;
  return (
    <CollectibleList
      path={META.path} title="Companion pets" noun={["companion pet", "companion pets"]} rows={rows} search={(await props.searchParams) ?? {}}
      note="Every companion pet species the game files list, named by its creature. No player report confirms a pet yet."
      // The spell by the name its page shows (the files' name, under the name rule), as the pet page links it; else "Spell N".
      columns={[{ key: "spell", header: "Summon spell", cell: (r) => <EntityLink prefetch={false} kind="spell" id={r.spellId} name={spellNames?.names.get(r.spellId)} /> }]}
    />
  );
}
