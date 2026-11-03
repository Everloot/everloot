import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import EmailCapture from "@/components/EmailCapture";
import { Card, Container, Contribute, DataTitle, Disclosure, EmptyState, FilterBar, LinkTabs, SectionHeading, type FilterControl } from "@/components/ui";
import { FARM_CATEGORIES, farmingAreas, inLevels, MOVED_CATEGORIES, type FarmCategory } from "@/lib/farming";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { npcRows } from "@/lib/world-lists";
import { LINK } from "../../database/entity";
import { LEVEL_BRACKETS, listHref, listMetadata, range, rangeParam, type Search } from "../../database/list-parts";
import FarmAreaTable from "./area-table";

const META = {
  title: "WoW Forever Farming",
  description: "WoW: Forever gold and reputation farming areas from what players upload, with links to where to gather herbs, ore, leather and cloth.",
  path: "/tools/farming-routes",
};
export const dynamic = "force-dynamic";

const SLUGS = new Set<string>(FARM_CATEGORIES.map((c) => c.slug));

interface FarmQuery { category?: FarmCategory; level?: { min: number; max: number } }

/** The page's filters from the URL: `category=gold`, `level=10-20`. Null when a value is malformed (404). */
function farmQuery(search: Search): FarmQuery | null {
  const level = range(search, "level");
  const category = search.category;
  if (level === null || (category !== undefined && (typeof category !== "string" || !SLUGS.has(category)))) return null;
  return { ...(category ? { category: category as FarmCategory } : {}), ...(level ? { level } : {}) };
}

/**
 * Where an old tab's link goes now (`?category=herbs` → Herbalism), or null. A malformed level is a 404 like on
 * the page itself (null here, then `farmQuery` rejects it); a valid one goes along where the destination filters by it.
 */
function moved(search: Search): string | null {
  const to = typeof search.category === "string" ? MOVED_CATEGORIES[search.category] : undefined;
  const level = range(search, "level");
  if (!to || level === null) return null;
  return `${listHref(to.path, to.levels ? [[to.levels, rangeParam(level)]] : [])}${to.hash ? `#${to.hash}` : ""}`;
}

const href = (q: FarmQuery) => listHref(META.path, [["category", q.category], ["level", rangeParam(q.level)]]);
const filters = (q: FarmQuery) => Number(Boolean(q.category)) + Number(Boolean(q.level));

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = farmQuery((await props.searchParams) ?? {});
  return { ...listMetadata(META, Boolean(q) && filters(q!) === 0), keywords: ["wow forever farming", "wow forever gold farm", "wow forever reputation farm"] };
}

/** Where the gathering and the dungeons live now, for the section that points there. */
const ELSEWHERE = [
  { label: "Herbs", where: "Herbalism", href: "/tools/professions/herbalism#gather" },
  { label: "Ore", where: "Mining", href: "/tools/professions/mining#gather" },
  { label: "Skins and leather", where: "Skinning", href: "/tools/professions/skinning#gather" },
  { label: "Cloth", where: "Tailoring", href: "/tools/professions/tailoring#gather" },
  { label: "Dungeons", where: "Dungeons and raids", href: "/database/instances" },
];

/**
 * The farming home: gold and reputation as tabs with their counts and a level menu, shaped like the Auction House.
 * Gathering moved to the profession pages and the dungeons to the dungeon list; an old tab's link goes there. Nothing
 * is invented: a zone is listed only when players' uploads put looted mobs there.
 */
export default async function FarmingRoutesPage(props: { searchParams?: Promise<Search> }) {
  const search = (await props.searchParams) ?? {};
  const to = moved(search);
  if (to) permanentRedirect(to);
  const q = farmQuery(search);
  if (!q) notFound();
  const [facts, { rates }] = await Promise.all([loadWorldFacts(), computeRollups()]);
  const down = facts.unreachable;
  const mobs = farmingAreas(down ? [] : npcRows(facts, rates), down ? [] : rates);
  const areas: Record<FarmCategory, typeof mobs.gold> = { gold: mobs.gold, reputation: [] };
  const here = (over: FarmQuery) => href({ ...q, ...over });

  const total = FARM_CATEGORIES.reduce((n, c) => n + areas[c.slug].length, 0);
  const tabs = [
    { href: here({ category: undefined }), label: "Everything", current: !q.category, count: total },
    ...FARM_CATEGORIES.map((c) => ({ href: here({ category: c.slug }), label: c.label, current: q.category === c.slug, count: areas[c.slug].length })),
  ];
  const controls: FilterControl[] = [
    {
      type: "menu", key: "level", label: "Level",
      options: [{ label: "Any level", href: here({ level: undefined }), on: !q.level, reset: true }, ...LEVEL_BRACKETS.map((b) => ({
        label: `${b.min}–${b.max}`, href: here({ level: b }), on: q.level?.min === b.min && q.level?.max === b.max,
      }))],
    },
  ];

  const shown = FARM_CATEGORIES.filter((c) => !q.category || q.category === c.slug);
  const quiet = (text: string) => <p data-empty-state className="py-3 text-cell text-fg-2">{text}</p>;
  const emptyFor = (noun: string) => <EmptyState message={`No ${noun} areas yet: a zone shows once 3 players upload loot from the same mobs there.`} />;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Farming" meta={total === 1 ? "1 area" : `${total} areas`} />
        <LinkTabs label="What to farm" tabs={tabs} />
        <div className="mt-3">
          <FilterBar label="Farming filters" controls={controls} active={Number(Boolean(q.level))} clearHref={here({ level: undefined })} />
        </div>
        <div className="mt-4 space-y-6">
          {shown.map((c) => {
            const all = areas[c.slug];
            const rows = q.level ? all.filter((a) => inLevels(a, q.level!)) : all;
            const body = rows.length > 0 ? <FarmAreaTable areas={rows} backing="mobs" caption={`${c.label} areas: ${rows.length}`} />
              : c.slug === "reputation" ? quiet("Reputation comes from kills and quests, which the addon does not yet place in a zone. Nothing here is estimated.")
              : down ? quiet(STORAGE_UNREACHABLE)
              : all.length === 0 ? emptyFor(c.noun)
              : quiet(`Nothing here for levels ${rangeParam(q.level)}.`);
            return (
              <section key={c.slug} aria-labelledby={`farm-${c.slug}`} data-farm={c.slug}>
                <SectionHeading id={`farm-${c.slug}`} as="h2">{c.label}</SectionHeading>
                {body}
              </section>
            );
          })}
          <section aria-labelledby="farm-elsewhere" data-farm-elsewhere>
            <SectionHeading id="farm-elsewhere" as="h2">Gathering and dungeons</SectionHeading>
            <p className="mb-3 text-cell text-fg-2">Where to gather herbs, ore, leather and cloth is on each profession&apos;s page, and the dungeons have their own list.</p>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ELSEWHERE.map((e) => (
                <li key={e.href}>
                  <Card href={e.href}>
                    <span className="block font-medium text-fg">{e.label}</span>
                    <span className="block text-meta text-fg-2">{e.where}</span>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="mt-8 space-y-4">
          <Contribute
            id="farm-contribute"
            title="Add your farming areas"
            note="Loot mobs with the addon on. The Desktop App uploads what dropped and where when you log out; a zone is listed once 3 players agree on its mobs."
          />
          <div>
            <Disclosure summary="Where do these areas come from?">
              <p>A zone is a gold area when players&apos; uploads place looted mobs in it. The level range is the one players agree on for the mobs there.</p>
            </Disclosure>
            <Disclosure summary="Where did herbs, ore, leather, cloth and dungeons go?">
              <p>
                Gathering moved to the profession pages: herbs to <Link href="/tools/professions/herbalism#gather" className={LINK}>Herbalism</Link>,
                ore to <Link href="/tools/professions/mining#gather" className={LINK}>Mining</Link>, skins and leather
                to <Link href="/tools/professions/skinning#gather" className={LINK}>Skinning</Link>, and cloth
                to <Link href="/tools/professions/tailoring#gather" className={LINK}>Tailoring</Link> and First Aid. The dungeons are
                in <Link href="/database/instances" className={LINK}>Dungeons and raids</Link>, with their levels, entrances and prep pages.
              </p>
            </Disclosure>
          </div>
          <Card className="max-w-xl">
            <EmailCapture toolSlug="farming-routes" />
          </Card>
        </div>
      </article>
    </Container>
  );
}
