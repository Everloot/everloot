import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import ShowcaseSections, { showcaseContents, ShowcaseHeader } from "@/components/showcase/ShowcaseSections";
import { Container, ReadingLayout, RailFacts } from "@/components/ui";
import { SAMPLE_NOTE, sampleShowcase } from "@/data/showcase";
import { buildShowcase, FOOTER_LINE, showcaseOn } from "@/lib/character-showcase";
import { pageMetadata } from "@/lib/seo";
import { withGearArt } from "@/lib/showcase-gear-art";

/** The switch is read on each request, and the sample's dates move with the day. */
export const dynamic = "force-dynamic";

const PATH = "/showcase/character";
const NOINDEX = { index: false, follow: false } as const;

export function generateMetadata(): Metadata {
  if (!showcaseOn()) return { title: "Page not found", robots: NOINDEX };
  return {
    ...pageMetadata({
      title: "Sample character showcase",
      description: "A made-up character showing what a character page on Everloot holds: gear, stats, talents, raids, progress, reputations and professions.",
      path: PATH,
      image: `${PATH}/card.png`,
      alt: "Share card for the sample character Examplechar",
    }),
    robots: NOINDEX,
  };
}

/**
 * The showcase as the owner's preview would show it, filled with the sample: every section and every state. Laid
 * out as the real character page is: one column of sections with the contents and each source's date in the rail.
 */
export default async function SampleCharacterPage() {
  if (!showcaseOn()) notFound();
  const now = new Date();
  const showcase = buildShowcase(await withGearArt(sampleShowcase(now)), now);
  const c = showcase.input;
  return (
    <Container width="wide">
      <ReadingLayout
        items={showcaseContents(showcase, true)}
        meta={<div className="space-y-2" data-rail="sources"><p className="font-mono text-xs text-muted">Where this comes from</p><RailFacts items={[{ label: "Sample upload", value: <span className="font-mono">{c.lastUpload}</span> }]} /></div>}
      >
        <article className="space-y-8">
          <div role="note" data-sample className="rounded-control border border-line bg-panel p-4 text-sm text-fg-2">{SAMPLE_NOTE}</div>
          <ShowcaseHeader
            showcase={showcase}
            trail={trailFor(PATH)!}
            actions={<a href={`${PATH}/card-square.png`} className="btn" download="examplechar-card.png">Download card</a>}
          />
          <ShowcaseSections showcase={showcase} preview />
          <p className="text-sm text-muted">{FOOTER_LINE}</p>
        </article>
      </ReadingLayout>
    </Container>
  );
}
