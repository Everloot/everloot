import type { Metadata } from "next";
import { loadSiteAssets } from "@/lib/game-assets";
import { mountEntries, mountHref, loadAgreedMounts, type MountEntry } from "@/lib/collectibles";
import { CollectibleList, collectibleListMetadata, type CollectibleRow } from "../collectible-list";
import { ConfirmedCell, type Search } from "../list-parts";

const META = { title: "WoW Forever Mount List", description: "Mounts in WoW: Forever by name and ID, with the riding skill each asks for. From the game files; confirmed once three installs report each in their mount collection.", path: "/database/mounts" };
export const dynamic = "force-dynamic";

type Row = CollectibleRow & MountEntry & { confirmed: boolean };

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  return collectibleListMetadata(META, (await props.searchParams) ?? {});
}

export default async function MountListPage(props: { searchParams?: Promise<Search> }) {
  const [agreed, assets] = await Promise.all([loadAgreedMounts(), loadSiteAssets()]);
  // A mount's icon is the icon of the spell that teaches it, as on its page.
  const rows: Row[] | null = mountEntries()?.map((m) => ({ ...m, href: mountHref(m.id, m.name), icon: assets?.spellIcons.get(m.spellId), confirmed: agreed?.has(m.spellId) ?? false })) ?? null;
  return (
    <CollectibleList
      path={META.path} title="Mounts" noun={["mount", "mounts"]} rows={rows} search={(await props.searchParams) ?? {}}
      note="Every mount the game files list, with the lowest riding skill its type asks for. A mount is confirmed once 3 installs list it in their mount collection."
      columns={[
        { key: "riding", header: "Riding skill", numeric: true, sortBy: (r) => r.ridingSkill ?? null, cell: (r) => r.ridingSkill ?? <span className="text-muted">—</span> },
        { key: "confirmed", header: "Confirmed", cell: (r) => <ConfirmedCell entry={r} confirmations={agreed !== null} /> },
      ]}
    />
  );
}
