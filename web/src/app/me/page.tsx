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
import { savedBuildsOn, type AccountBuilds } from "@/lib/saved-builds";
import { listOwn } from "@/lib/saved-builds-store";
import { pageMetadata } from "@/lib/seo";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({ title: "My builds", description: "Your saved talent builds and characters.", path: "/me" }),
  robots: { index: false, follow: false },
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The player's saved builds: one card per character, then the builds filed under none. */
export default async function MyBuildsPage() {
  if (!savedBuildsOn()) notFound();
  let data: AccountBuilds | null;
  try {
    const user = await getUser();
    data = user && await listOwn(user.id);
  } catch {
    return (
      <Container>
        <DataTitle title="My builds" />
        <p role="alert" className="text-fg-2">Your builds are unavailable right now. Try again in a minute.</p>
      </Container>
    );
  }
  if (!data) redirect(signInPath("/me"));
  const { characters, builds } = data;
  const loose = builds.filter((b) => !b.characterId || !characters.some((c) => c.id === b.characterId));
  const facts = await describeBuilds(loose, publishedClassChanges);

  return (
    <Container>
      <DataTitle
        title="My builds"
        meta={`${plural(builds.length, "build", "builds")} · ${plural(characters.length, "character", "characters")}`}
        aside={<Link href="/tools/talents" className="text-meta text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Open the talent calculator</Link>}
      />

      {builds.length === 0 && characters.length === 0 ? (
        <EmptyState message="No saved builds yet. Make one in the talent calculator and press Save." action={{ href: "/tools/talents", label: "Open the calculator" }} />
      ) : (
        <div className="space-y-6">
          {characters.length > 0 && (
            <section aria-label="Characters">
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {characters.map((c) => {
                  const own = builds.filter((b) => b.characterId === c.id);
                  const active = own.find((b) => b.active);
                  return (
                    <li key={c.id}>
                      <Link href={`/me/characters/${c.id}`} className="block rounded-control border border-line bg-panel px-3 py-2 hover:border-edge">
                        <span className={`block font-semibold ${CLASS_TEXT[c.classSlug] ?? "text-fg"}`}>{c.name}</span>
                        <span className="block text-meta text-muted">
                          {[className(c.classSlug), c.realm, plural(own.length, "build", "builds")].filter(Boolean).join(" · ")}
                        </span>
                        {active && <span className="block truncate text-meta text-fg-2">Active: {active.name}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {loose.length > 0 && (
            <section aria-labelledby="loose-builds" className="space-y-2">
              <h2 id="loose-builds" className="text-cell font-semibold text-fg">{characters.length > 0 ? "Builds without a character" : "Builds"}</h2>
              <BuildsTable builds={loose} facts={facts} caption="Saved builds without a character" />
            </section>
          )}
        </div>
      )}

      <section aria-label="Add a character" className="mt-6">
        <CharacterForm />
      </section>
    </Container>
  );
}
