import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { dataAgeLabel } from "@/lib/data-age";
import { loadCensus } from "@/lib/rollup-compute";
import { REPO_URL } from "@/lib/source";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { trailFor } from "@/lib/breadcrumbs";
import { playerPagesOn } from "@/lib/player-pages";
import { PLAYER_PAGE_SHOWS } from "../players/player-view";
import { Card, Container, DataTable, EmptyState, Explainer, Input, LinkTabs, PageHeader, SectionHeading, type Column } from "@/components/ui";
import {
  CENSUS_CLASSES, CENSUS_RACES, FACTIONS, HIDDEN_LABEL, HIDDEN_MEANING, LEVEL_BANDS, type CensusCount, type CensusView, type CensusWindow,
} from "../../../../kb/src/census";

const description =
  "Who plays what on WoW Forever: factions, races, classes and levels from Everloot uploads. Each character counts once; a count shows from 10 characters.";

export const metadata: Metadata = pageMetadata({ title: "WoW Forever Census: Races, Classes and Levels", description, path: "/census" });
export const dynamic = "force-dynamic";

const link = "text-accent hover:underline underline-offset-4";
const CLASS_NAME = new Map<string, string>(CENSUS_CLASSES.map((c) => [c.token, c.name]));
const RACE_NAME = new Map<string, string>(CENSUS_RACES.map((r) => [r.token, r.name]));
const day = (iso: string) => iso.slice(0, 10);
const number = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${number(n)} ${n === 1 ? one : many}`;
/** A share of the shown total, both rounded already; a whole percent claims no more than the counts do. */
const percent = (count: number, total: number) => `${Math.round((count / total) * 100)}%`;

function Count({ count }: { count: CensusCount }) {
  return count === null ? <span className="text-muted">{HIDDEN_LABEL}</span> : <>{number(count)}</>;
}

type Row = { key: string; label: string; count: CensusCount };

/** One slice: a row per group with its count and its share of the window's characters. */
function CountTable({ id, title, item, rows, total }: { id: string; title: string; item: string; rows: Row[]; total: number }) {
  const columns: Column<Row>[] = [
    { key: "label", header: item, cell: (row) => <span className="font-medium">{row.label}</span> },
    { key: "count", header: "Characters", numeric: true, cell: (row) => <Count count={row.count} /> },
    {
      key: "share",
      header: "Share",
      cell: (row) => row.count !== null && (
        <div className="flex min-w-32 items-center gap-3">
          <span className="w-10 text-right font-mono tabular-nums">{percent(row.count, total)}</span>
          <div aria-hidden="true" className="h-1 flex-1 rounded-full bg-line">
            <div className="h-1 rounded-full bg-fg-2" style={{ width: percent(row.count, total) }} />
          </div>
        </div>
      ),
    },
  ];
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id}>{title}</SectionHeading>
      <DataTable caption={`${title}: characters and share of all characters in the window`} columns={columns} rows={rows} rowKey={(row) => row.key} />
    </section>
  );
}

/** Blizzard's race and class table for one faction (as on /wow-forever), with the census count in each playable cell. */
function RaceClassGrid({ faction, window: w }: { faction: string; window: CensusWindow }) {
  const races = CENSUS_RACES.filter((r) => r.faction === faction);
  const count = (race: string, cls: string) => w.raceClass.find((c) => c.faction === faction && c.race === race && c.class === cls);
  const columns: Column<(typeof races)[number]>[] = [
    { key: "race", header: "Race", nowrap: true, cell: (race) => <span className="font-medium">{race.name}</span> },
    ...CENSUS_CLASSES.map((c): Column<(typeof races)[number]> => ({
      key: c.token,
      header: c.name,
      numeric: true,
      cell: (race) => {
        const cell = count(race.token, c.token);
        return !cell ? <span className="sr-only">Not playable</span>
          : cell.count === null ? <><span aria-hidden="true" className="text-muted">&mdash;</span><span className="sr-only">{HIDDEN_LABEL}</span></>
          : number(cell.count);
      },
    })),
  ];
  return (
    <div>
      <SectionHeading as="h3">{faction}</SectionHeading>
      <DataTable caption={`${faction} races and classes`} columns={columns} rows={races} rowKey={(race) => race.token} />
    </div>
  );
}

function TakePart() {
  return (
    <p>
      The addon records the census from a new install; an older one needs <code className="font-mono text-fg">/everloot census on</code> in
      the game. Play, log out, and the Desktop App sends it if you allowed the census there, or send your save file from
      the <Link href="/upload" className={link}>upload page</Link>, whose preview shows the counts before anything is sent.
    </p>
  );
}

/** The way into the player pages, shown only while the owner's switch has them on. */
function LookUpPlayer() {
  return (
    <Card as="section" aria-labelledby="look-up" className="space-y-3">
      <SectionHeading id="look-up">Look up a player</SectionHeading>
      <form action="/players" method="get" role="search" className="flex max-w-xl flex-col gap-2 sm:flex-row">
        <label htmlFor="census-player-q" className="sr-only">Character name</label>
        <Input id="census-player-q" name="q" type="search" maxLength={40} autoComplete="off" placeholder="Start of a character's name" className="flex-1" />
        <button type="submit" className="btn btn-primary min-h-11">Find</button>
      </form>
      <p className="text-sm text-fg-2">{PLAYER_PAGE_SHOWS}</p>
      <p className="text-sm"><Link href="/players/opt-out" className={link}>Hide your character</Link></p>
    </Card>
  );
}

const WINDOWS = [
  { id: "week", label: "Last 7 days", href: "/census" },
  { id: "launch", label: "Since launch", href: "/census?window=launch" },
] as const;

/** The census counting rule, word for word as the page has always stated it. */
const ruleOf = (view: CensusView) =>
  `Each character counts once, and a number shows only when it covers at least ${view.rule.minCharacters} characters reported by at least ${view.rule.minInstalls} installs from at least ${view.rule.minReporters} addresses, rounded to the nearest ${view.rule.roundTo}.`;

/** The top of the page's content: an EmptyState until the window has numbers, then one sentence. */
function Headline({ view, window: w }: { view: CensusView; window: CensusWindow }) {
  const span = `(${day(w.from)} to ${day(w.to)}, UTC)`;
  if (!view.launched) {
    return (
      <EmptyState
        message={`WoW: Forever hasn't launched yet. The census starts counting at launch, ${day(view.launch)} at ${view.launch.slice(11, 16)} UTC, and nothing from before it, such as the beta, is counted.`}
      />
    );
  }
  if (w.collecting) {
    return (
      <EmptyState
        count={w.installs}
        message={`Still collecting: the census shows numbers once the window ${span} has at least ${view.rule.minCharacters} characters reported by at least ${view.rule.minInstalls} installs from at least ${view.rule.minReporters} addresses.`}
      />
    );
  }
  return (
    <p className="max-w-[65ch] text-lg text-fg-2">
      About {number(w.characters!)} characters were {w.id === "week" ? "active in the last 7 days" : "seen since launch"} {span},
      counted from {plural(w.installs, "install", "installs")} that turned the census on.
    </p>
  );
}

export default async function CensusPage({ searchParams }: { searchParams?: Promise<{ window?: string }> }) {
  const chosen = (await searchParams)?.window === "launch" ? "launch" : "week";
  const { view, unreachable, dataAsOf } = await loadCensus();
  const w = view?.windows[chosen];
  const ready = !unreachable && view && w;
  return (
    <Container width="wide">
      <article>
        <PageHeader
          trail={trailFor("/census")!}
          title="Who plays what on WoW: Forever"
          lede="Counted from Everloot uploads by players who turned the census on: their own characters and the players they target, mouse over or group with."
          meta={<>
            <span className="font-mono text-xs">
              {!ready ? "Storage unreachable"
                : !view.launched ? "Not launched yet"
                : plural(w.installs, "reporting install", "reporting installs")}
            </span>
            {!unreachable && <span>{dataAgeLabel(dataAsOf)}</span>}
          </>}
        />

        {playerPagesOn() && <div className="mb-12"><LookUpPlayer /></div>}

        {!ready ? (
          <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
        ) : (
          <div className="space-y-12">
            <div className="space-y-6">
              {view.launched && (
                <LinkTabs
                  label="Census window"
                  tabs={WINDOWS.map((option) => ({ href: option.href, label: option.label, current: option.id === chosen }))}
                />
              )}
              <Headline view={view} window={w} />
            </div>

            {!w.collecting && (
              <>
                <CountTable id="factions" title="Factions" item="Faction" total={w.characters!} rows={FACTIONS.map((f) => ({ key: f, label: f, count: w.factions.find((x) => x.faction === f)!.count }))} />
                <CountTable id="classes" title="Classes" item="Class" total={w.characters!} rows={w.classes.map((c) => ({ key: c.class, label: CLASS_NAME.get(c.class)!, count: c.count }))} />
                <CountTable id="races" title="Races" item="Race" total={w.characters!} rows={w.races.map((r) => ({ key: `${r.faction}/${r.race}`, label: `${RACE_NAME.get(r.race)} (${r.faction})`, count: r.count }))} />
                <section aria-labelledby="grid" className="space-y-6">
                  <SectionHeading
                    id="grid"
                    note={<>Blizzard&apos;s race and class tables from <Link href="/wow-forever" className={link}>What is WoW: Forever</Link>, with the characters in each playable combination. A dash is a hidden count.</>}
                  >
                    Race and class
                  </SectionHeading>
                  {FACTIONS.slice().reverse().map((f) => <RaceClassGrid key={f} faction={f} window={w} />)}
                </section>
                <CountTable id="levels" title="Level bands" item="Level band" total={w.characters!} rows={LEVEL_BANDS.map((b) => ({ key: b.id, label: b.label, count: w.levels.find((l) => l.band === b.id)!.count }))} />
              </>
            )}

            {/* The trend comes from the 7-day window, so it shows once that window has numbers, whichever window is chosen. */}
            {!view.windows.week.collecting && (
              <section aria-labelledby="trend">
                <SectionHeading id="trend" note="Characters active each UTC day, under the same rule.">The last 7 days, day by day</SectionHeading>
                <DataTable
                  caption="Characters active each day of the last 7 days"
                  columns={[
                    { key: "day", header: "Day (UTC)", cell: (d) => <span className="font-mono tabular-nums">{d.day}</span> },
                    { key: "count", header: "Characters", numeric: true, cell: (d) => <Count count={d.count} /> },
                  ]}
                  rows={view.trend}
                  rowKey={(d) => d.day}
                />
              </section>
            )}
          </div>
        )}

        <Explainer summary="How the census counts">
          <p>
            Only race, class, level and faction are kept. Names are never read for anyone else, and no character id is stored
            or published.
          </p>
          {ready && (
            <>
              <p>{ruleOf(view)} <Link href="/methodology#population" className={link}>How we count</Link>.</p>
              {!w.collecting && <p>&ldquo;{HIDDEN_LABEL}&rdquo; means {HIDDEN_MEANING}.</p>}
              {!w.collecting && <BiasLine window={w} />}
            </>
          )}
          <TakePart />
          <p>
            Census rows are never published one by one, only these counts. How Everloot collects and publishes data is in the{" "}
            <a href={`${REPO_URL}/blob/main/docs/DATA_POLICY.md`} rel="noopener" className={link}>data policy</a>.
          </p>
        </Explainer>
      </article>
    </Container>
  );
}

/** Where the characters came from, so readers can judge the lean of each source (spec §6). */
function BiasLine({ window: w }: { window: CensusWindow }) {
  const { own, seen } = w.bias;
  return (
    <p>
      {own !== null && seen !== null
        ? `Known from: ${percent(seen, own + seen)} players seen by uploaders, ${percent(own, own + seen)} uploaders' own characters. `
        : `Known from: players seen by uploaders ${seen === null ? HIDDEN_LABEL : `about ${number(seen)}`}, uploaders' own characters ${own === null ? HIDDEN_LABEL : `about ${number(own)}`}. `}
      Seen players lean toward the zones uploaders play in; own characters lean toward people who install addons.
    </p>
  );
}
