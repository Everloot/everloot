import type { Metadata } from "next";
import Link from "next/link";
import { CLASSES, LAUNCH, longDate, NEW_COMBOS, RACES } from "@/data/wow-forever";
import { latestBuildLine } from "@/lib/changes-facts";
import { loadTimeline } from "@/lib/changes";
import { pageMetadata } from "@/lib/seo";
import JsonLd from "@/components/JsonLd";
import { videoGamePageJsonLd } from "@/lib/jsonld";
import { trailFor } from "@/lib/breadcrumbs";
import { emblems, loadSiteAssets } from "@/lib/game-assets";
import GameIcon from "@/components/game/GameIcon";
import { Container, DataTable, PageHeader, SectionHeading, type Column } from "@/components/ui";

const description =
  "WoW Forever is Blizzard's World of Warcraft: Forever: the launch date, every playable race and class combination, and the newest game build Everloot has seen.";

const title = "What Is WoW Forever? Launch Date and Latest Build";

export const metadata: Metadata = pageMetadata({ title, description, path: "/wow-forever" });

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const isNew = (race: string, cls: string) => NEW_COMBOS.some(([r, c]) => r === race && c === cls);

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
            <li><Link href="/tools/raid" className={link}>Raid buff planner</Link> for 10, 20 and 40 player raids.</li>
            <li><Link href="/map" className={link}>World map</Link> of zones and dungeon and raid entrances.</li>
            <li><Link href="/addons" className={link}>Addons</Link> and the Everloot addon that collects what players see.</li>
          </ul>
        </section>

      </div>
    </Container>
  );
}
