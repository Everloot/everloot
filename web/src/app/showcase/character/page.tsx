import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ShowcaseSections, { ShowcaseIdentity } from "@/components/showcase/ShowcaseSections";
import { Container, PageHeader } from "@/components/ui";
import { SAMPLE_NOTE, sampleShowcase } from "@/data/showcase";
import { buildShowcase, FOOTER_LINE, showcaseOn } from "@/lib/character-showcase";
import { pageMetadata } from "@/lib/seo";

/** The switch is read on each request, and the sample's dates move with the day. */
export const dynamic = "force-dynamic";

const PATH = "/showcase/character";
const NOINDEX = { index: false, follow: false } as const;

export function generateMetadata(): Metadata {
  if (!showcaseOn()) return { title: "Page not found", robots: NOINDEX };
  return {
    ...pageMetadata({
      title: "Sample character showcase",
      description: "A made-up character showing what a character page on Everloot holds: gear, talents, professions, reputations, raids and collections.",
      path: PATH,
      image: `${PATH}/card.png`,
      alt: "Share card for the sample character Examplechar",
    }),
    robots: NOINDEX,
  };
}

/** The showcase as the owner's preview would show it, filled with the sample: every section and every state. */
export default function SampleCharacterPage() {
  if (!showcaseOn()) notFound();
  const now = new Date();
  const showcase = buildShowcase(sampleShowcase(now), now);
  const c = showcase.input;
  return (
    <Container width="reading">
      <article className="space-y-8">
        <div role="note" data-sample className="rounded-control border border-line bg-panel p-4 text-sm text-fg-2">{SAMPLE_NOTE}</div>
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: "Sample character", path: PATH }]}
          title={<span className={showcase.classSlug ? `text-class-${showcase.classSlug}` : undefined}>{c.name}</span>}
          lede={`${showcase.line} · ${c.realm}`}
          meta={<span className="text-xs" data-freshness>{showcase.freshness}</span>}
          actions={<a href={`${PATH}/card-square.png`} className="btn" download="examplechar-card.png">Download card</a>}
        />
        <ShowcaseIdentity showcase={showcase} />
        <ShowcaseSections showcase={showcase} preview />
        <p className="text-sm text-muted">{FOOTER_LINE}</p>
      </article>
    </Container>
  );
}
