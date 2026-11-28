import type { Metadata } from "next";
import Link from "@/components/Link";
import { trailFor } from "@/lib/breadcrumbs";
import { RememberedClass } from "@/components/classes/UseClassButton";
import GameIcon from "@/components/game/GameIcon";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Card, Container, PageHeader } from "@/components/ui";
import { classGuides, classesIndexable } from "@/lib/class-hub";
import { loadSiteAssets } from "@/lib/game-assets";
import { pageMetadata } from "@/lib/seo";
import { TALENT_CLASSES, loadCatalog } from "@/lib/talents/catalogs";
import GuidesEmpty from "../guides/GuidesEmpty";
import { ClassLinks } from "./ClassNavigation";

// Built once per deploy, and the build fails before it renders for a request: the guide counts are read from
// kb/guides while the site builds, a folder no request can read.
export const dynamic = "error";

const TITLE = "WoW Forever Classes";

/** 120 to 160 characters either way, and honest about the guides (classes.test.tsx). */
const description = (guides: number) => guides
  ? `The nine WoW: Forever classes: ${guides} reviewed ${guides === 1 ? "guide" : "guides"} so far, each class's talent calculator, the races that can play it and the database pages.`
  : "The nine WoW: Forever classes, each with its talent calculator, the races that can play it and the database pages. No class guide is reviewed yet.";

const guideTotal = () => TALENT_CLASSES.reduce((total, slug) => total + classGuides(slug).length, 0);

export async function generateMetadata(): Promise<Metadata> {
  return {
    ...pageMetadata({ title: TITLE, description: description(guideTotal()), path: "/classes" }),
    // Indexed once a class has a reviewed guide; until then the index stays out of search like its hubs.
    robots: { index: classesIndexable(), follow: true },
  };
}

export default async function ClassesPage() {
  const [classes, assets] = await Promise.all([
    Promise.all(TALENT_CLASSES.map(async (slug) => ({ slug, catalog: await loadCatalog(slug), guides: classGuides(slug).length }))),
    loadSiteAssets(),
  ]);
  return (
    <Container>
      <PageHeader
        trail={trailFor("/classes")!}
        title="Classes"
        lede="Explore the abilities, talent trees and patch notes for all nine WoW: Forever classes."
      />
      <RememberedClass />
      <ul aria-label="WoW: Forever classes" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
        {classes.map(({ slug, catalog: { className: name, trees }, guides }) => {
          const icon = assets?.classes.get(slug)?.icon;
          return (
            <Card as="li" key={slug} padding="sm" className="flex flex-col">
              <h2>
                <Link href={`/classes/${slug}`} prefetch={false} className={`inline-flex min-h-11 items-center gap-2 text-lg font-semibold underline-offset-4 hover:underline ${CLASS_TEXT[slug]}`}>
                  {icon && <GameIcon src={icon} size={28} />}
                  {name}
                </Link>
              </h2>
              <p className="text-sm text-fg-2">{trees.map((tree) => tree.name).join(" · ")}</p>
              {guides > 0 && <p className="mt-1 text-meta text-muted">{guides} reviewed {guides === 1 ? "guide" : "guides"}</p>}
              <div className="mt-auto pt-2"><ClassLinks slug={slug} /></div>
            </Card>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-muted">Talent tree names come from the game files.</p>
      {classes.every(({ guides }) => guides === 0) && <div className="mt-3"><GuidesEmpty /></div>}
    </Container>
  );
}
