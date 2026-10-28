import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { className } from "@/components/builds/describe";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Badge, Container, DataTable, DataTitle, type Column } from "@/components/ui";
import { publicProfile, type PublicProfile } from "@/lib/account-shell";
import { profilesOn } from "@/lib/profiles";
import { savedBuildsOn, shortPath } from "@/lib/saved-builds";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };
type Character = NonNullable<PublicProfile["characters"]>[number] & { row: number };
type Build = NonNullable<PublicProfile["builds"]>[number];

/** The profile, or null when the switch is off, the handle is unknown or the profile is not public. */
async function load(handle: string): Promise<PublicProfile | null> {
  if (!profilesOn()) return null;
  try {
    return await publicProfile(handle);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await load((await params).handle);
  if (!profile) return { title: "Not found", robots: { index: false, follow: false } };
  const name = profile.displayName ?? `@${profile.handle}`;
  // Indexed only while public: an off or unknown profile is a 404 with noindex.
  return pageMetadata({ title: `${name} (@${profile.handle})`, description: `${name}'s characters and shared talent builds on Everloot.`, path: `/u/${profile.handle}` });
}

/** A player's public profile: only what they ticked. Never their BattleTag, email or a build they did not share. */
export default async function PublicProfilePage({ params }: Props) {
  const profile = await load((await params).handle);
  if (!profile) notFound();
  const { characters, status } = profile;
  // A shared build opens at /b/<slug>, which is a 404 while EVERLOOT_SAVED_BUILDS is off.
  const builds = savedBuildsOn() ? profile.builds : null;

  const characterColumns: Column<Character>[] = [
    {
      key: "name", header: "Name",
      cell: (c) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className={CLASS_TEXT[c.classSlug] ?? "text-fg"}>{c.name}</span>
          {c.main && <Badge tone="neutral">Main</Badge>}
        </span>
      ),
    },
    { key: "class", header: "Class", nowrap: true, cell: (c) => <span className="text-fg-2">{className(c.classSlug)}</span> },
    { key: "realm", header: "Realm", cell: (c) => <span className="text-fg-2">{c.realm ?? "–"}</span> },
  ];
  const buildColumns: Column<Build>[] = [
    { key: "name", header: "Build", cell: (b) => <a href={shortPath(b.slug)} className="text-fg hover:text-accent [overflow-wrap:anywhere]">{b.name}</a> },
    { key: "class", header: "Class", nowrap: true, cell: (b) => <span className={CLASS_TEXT[b.classSlug] ?? "text-fg-2"}>{className(b.classSlug)}</span> },
    { key: "updated", header: "Updated", nowrap: true, cell: (b) => <time dateTime={b.updatedAt} className="font-mono tabular-nums text-fg-2">{b.updatedAt.slice(0, 10)}</time> },
  ];

  return (
    <Container>
      <DataTitle title={profile.displayName ?? `@${profile.handle}`} meta={profile.displayName ? `@${profile.handle}` : undefined} />
      {status && <p className="mb-6 text-cell text-fg-2">{status.emoji} {status.text}</p>}
      <div className="space-y-6">
        {characters && (
          <section aria-labelledby="characters" className="space-y-2">
            <h2 id="characters" className="text-cell font-semibold text-fg">Characters</h2>
            <DataTable dense caption="Characters" columns={characterColumns} rows={characters.map((c, row) => ({ ...c, row }))} rowKey={(c) => String(c.row)}
              meta={(c) => [className(c.classSlug), c.realm].filter(Boolean).join(" · ")}
              empty={<p className="px-3 py-4 text-cell text-muted">No characters yet.</p>} />
          </section>
        )}
        {builds && (
          <section aria-labelledby="builds" className="space-y-2">
            <h2 id="builds" className="text-cell font-semibold text-fg">Shared builds</h2>
            <DataTable dense caption="Shared builds" columns={buildColumns} rows={builds} rowKey={(b) => b.slug}
              meta={(b) => `${className(b.classSlug)} · ${b.updatedAt.slice(0, 10)}`}
              empty={<p className="px-3 py-4 text-cell text-muted">No shared builds yet.</p>} />
          </section>
        )}
        {!characters && !builds && !status && <p className="text-cell text-muted">Nothing shared here yet.</p>}
      </div>
    </Container>
  );
}
