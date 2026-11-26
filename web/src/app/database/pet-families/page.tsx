import type { Metadata } from "next";
import Link from "next/link";
import GameIcon from "@/components/game/GameIcon";
import { Container, DataTable, DataTitle } from "@/components/ui";
import { loadSiteAssets } from "@/lib/game-assets";
import { pageMetadata } from "@/lib/seo";
import { petFamilyEntries, petFamilyHref } from "@/lib/world-events";
import { CLIENT_LABEL } from "@kb/edges";
import { LINK } from "../entity";
import { Unreadable } from "../list-parts";

export const metadata: Metadata = pageMetadata({
  title: "WoW Forever Hunter Pet Families",
  description: "The hunter pet families in WoW: Forever, each with the abilities on its own skill line. From the game files.",
  path: "/database/pet-families",
});
export const dynamic = "force-dynamic";

/** Every hunter pet family the game files list, with its icon where the manifest has one. */
export default async function PetFamilyListPage() {
  const rows = petFamilyEntries();
  const assets = rows?.length ? await loadSiteAssets() : null;
  return (
    <Container width="data">
      <article>
        <DataTitle title="Hunter pet families" />
        <p data-list-note className="mb-2 text-meta text-muted">Every family a hunter can tame, as the game files list it: the families that eat. A warlock&apos;s demons are left out. {CLIENT_LABEL}.</p>
        <DataTable
          dense
          caption={`Hunter pet families in the game files: ${rows?.length ?? 0}`}
          columns={[
            {
              key: "name", header: "Name", cell: (f) => {
                const icon = assets?.familyIcons.get(f.id);
                return (
                  <span className="inline-flex items-center gap-2">
                    {icon && <GameIcon src={icon} size={20} />}
                    <Link prefetch={false} href={petFamilyHref(f.id, f.name)} className={LINK}>{f.name}</Link>
                  </span>
                );
              },
            },
            { key: "abilities", header: "Spells on its skill line", numeric: true, cell: (f) => f.spellIds.length },
            { key: "id", header: "ID", numeric: true, cell: (f) => f.id },
          ]}
          rows={rows ?? []}
          rowKey={(f) => String(f.id)}
          meta={(f) => `ID ${f.id}`}
          empty={rows === null ? <Unreadable>The game files could not be read just now, so this list is unrecorded.</Unreadable> : <p className="py-4 text-cell text-fg-2">No pet family is in the game files read so far.</p>}
        />
      </article>
    </Container>
  );
}
