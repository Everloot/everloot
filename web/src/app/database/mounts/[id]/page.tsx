import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { loadAgreedMounts, mountEntries, mountHref, mountsBuild } from "@/lib/collectibles";
import { parseSegment } from "@/lib/completion-lists";
import { loadSiteAssets } from "@/lib/game-assets";
import { CollectiblePage, collectibleMetadata, FILES_NAME } from "../../collectible-page";
import { LINK } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const entryOf = (segment: string) => {
  const id = parseSegment(segment);
  return id === null ? undefined : mountEntries()?.find((m) => m.id === id);
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const mount = entryOf((await props.params).id);
  if (!mount) return { robots: { index: false, follow: true } };
  const confirmed = (await loadAgreedMounts())?.has(mount.spellId) ?? false;
  return collectibleMetadata({
    name: mount.name, kind: "mount", path: mountHref(mount.id, mount.name), confirmed,
    about: `The ${mount.name} mount in WoW: Forever${mount.ridingSkill ? `, riding skill ${mount.ridingSkill}` : ""}${confirmed ? ", as three installs reported it." : "."}`,
  });
}

export default async function MountPage(props: Props) {
  const { id: segment } = await props.params;
  const mount = entryOf(segment);
  if (!mount) notFound();
  const path = mountHref(mount.id, mount.name);
  if (`/database/mounts/${segment}` !== path) permanentRedirect(path);
  const [agreed, assets] = await Promise.all([loadAgreedMounts(), loadSiteAssets()]);
  const confirmed = agreed?.has(mount.spellId) ?? false;
  const summary = [
    "A mount in WoW: Forever.",
    agreed === null ? "Player reports could not be read just now." : confirmed ? "Players reported it in their mount collection, three installs agreeing." : "No player has reported it in a mount collection yet.",
    `The game files list it, taught by spell ${mount.spellId}${mount.ridingSkill ? `, its type asking for riding skill ${mount.ridingSkill}` : ""}.`,
    confirmed ? "The name is the game files' own; players report the mount by its spell." : FILES_NAME,
  ];
  return (
    <CollectiblePage
      list="/database/mounts" path={path} name={mount.name} kind="Mount" id={mount.id}
      icon={assets?.spellIcons.get(mount.spellId)} confirmed={confirmed}
      box={mount.ridingSkill ? <p>Requires Riding ({mount.ridingSkill})</p> : null}
      facts={[
        { label: "Player reports", value: agreed === null ? "Unrecorded" : confirmed ? "3 of 3 installs agree" : "None yet" },
        { label: "Taught by", value: <Link href={`/database/spells/${mount.spellId}`} className={LINK}>Spell {mount.spellId}</Link> },
        { label: "Riding skill", value: mount.ridingSkill ?? "None in the files", numeric: Boolean(mount.ridingSkill) },
        { label: "Track this", value: <Link href="/tools/collections?view=mounts" className={LINK}>Collections tool</Link> },
        { label: "Build", value: mountsBuild() ?? "Unrecorded", numeric: true },
      ]}
      summary={summary}
    />
  );
}
