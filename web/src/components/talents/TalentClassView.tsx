import type { ReactNode } from "react";
import AdSlot from "@/components/AdSlot";
import JsonLd from "@/components/JsonLd";
import { Container, Disclosure, PageHeader, SectionHeading } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { loadSiteAssets } from "@/lib/game-assets";
import { savedBuildsOn } from "@/lib/saved-builds";
import { loadCatalog, type TalentClassSlug } from "@/lib/talents/catalogs";
import { HOW_IT_WORKS_ID, classAnswers, classFacts, classLede } from "@/lib/talents/facts";
import ClassPicker from "./ClassPicker";
import { classChoices } from "./class-choices";
import FreshnessNote from "./FreshnessNote";
import TalentCalculator from "./TalentCalculator";
import { CLASS_TEXT } from "./TalentTreeView";

// One class's calculator page body: the header, the class strip, the calculator, then the questions,
// closed. The class page renders it as is; a build link (/b/<code>) renders it with the build to open.
// A saved build's short link (/b/<slug>) passes `saved`: its name and notes head the page, the calculator only
// shows the build, and the questions are left to the class page. Under a link's calculator, a note says what
// the game files changed since a set's game build.

export const pageTitle = (className: string) => `WoW Forever ${className} Talent Calculator`;

export default async function TalentClassView({ slug, initialCodes, saved }: {
  slug: TalentClassSlug; initialCodes?: (string | null)[]; saved?: { name: string; notes: string | null; meta: ReactNode; actions: ReactNode };
}) {
  const catalog = await loadCatalog(slug);
  const facts = classFacts(catalog);
  const answers = classAnswers(facts);
  const path = `/tools/talents/${slug}`;
  // Class and tree icons from the site's asset folder, matched by tree name; none when the folder is not set.
  const assets = await loadSiteAssets();
  const art = assets?.classes.get(slug);
  const treeIcons = catalog.trees.map((t, i) => art?.trees.find((a) => a.name === t.name)?.icon ?? art?.trees[i]?.icon ?? null);
  const classes = classChoices(assets);
  const classIcon = classes.find((c) => c.slug === slug)?.icon ?? null;

  if (saved) {
    return (
      <Container>
        <PageHeader title={<span className={CLASS_TEXT[slug]}>{saved.name}</span>} meta={saved.meta} actions={saved.actions} />
        {saved.notes && <p className="-mt-2 mb-4 max-w-[75ch] whitespace-pre-line text-cell text-fg-2 [overflow-wrap:anywhere]">{saved.notes}</p>}
        <TalentCalculator catalog={catalog} treeIcons={treeIcons} classIcon={classIcon} initialCodes={initialCodes} readOnly />
        <FreshnessNote catalog={catalog} codes={initialCodes} className="mt-4" />
        <AdSlot slot="belowTool" />
      </Container>
    );
  }

  return (
    <Container>
      <JsonLd data={webApplicationJsonLd({ name: pageTitle(catalog.className), path, description: classLede(facts), hubPath: "/tools/talents" })} />
      {/* On a phone the lede gives its lines to the calculator, which shows the same points, level and trees. */}
      <PageHeader trail={trailFor(path)!} title={<span className={CLASS_TEXT[slug]}>{pageTitle(catalog.className)}</span>} lede={<span className="hidden sm:inline">{classLede(facts)}</span>} />

      <div className="space-y-3 sm:space-y-4">
        <ClassPicker variant="strip" classes={classes} current={slug} />
        <TalentCalculator catalog={catalog} treeIcons={treeIcons} classIcon={classIcon} initialCodes={initialCodes} savedBuilds={savedBuildsOn()} />
        <FreshnessNote catalog={catalog} codes={initialCodes} />
      </div>
      <AdSlot slot="belowTool" />

      {/* The explanations and answers stay on the page for readers and search engines, closed until asked for. */}
      <section aria-labelledby="questions" className="mt-12">
        <SectionHeading id="questions">Questions</SectionHeading>
        <Disclosure id={HOW_IT_WORKS_ID} summary="How does the calculator work?">
          <p>
            Click or tap a talent, or press Enter on it, to add a point. Right click, Delete, or the
            &ldquo;Take points back&rdquo; switch takes one back. With the game&apos;s tooltips on the page, a long
            press shows a talent&apos;s tooltip and Escape closes it; without them, a long press takes a point back.
            Arrow keys move between talents, and Ctrl+Z and Ctrl+Y undo and redo.
          </p>
          <p>
            The small number at the left of each row is how many points must be spent in that tree, on the rows
            above, before the row opens (from the game tables). Each set has its own points, and Reset beside a
            tree clears only that tree. The page address is the link: it holds both sets and the game build they
            were made on, and if talents move, opening it lists what changed.
          </p>
          <p>
            The second set opening at level {catalog.rules.dualSpecLevel} comes from the beta notes, not the game files.
            {catalog.rules.gateScope === "unconfirmed" && " Where a row gate counts its points is unconfirmed for some talents; the calculator reads those as points in the same tree."}
          </p>
        </Disclosure>
        <Disclosure summary={answers.pointsQuestion}>
          <p>{answers.pointsAnswer}</p>
        </Disclosure>
        <Disclosure summary={answers.layoutQuestion}>
          <ul className="list-disc pl-6">
            {facts.trees.map((t) => (
              <li key={t.name}><span className="text-fg">{t.name}</span>: {t.talents} talents, {t.ranks} ranks</li>
            ))}
          </ul>
          {answers.layoutAnswer && <p>{answers.layoutAnswer}</p>}
        </Disclosure>
      </section>
    </Container>
  );
}
