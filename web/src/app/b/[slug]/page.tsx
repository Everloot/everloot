import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SaveCopy from "@/components/builds/SaveCopy";
import TalentClassView from "@/components/talents/TalentClassView";
import { Badge, Container, PageHeader } from "@/components/ui";
import { compareGameBuilds } from "@/lib/talents/freshness";
import { planHash } from "@/lib/talents/import";
import { isTalentClass, loadCatalog, type TalentClassSlug } from "@/lib/talents/catalogs";
import { buildTitle, readPathCodes, summarizeBuild } from "@/lib/talents/summary";
import { savedBuildsOn, SLUG_PATTERN } from "@/lib/saved-builds";
import { sharedBuild, type SharedBuild } from "@/lib/saved-builds-store";
import { pageMetadata } from "@/lib/seo";
import { getUser } from "@/lib/supabase/server";

// A saved build's short link. It opens for anyone while its owner keeps sharing on, and is a 404 once sharing
// is off or the build is deleted. Read on every visit, so turning sharing off takes effect at once. Not indexed;
// the class page is the canonical one, as for the code links under /tools/talents/<class>/b/.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };
type Found = { build: SharedBuild & { classSlug: TalentClassSlug } } | { unavailable: true } | null;

async function find(params: Params["params"]): Promise<Found> {
  if (!savedBuildsOn()) return null;
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) return null;
  try {
    const build = await sharedBuild(slug);
    return build && isTalentClass(build.classSlug) ? { build: { ...build, classSlug: build.classSlug } } : null;
  } catch {
    return { unavailable: true };
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await find(params);
  if (!found || "unavailable" in found) return { robots: { index: false, follow: false } };
  const { build } = found;
  const catalog = await loadCatalog(build.classSlug);
  const notes = build.notes?.replace(/\s+/g, " ").trim();
  const description = notes
    ? (notes.length > 160 ? `${notes.slice(0, 157).trimEnd()}...` : notes)
    : `A saved WoW: Forever ${catalog.className} talent build. Open it in the calculator.`;
  const base = pageMetadata({
    title: `${build.name} · WoW Forever ${catalog.className} build`, description, path: `/b/${build.slug}`,
    image: `/tools/talents/${build.classSlug}/card?s=${build.slug}`,
  });
  return { ...base, alternates: { ...base.alternates, canonical: `/tools/talents/${build.classSlug}` }, robots: { index: false, follow: true } };
}

export default async function SharedBuildPage({ params }: Params) {
  const found = await find(params);
  if (!found) notFound();
  if ("unavailable" in found) {
    return (
      <Container>
        <PageHeader title="Saved build" />
        <p role="alert" className="text-fg-2">This build is unavailable right now. Try again in a minute.</p>
      </Container>
    );
  }
  const { build } = found;
  const catalog = await loadCatalog(build.classSlug);
  const read = readPathCodes(catalog, [build.code, build.code2 ?? "-"]);
  const summary = read ? buildTitle(catalog, summarizeBuild(catalog, read.sets[read.first ? 0 : 1])) : catalog.className;
  const signedIn = Boolean(await getUser().catch(() => null));
  // -1 older than the tree, 1 newer; null when either build cannot be read, and then the page says nothing.
  const order = compareGameBuilds(build.gameBuild, catalog.build);

  return TalentClassView({
    slug: build.classSlug,
    initialCodes: [build.code, build.code2],
    saved: {
      name: build.name,
      notes: build.notes,
      meta: (
        <>
          <span>{summary}</span>
          <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
            game build {build.gameBuild}
            {order === -1 && <Badge tone="files" title="Made on an older game build than the calculator's tree. Opening it lists what changed.">made on an older game build</Badge>}
            {order === 1 && <Badge tone="files" title="Made on a newer game build than the calculator's tree, which has not caught up with it yet.">made on a newer game build</Badge>}
          </span>
          {build.ownerName && <span>Shared by {build.ownerName}</span>}
        </>
      ),
      actions: (
        <>
          {/* Both sets and their spend orders: the calculator opens the plan as it was saved. */}
          <a href={`/tools/talents/${build.classSlug}${planHash(build.code, build.code2, build.order, build.order2)}`} className="btn btn-primary min-h-10 px-4 text-sm">Open in the calculator</a>
          {signedIn && <SaveCopy name={build.name} notes={build.notes} code={build.code} code2={build.code2} order={build.order} order2={build.order2} />}
        </>
      ),
    },
  });
}
