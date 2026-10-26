import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CLASSES, LAUNCH, longDate, NEW_COMBOS, RACES } from "@/data/wow-forever";
import { DATES, POSTS, RULESETS, RULESETS_POST, hasLaunched, windowAt, type BluePostRef } from "@/data/wow-forever-launch";
import { latestBuildLine } from "@/lib/changes-facts";
import { loadTimeline, postPath } from "@/lib/changes";
import { pageMetadata } from "@/lib/seo";
import JsonLd from "@/components/JsonLd";
import { videoGamePageJsonLd } from "@/lib/jsonld";
import { trailFor } from "@/lib/breadcrumbs";
import { emblems, loadSiteAssets } from "@/lib/game-assets";
import GameIcon from "@/components/game/GameIcon";
import { Card, Container, DataTable, PageHeader, SectionHeading, type Column } from "@/components/ui";

const description =
  "WoW Forever is Blizzard's World of Warcraft: Forever: launch date, checklist, rulesets, FAQ, race and class combinations, latest build.";

/** Rebuilt hourly so the checklist moves on at launch without a deploy. */
export const revalidate = 3600;

const title = "What Is WoW Forever? Launch Date and Latest Build";

export const metadata: Metadata = pageMetadata({ title, description, path: "/wow-forever" });

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const isNew = (race: string, cls: string) => NEW_COMBOS.some(([r, c]) => r === race && c === cls);

/** "October 27" from an ISO day: the posts give no year, so none is shown. */
const monthDay = (iso: string) => longDate(iso).replace(/, \d{4}$/, "");

const postLink = (ref: BluePostRef) => <Link href={postPath(ref)!} className={link}>Blizzard post: {ref.title}</Link>;

const NAMES_STATUS = { before: "Not open yet.", open: "Open now.", closed: "Closed." } as const;

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "When does WoW: Forever launch?",
    a: <>{longDate(LAUNCH.date)}, at 3:00 p.m. PST, in Blizzard&apos;s announcement quoted above. <a href={LAUNCH.sourceUrl} rel="noopener" className={link}>{LAUNCH.sourceName}, {LAUNCH.sourceTitle}</a>.</>,
  },
  {
    q: "When can I reserve character names, and how many?",
    a: <>From {monthDay(DATES.namesOpen)} through {monthDay(DATES.namesClose)}, for up to three characters. The post Everloot holds gives no start time, so read Blizzard&apos;s own post for that. {postLink(POSTS.names)}.</>,
  },
  {
    q: "Is there a realm list?",
    a: <>No. You pick a ruleset instead of a realm, and each ruleset works like one large player pool. See <a href="#rulesets" className={link}>the rulesets table</a> and <Link href={RULESETS_POST.path} className={link}>Rulesets explained</Link>.</>,
  },
  {
    q: "Can I change my ruleset later?",
    a: <>Not by switching: playing on another ruleset means a new character. The exception is Hardcore, where a dead character can move to another ruleset. <Link href={RULESETS_POST.path} className={link}>Rulesets explained</Link>.</>,
  },
  {
    q: "Is RP-PvP there at launch?",
    a: <>Yes. RP-PvP arrives at launch on November 4, and Blizzard plans to offer it during name reservations. <Link href={RULESETS_POST.path} className={link}>Rulesets explained</Link>.</>,
  },
  {
    q: "When does Hardcore start?",
    a: <>Sometime after launch. Everloot holds no date for it. <Link href={RULESETS_POST.path} className={link}>Rulesets explained</Link>.</>,
  },
  {
    q: "When do the raids open?",
    a: <>Barrow Deeps, Hyjal Summit and Onyxia&apos;s Lair unlock on {monthDay(DATES.raids)}. Onyxia&apos;s Lair needs the Drakefire Amulet. {postLink(POSTS.raids)}.</>,
  },
  {
    q: "Is the beta still running?",
    a: <>No. Blizzard closed it on {monthDay(DATES.betaClosed)}. {postLink(POSTS.betaClosed)}.</>,
  },
];

const rulesetColumns: Column<(typeof RULESETS)[number]>[] = [
  { key: "name", header: "Ruleset", nowrap: true, cell: (r) => <span className="font-medium">{r.name}</span> },
  { key: "what", header: "What it is", cell: (r) => r.what },
  { key: "when", header: "When", cell: (r) => r.when },
];

type RaceRow = { race: string; classes: readonly string[] };

/** `icons`: the game's race and faction emblems by name (lib/game-assets.ts), empty without the asset URL. */
function RaceTable({ faction, rows, icons }: { faction: string; rows: Record<string, readonly string[]>; icons: ReturnType<typeof emblems> }) {
  const factionIcon = icons.factions.get(faction);
  const columns: Column<RaceRow>[] = [
    {
      key: "race",
      header: "Race",
      nowrap: true,
      cell: (r) => {
        const icon = icons.races.get(r.race);
        return <span className="inline-flex items-center gap-2 font-medium">{icon && <GameIcon src={icon} size={24} />}{r.race}</span>;
      },
    },
    ...CLASSES.map((c): Column<RaceRow> => ({
      key: c,
      header: c,
      cell: (r) => (
        <span className="block text-center">
          {!r.classes.includes(c) ? <span className="sr-only">Not playable</span>
            : isNew(r.race, c) ? <span className="font-semibold text-accent">New</span>
            : <><span className="sr-only">Playable</span><span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-fg-2" /></>}
        </span>
      ),
    })),
  ];
  return (
    <div>
      <SectionHeading as="h3">
        <span className="inline-flex items-center gap-2">{factionIcon && <GameIcon src={factionIcon} size={24} />}{faction}</span>
      </SectionHeading>
      <DataTable
        caption={`${faction}: races and the classes each can play`}
        columns={columns}
        rows={Object.entries(rows).map(([race, classes]) => ({ race, classes }))}
        rowKey={(r) => r.race}
      />
    </div>
  );
}

export default async function WowForeverPage() {
  // The game's race and faction emblems beside the names, only when the asset URL is set and the upload has them.
  const assets = await loadSiteAssets();
  const icons = emblems(assets);
  const now = new Date();
  const launched = hasLaunched(now);
  const names = windowAt(now, DATES.namesOpen, DATES.namesClose);
  const step = "font-semibold text-fg";
  return (
    <Container width="reading">
      <JsonLd data={videoGamePageJsonLd({ name: title, description, path: "/wow-forever", source: { title: LAUNCH.sourceTitle, url: LAUNCH.sourceUrl } })} />
      <PageHeader
        title="What is WoW: Forever?"
        lede="WoW: Forever is short for World of Warcraft: Forever, the Blizzard release Everloot follows."
        trail={trailFor("/wow-forever")!}
      />

      <div className="space-y-12">
        <p className="text-fg-2">
          Everloot is a fan project and is not affiliated with or endorsed by Blizzard Entertainment, so anything official is
          Blizzard&apos;s to say. This page points at what they have said.
        </p>

        <section aria-labelledby="launch">
          <SectionHeading id="launch">When does WoW: Forever launch?</SectionHeading>
          <div className="space-y-4">
            <p className="text-fg-2">
              Blizzard&apos;s announcement gives the date as {longDate(LAUNCH.date)}. This is the sentence, word for word:
            </p>
            <blockquote className="border-l-2 border-accent pl-4 text-lg text-fg">&ldquo;{LAUNCH.quote}&rdquo;</blockquote>
            <p className="text-sm text-muted">
              Source: <a href={LAUNCH.sourceUrl} rel="noopener" className={link}>{LAUNCH.sourceName}, {LAUNCH.sourceTitle}</a>.
              Checked on <time dateTime={LAUNCH.checkedOn}>{longDate(LAUNCH.checkedOn)}</time>. If Blizzard changes the date, their post is
              the one to trust.
            </p>
          </div>
        </section>

        <section aria-labelledby="checklist">
          <SectionHeading id="checklist" note="Each dated step is from a Blizzard post Everloot holds.">
            {launched ? "Launch week checklist" : "Before launch"}
          </SectionHeading>
          <Card>
            <ol className="list-decimal space-y-3 pl-6 text-fg-2">
              <li>
                <span className={step}>Name reservations, {monthDay(DATES.namesOpen)} through {monthDay(DATES.namesClose)}.</span>{" "}
                {NAMES_STATUS[names]} Up to three characters. {postLink(POSTS.names)}.
              </li>
              <li>
                <span className={step}>Pick a ruleset first.</span> There is no realm list, and playing on another ruleset later means a new
                character. See <a href="#rulesets" className={link}>the rulesets</a>.
              </li>
              <li>
                <span className={step}>Set your preferred online language.</span> It is in Options, under Languages and Social, and has a
                24-hour cooldown. <Link href={RULESETS_POST.path} className={link}>Rulesets explained</Link>.
              </li>
              <li>
                <span className={step}>Plan a talent build.</span> Try one in the <Link href="/tools/talents" className={link}>Talent calculator</Link>.
                Its trees and rules are unconfirmed beta data.
              </li>
              <li>
                <span className={step}>Install the Everloot addon.</span> It is on <Link href="/addons" className={link}>Addons</Link> and
                collects what players see in game.
              </li>
              <li>
                <span className={step}>{launched ? "Launch" : "Launch day"}, {longDate(LAUNCH.date)}, 3:00 p.m. PST.</span>{" "}
                {launched ? "WoW: Forever has launched." : "RP-PvP arrives with it."}{" "}
                <a href={LAUNCH.sourceUrl} rel="noopener" className={link}>{LAUNCH.sourceName}</a>.
              </li>
              {launched && (
                <li>
                  <span className={step}>{monthDay(DATES.raids)}, the level 60 raids.</span> Barrow Deeps, Hyjal Summit and Onyxia&apos;s Lair
                  unlock. {postLink(POSTS.raids)}.
                </li>
              )}
            </ol>
          </Card>
        </section>

        <section aria-labelledby="rulesets">
          <SectionHeading
            id="rulesets"
            note="There is no realm list. A ruleset works like one large player pool: you group, run dungeons and raid with players on your own ruleset."
          >
            Which rulesets are there?
          </SectionHeading>
          <div className="space-y-4">
            <Card padding="none">
              <DataTable caption="WoW: Forever rulesets" columns={rulesetColumns} rows={[...RULESETS]} rowKey={(r) => r.name} />
            </Card>
            <p className="text-sm text-muted">
              Detail, and what to decide before name reservations: <Link href={RULESETS_POST.path} className={link}>Rulesets explained</Link>,
              which follows Blizzard&apos;s <a href={RULESETS_POST.blizzardUrl} rel="noopener" className={link}>{RULESETS_POST.blizzardTitle}</a>.
              Battlegrounds can mix rulesets, except Hardcore.
            </p>
          </div>
        </section>

        <section aria-labelledby="faq">
          <SectionHeading id="faq">Questions players ask</SectionHeading>
          <div className="space-y-6">
            {FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="font-semibold text-fg">{f.q}</h3>
                <p className="mt-1 text-fg-2">{f.a}</p>
              </div>
            ))}
            <p className="text-sm text-muted">Anything a Blizzard post Everloot holds does not say is left out, not guessed.</p>
          </div>
        </section>

        <section aria-labelledby="races">
          <SectionHeading
            id="races"
            note="Ten race rows across the two factions. Skyborne, the new race, plays on both: Horde Skyborne can be Shamans and Alliance Skyborne can be Mages."
          >
            Which races and classes can you play?
          </SectionHeading>
          <div className="space-y-8">
            {Object.entries(RACES.factions).map(([faction, rows]) => <RaceTable key={faction} faction={faction} rows={rows} icons={icons} />)}
            <p className="text-sm text-muted">
              <span className="font-semibold text-accent">New</span> marks the combinations Blizzard names as new in WoW: Forever.
              Source: <a href={RACES.sourceUrl} rel="noopener" className={link}>{RACES.sourceName}, {RACES.sourceTitle}</a>, published{" "}
              <time dateTime={RACES.published}>{longDate(RACES.published)}</time>. Checked on{" "}
              <time dateTime={RACES.checkedOn}>{longDate(RACES.checkedOn)}</time>. How many characters play each
              combination: the <Link href="/census" className={link}>census</Link>.
            </p>
          </div>
        </section>

        <section aria-labelledby="latest">
          <SectionHeading id="latest">What is the latest WoW: Forever build?</SectionHeading>
          <div className="space-y-4">
            <p className="text-fg-2">{latestBuildLine(await loadTimeline())}</p>
            <p className="text-sm text-muted">
              A build&apos;s date is when Everloot first saw it, not when Blizzard shipped it. Every build and Blizzard post is on{" "}
              <Link href="/changes" className={link}>Patch notes and Blizzard posts</Link>.
            </p>
          </div>
        </section>

        <section aria-labelledby="tools">
          <SectionHeading id="tools">What can you do with it on Everloot?</SectionHeading>
          <ul className="list-disc space-y-1 pl-6 text-fg-2">
            <li><Link href="/tools/talents" className={link}>Talent calculator</Link> for all nine classes, from the game files.</li>
            <li><Link href="/tools/raid" className={link}>Raid builder</Link> for 10, 20 and 40 player raids.</li>
            <li><Link href="/map" className={link}>World map</Link> of zones and dungeon and raid entrances.</li>
            <li><Link href="/addons" className={link}>Addons</Link> and the Everloot addon that collects what players see.</li>
          </ul>
        </section>

      </div>
    </Container>
  );
}
