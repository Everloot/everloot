import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { collectionsBuild, petEntries, petHref } from "@/lib/collectibles";
import { parseSegment } from "@/lib/completion-lists";
import { loadSiteAssets } from "@/lib/game-assets";
import { CollectiblePage, collectibleMetadata, FILES_NAME } from "../../collectible-page";
import { LINK } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const entryOf = (segment: string) => {
  const id = parseSegment(segment);
  return id === null ? undefined : petEntries()?.find((p) => p.id === id);
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const pet = entryOf((await props.params).id);
  if (!pet) return { robots: { index: false, follow: true } };
  return collectibleMetadata({ name: pet.name, kind: "companion pet", path: petHref(pet.id, pet.name), about: `The ${pet.name} companion pet in WoW: Forever, summoned by spell ${pet.spellId}.` });
}

export default async function PetPage(props: Props) {
  const { id: segment } = await props.params;
  const pet = entryOf(segment);
  if (!pet) notFound();
  const path = petHref(pet.id, pet.name);
  if (`/database/pets/${segment}` !== path) permanentRedirect(path);
  const assets = await loadSiteAssets();
  const summary = [
    "A companion pet in WoW: Forever.",
    "No player report confirms companion pets yet.",
    `The game files list it as pet species ${pet.id}, named by its creature (${pet.creatureId}) and summoned by spell ${pet.spellId}.`,
    FILES_NAME,
  ];
  return (
    <CollectiblePage
      list="/database/pets" path={path} name={pet.name} kind="Companion pet" id={pet.id}
      icon={assets?.petIcons.get(pet.id)}
      facts={[
        { label: "Summoned by", value: <Link href={`/database/spells/${pet.spellId}`} className={LINK}>Spell {pet.spellId}</Link> },
        { label: "Creature", value: pet.creatureId, numeric: true },
        { label: "Build", value: collectionsBuild() ?? "Unrecorded", numeric: true },
      ]}
      summary={summary}
    />
  );
}
