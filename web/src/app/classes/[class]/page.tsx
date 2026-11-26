import type { Metadata } from "next";
import { trailFor } from "@/lib/breadcrumbs";
import JsonLd from "@/components/JsonLd";
import { entityPageJsonLd } from "@/lib/jsonld";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClassContextLink } from "@/components/classes/ClassContextChip";
import UseClassButton from "@/components/classes/UseClassButton";
import GameIcon from "@/components/game/GameIcon";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Badge, Container, PageHeader, SectionHeading } from "@/components/ui";
import { CLIENT_CLASS_GEAR } from "@/data/game-data/client-class-gear";
import { armoryBoardHref } from "@/lib/armory";
import { censusHref } from "@/lib/census-filter";
import { classLabel, contextLinks, type ContextDestination, type ContextLink } from "@/lib/class-context";
import { classGear, classGuides, classRaces, classSpellLevels, guideRoles, hubIndexable, type GearType } from "@/lib/class-hub";
import { loadSiteAssets } from "@/lib/game-assets";
import { guideHref } from "@/lib/guides";
import { RACE_TABLE, RACIAL_NOTES, traitsFor } from "@/lib/race-traits";
import { pageMetadata } from "@/lib/seo";
import { TALENT_CLASSES, isTalentClass, loadCatalog } from "@/lib/talents/catalogs";
import { classFacts } from "@/lib/talents/facts";
import { CENSUS_CLASSES } from "@kb/census";
import type { GuideActivity, GuideRole } from "@kb/guides/guide";
import GuidesEmpty from "../../guides/GuidesEmpty";

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
  spells: (name) => `${name} spells on the class's skill lines and in its talent catalog, from the game files.`,
  items: (name) => `Items a ${name} can use by its proficiencies in the game files, with filters for slot, quality, item level and required level.`,
  raid: () => "Fill a 10, 20 or 40 player raid with classes and talent trees to see which buffs each group gets.",
  professions: () => "Profession paths and recipe skill ranges, estimated from the recipes and prices players uploaded.",
  dungeons: () => "Every dungeon and raid, lowest level first, with where it is entered and the bosses players report.",
};

/** One row of types, "Plate from level 40": the level only where the files give the proficiency after level 1. */
function GearList({ label, types }: { label: string; types: GearType[] }) {
  if (!types.length) return null;
  return (
    <div className="grid gap-x-4 gap-y-1 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="font-medium text-fg">{label}</dt>
      <dd>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {types.map((t) => (
            <li key={t.href === null ? `type-${t.subclass}` : t.href}>
              {t.href !== null ? <Link href={t.href} className={LINK}>{t.name}</Link> : <span className="text-fg">{`Type ${t.subclass}`}</span>}
              {t.level > 1 && <span className="text-fg-2">{` from level ${t.level}`}</span>}
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

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
  // The census keys a class by UnitClass's token, the talent catalog by its slug; the nine are the same names.
  const census = CENSUS_CLASSES.find((c) => c.name === name)!;
  const roles = guideRoles(guides);
  const gear = classGear(slug);
  const spells = classSpellLevels(slug);
  const placed = spells.levels.reduce((n, l) => n + l.spells.length, 0);
  // The class and tree icons are the calculator's, read from the asset folder while the site builds; none without it.
  const [catalog, assets] = await Promise.all([loadCatalog(slug), loadSiteAssets()]);
  const facts = classFacts(catalog);
  const art = assets?.classes.get(slug);
  const treeIcon = (tree: string, i: number) => art?.trees.find((a) => a.name === tree)?.icon ?? art?.trees[i]?.icon ?? null;
  const calculator = `/tools/talents/${slug}`;

  return (
    <Container>
      <JsonLd data={entityPageJsonLd({ name, path, identifier: `class:${slug}` })} />
      <PageHeader
        trail={[...trailFor("/classes")!, { name, path }]}
        title={<span className={CLASS_TEXT[slug]}>{name}</span>}
        icon={art?.icon ? <GameIcon src={art.icon} size={40} /> : undefined}
        lede={lede(name, guides.length)}
        meta={roles.length ? <span>{`Roles in its reviewed guides: ${roles.map((r) => ROLE[r]).join(", ")}`}</span> : undefined}
      />
      <UseClassButton classSlug={slug} />

      <div className="mt-8 space-y-10">
        <section aria-labelledby="guides">
          <SectionHeading id="guides">Reviewed guides</SectionHeading>
          {guides.length === 0 ? (
            <GuidesEmpty classSlug={slug} />
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

        <section aria-labelledby="talents">
          <SectionHeading id="talents">Talent trees</SectionHeading>
          <ul className="grid gap-3 sm:grid-cols-3">
            {facts.trees.map((t, i) => {
              const icon = treeIcon(t.name, i);
              return (
                <li key={t.name}>
                  <Link href={calculator} className="flex items-center gap-3 rounded border border-line px-3 py-2 hover:border-edge">
                    {icon && <GameIcon src={icon} size={32} />}
                    <span className="min-w-0">
                      <span className="block font-semibold text-fg">{t.name}</span>
                      <span className="block text-meta text-muted">{`${t.talents} talents, ${t.ranks} ranks`}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm text-fg-2">
            <Link href={calculator} className={LINK}>{`Plan a ${name} in the talent calculator`}</Link>
            {` ${facts.points} points by level ${facts.maxLevel}, from the talent catalog of build ${facts.build}. `}
            <Badge tone="files" />
          </p>
        </section>

        <section aria-labelledby="gear">
          <SectionHeading id="gear">Weapons and armor</SectionHeading>
          <dl className="divide-y divide-line text-sm">
            <GearList label="Armor" types={gear.armor} />
            <GearList label="Weapons" types={gear.weapons} />
          </dl>
          <p className="mt-3 text-sm text-muted">
            <Badge tone="files" />{" "}
            {`The ${name}'s proficiencies in the game files of build ${CLIENT_CLASS_GEAR.build.version}, unconfirmed. Each type opens the item list narrowed to what a ${name} can use.`}
          </p>
        </section>

        <section aria-labelledby="spells">
          <SectionHeading id="spells">Spells by level</SectionHeading>
          {placed > 0 ? (
            <p className="text-sm text-fg-2">
              <Link href={`/classes/${slug}/spells`} className={LINK}>{`Every ${name} spell by the level it is learned`}</Link>
              {` ${placed} ${name} spells with the level the game files give, from level ${spells.levels[0]!.level} to ${spells.levels.at(-1)!.level}: ranks, talents and passives as the files mix them. `}
              {spells.unleveled > 0 && <>{`${spells.unleveled} more have no level in the files; `}<Link href={`/database/spells?class=${slug}`} className={LINK}>{`every ${name} spell`}</Link>{" lists them too. "}</>}
              <Badge tone="files" />
            </p>
          ) : (
            <p className="text-sm text-fg-2">{`The game files give no level for a ${name} spell in this build.`}</p>
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

        {/* The live counts stay on the census and rankings pages: this page is built once per deploy, so a number
            printed here would be the deploy's, not the week's. The census page shows a count from 10 characters. */}
        <section aria-labelledby="forever">
          <SectionHeading id="forever">{`${name} on Forever`}</SectionHeading>
          <ul className="space-y-2 text-sm">
            <li>
              <Link href={censusHref({ class: census.token })} className={LINK}>{`How many characters are a ${name}`}</Link>
              <span className="text-fg-2">{` The census, narrowed to the ${name}: characters counted this week and their share of everyone counted, shown from 10 characters.`}</span>
            </li>
            <li>
              <Link href="/rankings/classes" className={LINK}>{`Where ${name} ranks this week`}</Link>
              <span className="text-fg-2"> Every class by characters active in the week, with the change against last week.</span>
            </li>
            {/* Blizzard API numbers stay on the ad-free armory pages (docs/DATA_POLICY.md, "Armory"): this page only links them. */}
            <li>
              <Link href={armoryBoardHref("item-level", { region: null, ruleset: null, class: name })} className={LINK}>{`Top ${name} characters by item level`}</Link>
              <span className="text-fg-2">{` The armory board narrowed to the ${name}, from Blizzard's API.`}</span>
            </li>
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
            {`Racial traits found in game files, unconfirmed, build ${RACE_TABLE.build.version}, with Blizzard's final racial changes from `}
            <a href={RACIAL_NOTES.sourceUrl} rel="noopener" className={LINK}>{`${RACIAL_NOTES.sourceName}, ${RACIAL_NOTES.sourceTitle}`}</a>
            {". "}
            <Link href="/wow-forever#races" className={LINK}>Every race and class</Link>
          </p>
        </section>
      </div>
    </Container>
  );
}
