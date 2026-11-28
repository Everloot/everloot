import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import Link from "@/components/Link";
import ClassPicker from "@/components/talents/ClassPicker";
import { classChoices } from "@/components/talents/class-choices";
import { Container, Disclosure, PageHeader, SectionHeading } from "@/components/ui";
import { getTool } from "@/data/tools";
import { trailFor } from "@/lib/breadcrumbs";
import { loadSiteAssets } from "@/lib/game-assets";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { TALENT_CLASSES, loadCatalog } from "@/lib/talents/catalogs";
import { hubAnswers } from "@/lib/talents/facts";

const tool = getTool("talents")!;
const TITLE = "WoW Forever Talent Calculator";
// The page's lead line carries no "unconfirmed" sentence (owner rule, 2026-10-20); the meta description keeps it.
const lede = "Plan WoW: Forever talents for all nine classes with the game's own point rules, two talent sets, undo and a share link.";
const description = `${lede} Trees are unconfirmed.`;

export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description, path: "/tools/talents" }),
  keywords: tool.keywords,
};

export default async function TalentsIndexPage() {
  const catalogs = await Promise.all(TALENT_CLASSES.map(loadCatalog));
  const answers = hubAnswers(catalogs);
  const classes = classChoices(await loadSiteAssets(), new Map(catalogs.map((c) => [c.classSlug, c.trees.map((t) => t.name)])));
  return (
    <Container>
      <JsonLd data={webApplicationJsonLd({ name: TITLE, path: "/tools/talents", description: lede })} />
      <PageHeader
        trail={trailFor("/tools/talents")!}
        title={TITLE}
        lede={lede}
        actions={<Link href="/classes" className="btn min-h-11">Browse classes</Link>}
      />

      <ClassPicker variant="tiles" classes={classes} />

      {/* The answers stay on the page for readers and search engines, closed until asked for. */}
      <section aria-labelledby="questions" className="mt-12">
        <SectionHeading id="questions">Questions</SectionHeading>
        <Disclosure summary={answers.pointsQuestion}>
          <p>{answers.pointsAnswer}</p>
        </Disclosure>
        <Disclosure summary={answers.setsQuestion}>
          <p>{answers.setsAnswer}</p>
        </Disclosure>
      </section>
    </Container>
  );
}
