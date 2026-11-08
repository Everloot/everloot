import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SERVED, WITHOUT_SNAPSHOT, versionHref } from "@/lib/build-versions";
import type { GameVersion } from "@/lib/game-version";
import { pageMetadata } from "@/lib/seo";
import { Container, PageHeader } from "@/components/ui";

/**
 * What /ptr and /beta show when the site holds no snapshot of that version (next.config.js rewrites the prefix
 * here, and this route's own address redirects to the prefix). It says so instead of showing another version's
 * data, and stays out of the index: there is nothing of that version to find.
 */
export const dynamicParams = false;
export const generateStaticParams = () => WITHOUT_SNAPSHOT.map((v) => ({ id: v.id }));

type Props = { params: Promise<{ id: string }> };

const find = (id: string): GameVersion | undefined => WITHOUT_SNAPSHOT.find((v) => v.id === id);

/** "None running" for a version with no build; a build the site holds no snapshot of says which. */
const status = (v: GameVersion): string => (v.build ? `Build ${v.build}, which Everloot holds no snapshot of` : v.note ?? "No build is running");
/** The build every page shows, named when it is known. */
const servedBuild = SERVED.build ? `build ${SERVED.build}` : "the current build";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = find((await params).id);
  if (!v) return {};
  const description = `Everloot holds no ${v.label} game data, so no page on the site shows it. Every page shows ${SERVED.label}, ${servedBuild}, and says so in its header.`;
  return { ...pageMetadata({ title: `${v.label} game data`, description, path: versionHref(v) }), robots: { index: false, follow: true } };
}

export default async function GameVersionPage({ params }: Props) {
  const v = find((await params).id);
  if (!v) notFound();
  return (
    <Container width="reading">
      <PageHeader title={`${v.label} game data`} lede={`${v.label}: ${status(v)}.`} />
      <div className="space-y-4">
        <p className="text-fg-2">
          Everloot holds no {v.label} snapshot, so no page shows {v.label} data. Every page on the site shows {SERVED.label},{" "}
          {servedBuild}, and the version label next to the search says so.
        </p>
        <div className="flex items-center gap-3 pt-2">
          <Link href="/" className="btn btn-primary">Home</Link>
          <Link href="/database" className="btn">The database</Link>
        </div>
      </div>
    </Container>
  );
}
