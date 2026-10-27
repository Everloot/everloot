import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClassContextLink } from "@/components/classes/ClassContextChip";
import UseClassButton from "@/components/classes/UseClassButton";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Container, PageHeader, SectionHeading } from "@/components/ui";
import { classLabel, contextLinks, type ContextDestination, type ContextLink } from "@/lib/class-context";
import { classGuides, classRaces, hubIndexable } from "@/lib/class-hub";
import { guideHref } from "@/lib/guides";
import { RACE_TABLE, traitsFor } from "@/lib/race-traits";
import { pageMetadata } from "@/lib/seo";
import { TALENT_CLASSES, isTalentClass } from "@/lib/talents/catalogs";
import type { GuideActivity, GuideRole } from "../../../../../kb/src/guides/guide";

// Built once per deploy, one page per class; `dynamic = "error"` fails the build if the page ever reads the request.
// The guides are read from kb/guides while the site builds: the function bundles do not carry that folder, so a page
// rendered for a request could not read it. A link's level and role are read in the browser (UseClassButton, and
// ClassContextLink for the links that carry them on), so every address of one class gets the same page, canonical to
// the plain one.
export const dynamic = "error";
export const dynamicParams = false;

export function generateStaticParams() {
  return TALENT_CLASSES.map((slug) => ({ class: slug }));
}

type Params = { params: Promise<{ class: string }> };

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const ACTIVITY: Record<GuideActivity, string> = { leveling: "Leveling", dungeons: "Dungeons", raids: "Raids" };
const ROLE: Record<GuideRole, string> = { tank: "Tank", healer: "Healer", damage: "Damage" };

type Destination = Exclude<ContextDestination, "hub">;

/** What each linked page holds, and that it is the whole list where it is not narrowed to the class. */
const NOTES: Record<Destination, (name: string) => string> = {
  talents: (name) => `${name} talent trees with the game's point rules, two talent sets and a share link.`,
  spells: (name) => `Spells in the ${name} talent catalog, from the game files.`,
  items: () => "Every item, with filters for slot, quality, item level and required level.",
  raid: () => "Fill a 10, 20 or 40 player raid with classes and talent trees to see which buffs each group gets.",
  professions: () => "Profession paths and recipe skill ranges, estimated from the recipes and prices players uploaded.",
  dungeons: () => "Every dungeon and raid, lowest level first, with where it is entered and the bosses players report.",
};

const guideCount = (name: string, guides: number) => `${guides} reviewed ${name} ${guides === 1 ? "guide" : "guides"}`;

/** 120 to 160 characters for every class, and honest about the guides (classes.test.tsx). */
const description = (name: string, guides: number) => guides
  ? `${guideCount(name, guides)}, the ${name} talent calculator, the races that can be a ${name} and the database pages to plan one in WoW: Forever.`
  : `The ${name} talent calculator, the races that can be a ${name} and the database pages to plan one in WoW: Forever. No ${name} guide is reviewed yet.`;

/** The line under the title. It names guides only when there are some. */
const lede = (name: string, guides: number) =>
  `What Everloot has for a ${name}: ${guides ? `${guideCount(name, guides)}, ` : ""}the talent calculator, the races that can be one and the database pages to plan with.`;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { class: slug } = await params;
  if (!isTalentClass(slug)) return { robots: { index: false, follow: true } };
  const name = classLabel(slug);
  return {
    ...pageMetadata({ title: `WoW Forever ${name}`, description: description(name, classGuides(slug).length), path: `/classes/${slug}` }),
    robots: { index: hubIndexable(slug), follow: true },
  };
}

/**
 * One class's hub: its reviewed guides, the calculator and the database pages to plan with, and who can play it.
 * Only what the site's readers hold: a published guide, a Blizzard table, a link. A hub with no reviewed guide says
 * so and stays out of search; nothing stands in for the guide, and no role is named but a guide's own.
 */
export default async function ClassHubPage({ params }: Params) {
  const { class: slug } = await params;
  if (!isTalentClass(slug)) notFound();
  const name = classLabel(slug);
  const path = `/classes/${slug}`;
  const guides = classGuides(slug);
  const races = classRaces(slug);
  const links = contextLinks({ classSlug: slug }).filter((l): l is ContextLink & { key: Destination } => l.key !== "hub");

  return (
    <Container>
      <PageHeader
        trail={[{ name: "Home", path: "/" }, { name: "Classes", path: "/classes" }, { name, path }]}
        title={<span className={CLASS_TEXT[slug]}>{name}</span>}
        lede={lede(name, guides.length)}
      />
      <UseClassButton classSlug={slug} />

      <div className="mt-8 space-y-10">
        <section aria-labelledby="guides">
          <SectionHeading id="guides">Reviewed guides</SectionHeading>
          {guides.length === 0 ? (
            <p className="text-sm text-muted">{`No ${name} guide is reviewed yet.`}</p>
          ) : (
            <ul className="space-y-4">
              {guides.map((g) => (
                <li key={g.slug}>
                  <Link href={guideHref(g.slug)} className={`font-semibold ${LINK}`}>{g.title}</Link>
                  <p className="mt-1 text-sm text-fg-2">{g.summary}</p>
                  <p className="mt-1 text-meta text-muted">{`${ACTIVITY[g.activity]} · Levels ${g.levels.from}–${g.levels.to} · ${g.roles.map((r) => ROLE[r]).join(", ")}`}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="plan">
          <SectionHeading id="plan">Plan and look up</SectionHeading>
          <ul className="space-y-2 text-sm">
            {links.map((l) => (
              <li key={l.key}>
                <ClassContextLink classSlug={slug} to={l.key} className={LINK}>{l.label}</ClassContextLink>
                <span className="text-fg-2">{` ${NOTES[l.key](name)}`}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="races">
          <SectionHeading id="races">{`Who can be a ${name}`}</SectionHeading>
          <div className="space-y-5">
            {races.map((f) => (
              <div key={f.faction}>
                <h3 className="text-sm font-semibold text-muted">{f.faction}</h3>
                <dl className="mt-1 divide-y divide-line text-sm">
                  {f.races.map((r) => (
                    <div key={r.race} className="grid gap-x-4 gap-y-1 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                      <dt className="font-medium text-fg">
                        {r.race}
                        {r.isNew && <span className="ml-1 text-xs font-semibold text-accent">New</span>}
                      </dt>
                      <dd>
                        <ul className="space-y-0.5">
                          {traitsFor(f.faction, r.race).map((t) => (
                            <li key={t.name}>
                              <span className="font-medium text-fg">{t.name}</span>
                              <span className="ml-1.5 text-xs text-muted">{t.kind === "active" ? "Active" : "Passive"}</span>
                              <span className="text-fg-2">{` ${t.description}`}</span>
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">
            {races.some((f) => f.races.some((r) => r.isNew)) && <><span className="font-semibold text-accent">New</span> marks the combinations Blizzard names as new in WoW: Forever. </>}
            {`Racial traits found in game files, unconfirmed, build ${RACE_TABLE.build.version}. `}
            <Link href="/wow-forever#races" className={LINK}>Every race and class</Link>
          </p>
        </section>
      </div>
    </Container>
  );
}
