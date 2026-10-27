import type { Metadata } from "next";
import Link from "next/link";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Container, FilterBar, PageHeader, SectionHeading, type FilterControl } from "@/components/ui";
import { MAX_LEVEL, ROLES, classLabel } from "@/lib/class-context";
import { GUIDE_STATE_LABEL, guideFreshness, guideIndexable, type GuideFreshness } from "@/lib/guide-freshness";
import { ACTIVITY_LABEL, ROLE_LABEL, guideHref, guidesFor, loadGuides, publishedGuides, type Guide } from "@/lib/guides";
import { pageMetadata } from "@/lib/seo";
import { TALENT_CLASSES, isTalentClass, loadCatalog, type TalentClassSlug } from "@/lib/talents/catalogs";
import { PUBLISHED_CHANGES, classTalentChanges } from "@/lib/talents/freshness";
import { GUIDE_ACTIVITIES, type GuideActivity, type GuideRole } from "../../../../kb/src/guides/guide";

// The published guides by class, each marked when it is not current. A link's class, activity, role and level narrow
// the list through the guide reader (guidesFor); a narrowed list stays out of search, canonical to the plain one. The
// filters are read from the request, so kb/guides is read then too (next.config.js traces it into the route).

type Search = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<Search> };

const TITLE = "WoW Forever Guides";
const LEDE = "Everloot's reviewed guides, each a talent plan for one class: who it is for, why it fits, how to play it and what we do not know yet.";
const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** 120 to 160 characters, and honest about the guides (guides.test.tsx). */
const description = (guides: number) => guides
  ? `${guides} reviewed WoW: Forever ${guides === 1 ? "guide" : "guides"} from Everloot, each a talent plan for one class: who it is for, why it fits and how to play it.`
  : "Everloot's reviewed WoW: Forever guides, each a talent plan for one class: who it is for, why it fits and how to play it. No guide is reviewed yet.";

interface Filter { classSlug?: TalentClassSlug; activity?: GuideActivity; role?: GuideRole; level?: number }
const KEYS = ["class", "activity", "role", "level"] as const;

/** A value as a reason repeats it: quoted, and cut short when a link carries something long. */
const quoted = (value: string) => JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);

/**
 * The filters a link carries, read whole or refused whole with the reason, in the words a class link uses
 * (lib/class-context.ts). A refused link narrows nothing, and nothing fills the gap. `given`: the link names a filter,
 * so the page is a filtered variant of the index.
 */
function readFilter(search: Search): { filter: Filter; error: string | null; given: boolean } {
  const given = KEYS.some((key) => search[key] !== undefined);
  const value: Partial<Record<(typeof KEYS)[number], string>> = {};
  for (const key of KEYS) {
    const values = ([] as string[]).concat(search[key] ?? []).filter((v) => v !== "");
    if (values.length > 1) return { filter: {}, error: `The link gives ${key} more than once.`, given };
    if (values.length === 1) value[key] = values[0];
  }
  const refuse = (error: string) => ({ filter: {}, error, given });
  const filter: Filter = {};
  if (value.class !== undefined) {
    if (!isTalentClass(value.class)) return refuse(`${quoted(value.class)} is not one of the nine classes.`);
    filter.classSlug = value.class;
  }
  if (value.activity !== undefined) {
    if (!(GUIDE_ACTIVITIES as readonly string[]).includes(value.activity)) return refuse(`${quoted(value.activity)} is not an activity guides are written for: leveling, dungeons or raids.`);
    filter.activity = value.activity as GuideActivity;
  }
  if (value.role !== undefined) {
    if (!(ROLES as readonly string[]).includes(value.role)) return refuse(`${quoted(value.role)} is not a role guides are written for: tank, healer or damage.`);
    filter.role = value.role as GuideRole;
  }
  if (value.level !== undefined) {
    if (!/^[1-9]\d?$/.test(value.level) || Number(value.level) > MAX_LEVEL) return refuse(`${quoted(value.level)} is not a level from 1 to ${MAX_LEVEL}.`);
    filter.level = Number(value.level);
  }
  return { filter, error: null, given };
}

/** The published guides a filter keeps: by class in the calculator's order, the lowest levels first in each. */
const listed = (guides: Map<string, Guide>, filter: Filter): Guide[] =>
  (filter.classSlug ? [filter.classSlug] : TALENT_CLASSES).flatMap((classSlug) => guidesFor(guides, { ...filter, classSlug }));

function hrefFor(filter: Filter): string {
  const query = new URLSearchParams();
  if (filter.classSlug) query.set("class", filter.classSlug);
  if (filter.activity) query.set("activity", filter.activity);
  if (filter.role) query.set("role", filter.role);
  if (filter.level !== undefined) query.set("level", String(filter.level));
  const q = query.toString();
  return q ? `/guides?${q}` : "/guides";
}

/** Each guide against its class's tree today. The change records are read here, on the server. */
async function withFreshness(guides: Guide[]): Promise<{ guide: Guide; freshness: GuideFreshness }[]> {
  const today = new Date().toISOString().slice(0, 10);
  return Promise.all(guides.map(async (guide) => {
    const catalog = await loadCatalog(guide.classSlug);
    return { guide, freshness: guideFreshness(guide, catalog, classTalentChanges(PUBLISHED_CHANGES, catalog.classId), today) };
  }));
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { given } = readFilter(await searchParams);
  const guides = publishedGuides(loadGuides());
  // Indexed once it lists a guide that is itself indexed, and only as the plain list.
  const indexable = !given && (await withFreshness(guides)).some(({ guide, freshness }) => guideIndexable(guide, freshness));
  return { ...pageMetadata({ title: TITLE, description: description(guides.length), path: "/guides" }), robots: { index: indexable, follow: true } };
}

export default async function GuidesIndex({ searchParams }: Props) {
  const { filter, error } = readFilter(await searchParams);
  const guides = loadGuides();
  const any = publishedGuides(guides).length > 0;
  const shown = await withFreshness(listed(guides, filter));

  const menu = <K extends "classSlug" | "activity" | "role">(key: K, label: string, every: string, choices: readonly NonNullable<Filter[K]>[], name: (c: NonNullable<Filter[K]>) => string, className?: (c: NonNullable<Filter[K]>) => string): FilterControl => ({
    type: "menu", key, label,
    options: [
      { label: every, href: hrefFor({ ...filter, [key]: undefined }), on: filter[key] === undefined, reset: true },
      ...choices.map((c) => ({
        label: name(c), href: hrefFor({ ...filter, [key]: filter[key] === c ? undefined : c }), on: filter[key] === c,
        count: listed(guides, { ...filter, [key]: c }).length, className: className?.(c),
      })),
    ],
  });
  const controls: FilterControl[] = [
    menu("classSlug", "Class", "Every class", TALENT_CLASSES, classLabel, (c) => CLASS_TEXT[c]),
    menu("activity", "Activity", "Every activity", GUIDE_ACTIVITIES, (a) => ACTIVITY_LABEL[a]),
    menu("role", "Role", "Every role", ROLES, (r) => ROLE_LABEL[r]),
    ...(filter.level !== undefined ? [{ type: "toggle" as const, key: "level", label: `Level ${filter.level}`, href: hrefFor({ ...filter, level: undefined }), on: true }] : []),
  ];
  const active = Object.values(filter).filter((v) => v !== undefined).length;
  const byClass = TALENT_CLASSES.map((c) => ({ c, rows: shown.filter((s) => s.guide.classSlug === c) })).filter((g) => g.rows.length > 0);

  return (
    <Container>
      <PageHeader trail={[{ name: "Home", path: "/" }, { name: "Guides", path: "/guides" }]} title="Guides" lede={LEDE} />
      {any && <FilterBar label="Guide filters" controls={controls} active={active} clearHref="/guides" />}
      {error && <p className="mt-4 text-sm text-muted">{error} This page shows every guide instead.</p>}
      <div className="mt-8 space-y-10">
        {!any ? (
          <p className="text-sm text-muted">No guide is reviewed yet.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted">No reviewed guide matches these filters. <Link href="/guides" className={LINK}>Show every guide</Link></p>
        ) : byClass.map(({ c, rows }) => (
          <section key={c} aria-labelledby={`class-${c}`}>
            <SectionHeading id={`class-${c}`}><span className={CLASS_TEXT[c]}>{classLabel(c)}</span></SectionHeading>
            <ul className="space-y-4">
              {rows.map(({ guide: g, freshness }) => (
                <li key={g.slug} data-guide={g.slug}>
                  <Link href={guideHref(g.slug)} className={`font-semibold ${LINK}`}>{g.title}</Link>
                  {freshness.state !== "current" && (
                    <span data-guide-state={freshness.state} className="ml-2 text-meta font-semibold text-warning">{GUIDE_STATE_LABEL[freshness.state]}</span>
                  )}
                  <p className="mt-1 text-sm text-fg-2">{g.summary}</p>
                  <p className="mt-1 text-meta text-muted">
                    {`${ACTIVITY_LABEL[g.activity]} · Levels ${g.levels.from}–${g.levels.to} · ${g.roles.map((r) => ROLE_LABEL[r]).join(", ")}${g.reviewed ? ` · Reviewed ${g.reviewed.on}` : ""}`}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Container>
  );
}
