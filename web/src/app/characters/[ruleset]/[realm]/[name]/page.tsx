import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ShowcaseSections, { ShowcaseIdentity } from "@/components/showcase/ShowcaseSections";
import { Card, Container, PageHeader } from "@/components/ui";
import { FOOTER_LINE, showcaseOn } from "@/lib/character-showcase";
import { optOutPath, playerPagesOn } from "@/lib/player-pages";
import { pageMetadata } from "@/lib/seo";
import { characterShowcase, lookup, type Params } from "./character-view";

/** Read on every request and never cached, so a page switched off is gone at once. */
export const dynamic = "force-dynamic";

/**
 * Every character page stays out of search engines, whatever the link's `indexable` switch says, until indexing of
 * these pages is accepted (showcase plan, S3).
 */
const NOINDEX = { index: false, follow: false } as const;

const UNAVAILABLE = "Character pages are unreachable right now. Try again in a moment.";
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  if (!showcaseOn()) return { title: "Page not found", robots: NOINDEX };
  const p = await props.params;
  const found = await lookup(p.ruleset, p.realm, p.name);
  if (found === "unavailable") return { title: "Character", robots: NOINDEX };
  if (!found) return { title: "Page not found", robots: NOINDEX };
  const showcase = characterShowcase(found, new Date());
  const c = showcase.input;
  return {
    ...pageMetadata({
      title: `${c.name}, ${showcase.line}`,
      description: `${c.name} on ${c.realm}: ${showcase.line}, from the player's own Everloot addon upload.`,
      path: c.path,
      image: `${c.path}/card.png`,
      alt: `Share card for ${c.name}`,
    }),
    robots: NOINDEX,
  };
}

/** A linked character's public page: the identity from the link row, with its upload date. */
export default async function CharacterPage(props: { params: Promise<Params> }) {
  if (!showcaseOn()) notFound();
  const p = await props.params;
  const found = await lookup(p.ruleset, p.realm, p.name);
  if (found === "unavailable") {
    return (
      <Container width="reading">
        <PageHeader trail={[{ name: "Home", path: "/" }]} title="Character" />
        <Card><p className="text-fg-2" role="status">{UNAVAILABLE}</p></Card>
      </Container>
    );
  }
  if (!found) notFound();
  const showcase = characterShowcase(found, new Date());
  const c = showcase.input;
  return (
    <Container width="reading">
      <article className="space-y-8">
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: c.name, path: c.path }]}
          title={<span className={showcase.classSlug ? `text-class-${showcase.classSlug}` : undefined}>{c.name}</span>}
          lede={`${showcase.line} · ${c.realm}`}
          meta={<span className="text-xs" data-freshness>{showcase.freshness}</span>}
        />
        <ShowcaseIdentity showcase={showcase} />
        <ShowcaseSections showcase={showcase} preview={false} />
        <Card className="space-y-2 text-sm text-fg-2">
          <p>{FOOTER_LINE}</p>
          {playerPagesOn() && (
            <p>
              Is this your character, and you did not publish this page?{" "}
              <Link href={optOutPath(c)} rel="nofollow" className={link}>Hide this character</Link>. No account is needed.
            </p>
          )}
        </Card>
      </article>
    </Container>
  );
}
