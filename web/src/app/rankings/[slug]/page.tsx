import type { Metadata } from "next";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { Card, Container, EmptyState, FilterBar, PageHeader, type FilterControl } from "@/components/ui";
import { dataAgeLabel } from "@/lib/data-age";
import {
  COLLECTING_LINE, isFiltered, itemListJsonLd, loadRankingWeeks, rankedCount, rankingDef, rankingHref,
  rankingIndexable, rankingPath, rankingView, type RankingQuery, type RankingView,
} from "@/lib/rankings";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { CENSUS_CLASSES, FACTIONS } from "../../../../../kb/src/census";
import { HowItCounts, OneWeek, RankTable, RankingRail, StartState, WeeklyChart, weekLabel } from "../parts";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<Search> };

/** Filtered and past-week views are noindex; every view's canonical is the unfiltered page (pageMetadata's path). */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const def = rankingDef((await params).slug);
  if (!def) return {};
  const { weeks, unreachable } = await loadRankingWeeks();
  const view = rankingView(def, weeks, (await searchParams) ?? {});
  const index = !unreachable && rankingIndexable(view);
  return {
    ...pageMetadata({ title: `WoW Forever ${def.title}`, description: def.description, path: rankingPath(def.slug) }),
    ...(index ? {} : { robots: { index: false, follow: true } }),
  };
}

/** The filter strip: the week picker, plus faction and class where the ranking offers them. */
function filterControls(view: RankingView): FilterControl[] {
  const { def, query: q, weeks } = view;
  const href = (over: Partial<RankingQuery>) => rankingHref(def.slug, { ...q, ...over });
  const controls: FilterControl[] = [{
    type: "menu", key: "week", label: "Week",
    options: [...weeks].reverse().map((w) => ({ label: weekLabel(w), href: href({ week: w === view.week && !q.week ? undefined : w.start }), on: w === view.week && Boolean(q.week) })),
  }];
  if (def.filters.includes("faction")) {
    controls.push({
      type: "menu", key: "faction", label: "Faction",
      options: [
        { label: "Both", href: href({ faction: undefined }), on: !q.faction, reset: true },
        ...FACTIONS.map((f) => ({ label: f, href: href({ faction: f }), on: q.faction === f })),
      ],
    });
  }
  if (def.filters.includes("class")) {
    controls.push({
      type: "menu", key: "class", label: "Class",
      options: [
        { label: "All classes", href: href({ class: undefined }), on: !q.class, reset: true },
        ...CENSUS_CLASSES.map((c) => ({ label: c.name, href: href({ class: c.token }), on: q.class === c.token })),
      ],
    });
  }
  return controls;
}

export default async function RankingPage({ params, searchParams }: Props) {
  const def = rankingDef((await params).slug);
  if (!def) notFound();
  const { weeks, unreachable, dataAsOf } = await loadRankingWeeks();
  const view = rankingView(def, weeks, (await searchParams) ?? {});
  const q = view.query;
  const path = rankingPath(def.slug);
  const active = [q.faction, q.class, q.week].filter(Boolean).length;
  const week = view.week;
  const ranked = view.rows.filter((r) => r.rank !== null);
  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: "Rankings", path: "/rankings" }, { name: def.title, path }]}
          title={def.title}
          lede={def.lede}
          meta={!unreachable && <span>{dataAgeLabel(dataAsOf)}</span>}
        />
        <div className="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-6">
          <RankingRail current={path} />
          <div className="min-w-0 space-y-4">
            {unreachable ? (
              <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
            ) : !week ? (
              <StartState />
            ) : (
              <>
                <FilterBar
                  label="Ranking filters"
                  controls={filterControls(view)}
                  active={active}
                  clearHref={path}
                  aside={<span className="text-meta text-muted">{weekLabel(week)}</span>}
                />
                {view.weeksWithNumbers >= 2 ? (
                  <WeeklyChart weeks={weeks} series={view.series} title={`${def.title}: share of each week's characters, top ${view.series.length}`} />
                ) : (
                  <OneWeek />
                )}
                {week.window.collecting ? (
                  <EmptyState count={week.window.installs} message={COLLECTING_LINE} />
                ) : (
                  <RankTable rows={view.rows} caption={`${def.title}, ${weekLabel(week)}`} showChange={view.previous !== null} asOf={week.to} />
                )}
                {!isFiltered(q) && rankedCount(view.rows) > 0 && (
                  <JsonLd data={itemListJsonLd(`WoW Forever ${def.title}`, path, ranked.map((r) => ({ name: r.sub ? `${r.label} (${r.sub})` : r.label })))} />
                )}
              </>
            )}
            <HowItCounts />
          </div>
        </div>
      </article>
    </Container>
  );
}
