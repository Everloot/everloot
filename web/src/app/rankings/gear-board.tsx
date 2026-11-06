import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Container, DataTable, EmptyState, FilterBar, PageHeader, type Column, type FilterControl } from "@/components/ui";
import {
  BOARD_ROWS, boardHref, boardQuery, GEAR_BOARDS, gearBoardPath, leaderboardsOn, loadGearBoard, rankEntries, updatedLine,
  type BoardQuery, type GearMetric, type RankedEntry,
} from "@/lib/leaderboards";
import { RULESET_LABEL, RULESET_SLUGS } from "@/lib/realms";
import { pageMetadata } from "@/lib/seo";
import { REGIONS } from "@/data/realms";
import { className, raceName } from "@/app/players/player-view";
import { GEAR_SCORE_VERSION } from "../../../../kb/src/gear-score";
import { link, RankingRail, Swatch } from "./parts";

/**
 * The two gear boards, item level and Gear Score: one page each, the same rows ordered by a different number. Named
 * characters, so noindex until indexing of character pages is accepted, and 404 with EVERLOOT_LEADERBOARDS off.
 */

type Search = Record<string, string | string[] | undefined>;

export const UNAVAILABLE_LINE = "The rankings are unavailable right now. Try again in a minute.";
const EMPTY_LINE = "No ranked characters here yet. Link a character, make its page public, turn on gear sync and choose Rank my gear on your account page.";
const RANK_ACTION = { href: "/account#characters", label: "Rank your character" };

export function gearBoardMetadata(metric: GearMetric): Metadata {
  const def = GEAR_BOARDS[metric];
  return {
    ...pageMetadata({ title: `WoW Forever ${def.title} Rankings`, description: def.description, path: gearBoardPath(metric) }),
    robots: { index: false, follow: true },
  };
}

function controls(metric: GearMetric, q: BoardQuery): FilterControl[] {
  const href = (over: Partial<BoardQuery>) => boardHref(metric, { ...q, ...over });
  return [
    {
      type: "menu", key: "ruleset", label: "Ruleset",
      options: [
        { label: "All rulesets", href: href({ ruleset: null }), on: !q.ruleset, reset: true },
        ...RULESET_SLUGS.filter((r) => r !== "hardcore").map((r) => ({ label: RULESET_LABEL[r], href: href({ ruleset: r }), on: q.ruleset === r })),
      ],
    },
    {
      type: "menu", key: "region", label: "Region",
      options: [
        { label: "All regions", href: href({ region: null }), on: !q.region, reset: true },
        ...REGIONS.map((r) => ({ label: r.toUpperCase(), href: href({ region: r }), on: q.region === r })),
      ],
    },
  ];
}

function BoardTable({ rows, metric, caption }: { rows: RankedEntry[]; metric: GearMetric; caption: string }) {
  const main = metric === "item-level" ? "itemLevel" : "gearScore";
  const other = metric === "item-level" ? "gearScore" : "itemLevel";
  const otherTitle = GEAR_BOARDS[metric === "item-level" ? "gear-score" : "item-level"].column;
  const columns: Column<RankedEntry>[] = [
    {
      key: "name", header: "Character",
      cell: ({ rank, entry: e }) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-8 shrink-0 text-right font-mono tabular-nums text-muted">{rank}</span>
          <Swatch classToken={e.class} />
          <Link href={e.path} className={`${link} font-medium`}>{e.name}</Link>
          <span className="truncate text-fg-2">{e.level} {raceName(e.race)} {className(e.class)}</span>
        </span>
      ),
    },
    {
      key: "realm", header: "Realm",
      cell: ({ entry: e }) => (
        <span className="text-fg-2">{e.realmBase}{e.ruleset && <span className="ml-1.5 text-muted">{RULESET_LABEL[e.ruleset]}</span>}</span>
      ),
    },
    { key: main, header: GEAR_BOARDS[metric].column, numeric: true, cell: ({ entry: e }) => <span className="font-medium text-fg">{e[main]}</span> },
    { key: other, header: otherTitle, numeric: true, cell: ({ entry: e }) => <span className="text-fg-2">{e[other]}</span> },
    { key: "date", header: "Gear from", numeric: true, cell: ({ entry: e }) => e.capturedAt.slice(0, 10) },
  ];
  return (
    <DataTable
      dense
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.entry.path}
      meta={({ entry: e }) => [`${GEAR_BOARDS[metric].column} ${e[main]}`, `${otherTitle} ${e[other]}`, e.realmBase, `gear from ${e.capturedAt.slice(0, 10)}`].join(" · ")}
    />
  );
}

export async function GearBoardPage({ metric, searchParams }: { metric: GearMetric; searchParams?: Promise<Search> }) {
  if (!leaderboardsOn()) notFound();
  const q = boardQuery((await searchParams) ?? {});
  if (!q) notFound();
  const def = GEAR_BOARDS[metric];
  const path = gearBoardPath(metric);
  const board = await loadGearBoard();
  const ranked = board.state === "ready" ? rankEntries(board.entries, metric, q) : [];
  const active = [q.ruleset, q.region].filter(Boolean).length;
  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: "Rankings", path: "/rankings" }, { name: def.title, path }]}
          title={def.title}
          lede={def.lede}
          meta={board.state === "ready" && (
            <time dateTime={board.generatedAt} title={`${board.generatedAt.slice(0, 16).replace("T", " ")} UTC`}>{updatedLine(board.generatedAt)}</time>
          )}
        />
        <div className="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-6">
          <RankingRail current={path} />
          <div className="min-w-0 space-y-4">
            {board.state === "unavailable" ? (
              <Card><p className="text-fg-2">{UNAVAILABLE_LINE}</p></Card>
            ) : (
              <>
                <FilterBar label="Ranking filters" controls={controls(metric, q)} active={active} clearHref={path} />
                {ranked.length === 0 ? (
                  <EmptyState message={EMPTY_LINE} action={RANK_ACTION} />
                ) : (
                  <BoardTable rows={ranked.slice(0, BOARD_ROWS)} metric={metric} caption={`${def.title}, top ${Math.min(BOARD_ROWS, ranked.length)}`} />
                )}
                {board.notCounted > 0 && (
                  <p className="text-meta text-muted">
                    Not counted: {board.notCounted} {board.notCounted === 1 ? "character" : "characters"} whose gear holds an item the game
                    files do not list yet, an item level that differs from the files, or an item in a slot it cannot go in.
                  </p>
                )}
              </>
            )}
            <Card as="section" aria-labelledby="how-gear-counts" className="space-y-2 text-sm text-fg-2">
              <h2 id="how-gear-counts" className="text-h2-sm text-fg">How it counts</h2>
              <p>
                Only characters their player linked to an Everloot account, with the page public, gear sync on and Rank my gear
                turned on. The gear is what the player&apos;s own addon last sent, in the last 30 days, and it is checked against the
                game files: each item&apos;s level is the files&apos; level. It is not checked with Blizzard. The boards are scored
                every 30 minutes; turning any of those off takes a character off at once.
              </p>
              <p>
                Item level and Gear Score ({GEAR_SCORE_VERSION}) are both averages over 17 slots, shirt and tabard left out, an empty
                slot counting 0. <Link href="/methodology#gear-rankings" className={link}>The formula and its weights</Link>.
              </p>
            </Card>
          </div>
        </div>
      </article>
    </Container>
  );
}
