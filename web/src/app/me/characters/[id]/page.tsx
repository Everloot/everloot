import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import BuildsTable from "@/components/builds/BuildsTable";
import CharacterForm from "@/components/builds/CharacterForm";
import { className, describeBuilds } from "@/components/builds/describe";
import { publishedClassChanges } from "@/lib/talents/freshness-records";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Container, DataTitle, EmptyState } from "@/components/ui";
import { signInPath } from "@/lib/auth/return-to";
import { savedBuildsOn, validId, type AccountBuilds } from "@/lib/saved-builds";
import { listOwn } from "@/lib/saved-builds-store";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Character", robots: { index: false, follow: false } };

type Params = { params: Promise<{ id: string }> };

/** One character label: its builds, which one is active, and the label itself to edit. Only its owner sees it. */
export default async function CharacterPage({ params }: Params) {
  if (!savedBuildsOn()) notFound();
  const { id } = await params;
  if (!validId(id)) notFound();
  let data: AccountBuilds | null;
  try {
    const user = await getUser();
    data = user && await listOwn(user.id);
  } catch {
    return (
      <Container>
        <DataTitle title="Character" />
        <p role="alert" className="text-fg-2">Your builds are unavailable right now. Try again in a minute.</p>
      </Container>
    );
  }
  if (!data) redirect(signInPath(`/me/characters/${id}`));
  const character = data.characters.find((c) => c.id === id);
  if (!character) notFound();
  const builds = data.builds.filter((b) => b.characterId === id);
  const facts = await describeBuilds(builds, publishedClassChanges);

  return (
    <Container>
      <DataTitle
        title={<span className={CLASS_TEXT[character.classSlug] ?? "text-fg"}>{character.name}</span>}
        meta={[className(character.classSlug), character.realm, character.note].filter(Boolean).join(" · ")}
        aside={<Link href="/me" className="text-meta text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">All my builds</Link>}
      />
      {builds.length === 0 ? (
        <EmptyState
          message={`No builds for ${character.name} yet. Save one from the ${className(character.classSlug)} calculator and pick this character.`}
          action={{ href: `/tools/talents/${character.classSlug}`, label: "Open the calculator" }}
        />
      ) : (
        <BuildsTable builds={builds} facts={facts} caption={`Saved builds for ${character.name}`} onCharacterPage />
      )}
      <section aria-labelledby="edit-character" className="mt-6 space-y-2">
        <h2 id="edit-character" className="text-cell font-semibold text-fg">Edit character</h2>
        <CharacterForm character={character} classLocked={builds.length > 0} />
      </section>
    </Container>
  );
}
