import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { Card, Container, EmptyState, PageHeader, SectionHeading } from "@/components/ui";
import { armoryOn } from "@/lib/armory";
import { dataAgeLabel } from "@/lib/data-age";
import {
  COLLECTING_LINE, RANKINGS, hubIndexable, hubMetrics, itemListJsonLd, loadRankingWeeks, rankingPath, rankingView, topMovers, weeklyCharacters,
} from "@/lib/rankings";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { HowItCounts, MetricTiles, Movers, ONE_WEEK_LINE, RankCard, RankingRail, StackedWeeks, StartState, WeeklyTotals } from "./parts";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "WoW Forever rankings by week: the most played classes, races and the faction balance from the Everloot census, with each rank's change against last week.";

export async function generateMetadata(): Promise<Metadata> {
  const { weeks, unreachable } = await loadRankingWeeks();
  const index = !unreachable && hubIndexable(weeks);
  return {
    ...pageMetadata({ title: "WoW Forever Rankings", description: DESCRIPTION, path: "/rankings" }),
    ...(index ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function RankingsHub() {
  const { weeks, unreachable, dataAsOf } = await loadRankingWeeks();
  const views = RANKINGS.map((def) => rankingView(def, weeks));
  // The hero stacks the class shares: the first ranking, every class with a number in the newest week.
  const classes = views[0];
  const withNumbers = classes.weeksWithNumbers;
  const metrics = hubMetrics(views);
  return (
    <Container width="data">
      <article>
        <PageHeader
          title="Rankings"
          lede="WoW: Forever week by week, from players who turned the census on."
          meta={!unreachable && <span>{dataAgeLabel(dataAsOf)}</span>}
        />
        <div className="space-y-6">
          <RankingRail row />
          {armoryOn() && (
            <p className="text-sm text-fg-2">
              Characters ranked by item level, Gear Score and honorable kills from Blizzard&apos;s API are in the{" "}
              <Link href="/armory/rankings/item-level" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">armory rankings</Link>.
            </p>
          )}
          {unreachable ? (
            <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
          ) : weeks.length === 0 ? (
            <StartState />
          ) : (
            <>
              {metrics && <MetricTiles m={metrics} />}
              {withNumbers === 1 && <p className="text-cell text-muted">{ONE_WEEK_LINE}</p>}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
                <Card as="section" aria-labelledby="weekly-totals">
                  <SectionHeading id="weekly-totals" note="Each character counts once a week, from Monday to Sunday, UTC.">Characters counted each week</SectionHeading>
                  {withNumbers >= 1 ? <WeeklyTotals points={weeklyCharacters(weeks)} /> : <EmptyState framed={false} count={classes.week?.window.installs} message={COLLECTING_LINE} />}
                </Card>
                <Card as="section" aria-labelledby="movers">
                  <SectionHeading id="movers" note="The rows whose rank changed most against last week, in every ranking.">Top movers</SectionHeading>
                  {withNumbers >= 2 && classes.previous ? <Movers movers={topMovers(views)} /> : <EmptyState framed={false} message={ONE_WEEK_LINE} />}
                </Card>
              </div>
              {withNumbers >= 1 && classes.week && (
                <section aria-labelledby="by-class">
                  <SectionHeading id="by-class" note="Each class's part of the characters counted that week, from the oldest week shown to this one so far.">
                    Share of each week&apos;s characters by class
                  </SectionHeading>
                  <StackedWeeks
                    weeks={weeks}
                    series={classes.series}
                    hidden={classes.rows.some((r) => r.count === null)}
                    title={`Share of each week's characters by class, ${classes.series.length} classes`}
                  />
                </section>
              )}
              <div className="grid gap-4 md:grid-cols-2 lg:gap-6">
                {views.map((view) => <RankCard key={view.def.slug} view={view} />)}
              </div>
              {hubIndexable(weeks) && (
                <JsonLd data={itemListJsonLd("WoW Forever rankings", "/rankings", RANKINGS.map((r) => ({ name: r.title, path: rankingPath(r.slug) })))} />
              )}
            </>
          )}
          <HowItCounts />
        </div>
      </article>
    </Container>
  );
}
