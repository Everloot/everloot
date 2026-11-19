import Link from "next/link";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { Card, Container, EmptyState, Field, PageHeader, SectionHeading } from "@/components/ui";
import { armoryOn } from "@/lib/armory";
import { dataAgeLabel } from "@/lib/data-age";
import { guildIndexingOn, guildsOn } from "@/lib/guilds";
import { leaderboardRegion, loadLeaderboards } from "@/lib/leaderboards";
import {
  COLLECTING_LINE, RANKINGS, hubIndexable, hubMetrics, itemListJsonLd, loadRankingWeeks, rankingPath, rankingView, topMovers, weeklyCharacters,
} from "@/lib/rankings";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { BestOfClass, CharacterBoards, GuildBoards, RegionTabs } from "./leaderboards";
import { HowItCounts, MetricTiles, Movers, ONE_WEEK_LINE, RankCard, RankingRail, StackedWeeks, StartState, WeeklyTotals } from "./parts";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "WoW Forever rankings: characters by item level, Gear Score and honorable kills, guilds by gear and raid progress, and the most played classes, races and factions week by week from the Everloot census.";

/** Whether the boards the hub shows may be indexed: never Blizzard's, and the ladder only when the guild pages are. */
const hubBoardsIndexable = () => !armoryOn() && (!guildsOn() || guildIndexingOn());

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata(): Promise<Metadata> {
  const { weeks, unreachable } = await loadRankingWeeks();
  // With the armory on the hub shows Blizzard's boards, which stay out of search engines as every armory page does;
  // the ladder's guild names follow the guild pages' own indexing switch.
  const index = hubBoardsIndexable() && !unreachable && hubIndexable(weeks);
  return {
    ...pageMetadata({ title: "WoW Forever Rankings", description: DESCRIPTION, path: "/rankings" }),
    ...(index ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function RankingsHub(props: { searchParams?: Promise<Search> }) {
  const region = leaderboardRegion(first((await props.searchParams)?.region));
  const [{ weeks, unreachable, dataAsOf }, boards] = await Promise.all([loadRankingWeeks(), loadLeaderboards(region)]);
  const views = RANKINGS.map((def) => rankingView(def, weeks));
  // The hero stacks the class shares: the first ranking, every class with a number in the newest week.
  const classes = views[0];
  const withNumbers = classes.weeksWithNumbers;
  const metrics = hubMetrics(views);
  const leaderboards = boards.characters !== null || boards.guildGear !== null || boards.raids !== null;
  return (
    <Container width="data">
      <article>
        <PageHeader
          title="Rankings"
          lede="Characters by gear and honor, guilds by gear and raid progress, and who plays WoW: Forever week by week."
          meta={!unreachable && <span>{dataAgeLabel(dataAsOf)}</span>}
        />
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {[{ label: "Character name", action: "/players", button: "Find character" }, { label: "Guild name", action: "/guilds", button: "Find guild" }].map((search) => (
              <form key={search.action} action={search.action} method="get" role="search" aria-label={search.button} className="flex items-end gap-2">
                <div className="min-w-0 flex-1"><Field label={search.label} name="q" type="search" maxLength={40} required autoComplete="off" /></div>
                <button type="submit" className="min-h-11 shrink-0 rounded-control border border-edge px-3 text-control text-fg hover:bg-panel">{search.button}</button>
              </form>
            ))}
          </div>
          <RankingRail row />
          {boards.characters !== null && <RegionTabs region={region} />}
          {boards.characters !== null && <BestOfClass rows={boards.bestOfClass} />}
          {boards.characters !== null && <CharacterBoards boards={boards.characters} region={region} />}
          {(boards.guildGear !== null || boards.raids !== null) && <GuildBoards gear={boards.guildGear} raids={boards.raids} region={region} />}
          {boards.characters !== null && <Card>
            <p className="text-fg">Not on the boards? <Link href="/armory/submit" className="underline underline-offset-4">Add your character</Link> or <Link href="/armory/guilds/submit" className="underline underline-offset-4">Add your guild</Link>.</p>
            <p className="mt-1 text-sm text-fg-2">The armory reads Blizzard&apos;s API on its next run, usually within hours.</p>
          </Card>}
          {leaderboards && (
            <SectionHeading id="who-plays" note="From players who turned the census on, each character counted once a week.">Who plays</SectionHeading>
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
              {hubBoardsIndexable() && hubIndexable(weeks) && (
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
