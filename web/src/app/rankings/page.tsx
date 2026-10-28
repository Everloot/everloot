import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { Card, Container, PageHeader, SectionHeading } from "@/components/ui";
import { dataAgeLabel } from "@/lib/data-age";
import { RANKINGS, hubIndexable, itemListJsonLd, loadRankingWeeks, rankingPath, rankingView } from "@/lib/rankings";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { HowItCounts, ONE_WEEK_LINE, RankCard, RankingRail, StackedWeeks, StartState } from "./parts";

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
          {unreachable ? (
            <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
          ) : weeks.length === 0 ? (
            <StartState />
          ) : (
            <>
              {withNumbers === 1 && <p className="text-cell text-muted">{ONE_WEEK_LINE}</p>}
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
