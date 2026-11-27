import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { Badge, Card, Container, PageHeader, SectionHeading, Tabs } from "@/components/ui";
import ShowcaseSections from "@/components/showcase/ShowcaseSections";
import { FOOTER_LINE } from "@/lib/character-showcase";
import { playerPagesOn } from "@/lib/player-pages";
import {
  armoryCharacterPath, armoryGuildPath, armoryHidePath, armoryOn, classTokenOfName, isArmoryRegion, regionLabel, slugFromSegment, validArmorySlug,
} from "@/lib/armory";
import { loadSiteAssets, unknownItemIcon } from "@/lib/game-assets";
import { loadEquippedItems } from "@/lib/equipped-item-tips";
import { withFileLevels } from "@/lib/armory-file-levels";
import { publicArmoryLink } from "@/lib/armory-links";
import { Equipment, readTimes } from "../../profile";
import { characterPanel, characterTabs, DEFAULT_TAB } from "../../character-tabs";
import { addonSighting } from "@/lib/character-match";
import { AddonSighting, CharacterFacts, CharacterOverview, DungeonRaidSlot, RankBadges, SheetSummary } from "./sheet";
import { loadCharacter as load, loadProgression, loadRanks, rankBadges as badgesOf, tabParts } from "./character-data";
import LaterTab from "./later-tab";
import Portrait from "../../portrait";
import { addonProfile } from "../../addon-profile";
import { classText } from "@/app/players/player-view";
import { compareHref } from "../../compare/sides";
import { ArmoryCredit, armoryMetadata, day, link, newest, NOT_FOUND_METADATA, RegionRuleset, Unreachable } from "../../parts";

/** Read on every request, so a hidden character is gone at once. */
export const dynamic = "force-dynamic";

type Params = { region: string; slug: string };

/** The page's reads that need only the region and slug; null for an address that is not a character's. */
function addressReads(region: string, segment: string) {
  const slug = slugFromSegment(segment);
  if (!isArmoryRegion(region) || slug === null || !validArmorySlug(slug)) return null;
  const progressionRead = loadProgression(region, slug);
  // Observed here so a page that ends in a 404 before awaiting it leaves no unhandled rejection; the page still awaits it.
  progressionRead.catch(() => {});
  // A slug is the first name and surname in lower case (characterSlugOf), so the addon-sighting search, which asks by
  // first name and matches in lower case, can start now. The page uses it only when the name read agrees.
  const name = slug.split("-")[0]!;
  return {
    name,
    sightingRead: addonSighting({ region, slug, name }),
    ranksRead: loadRanks(region, slug),
    linkRead: publicArmoryLink(region, slug).catch(() => null),
    assetsRead: loadSiteAssets().catch(() => null),
    progressionRead,
  };
}

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  if (!armoryOn()) return NOT_FOUND_METADATA;
  const { region, slug } = await props.params;
  const c = await load(region, slug);
  if (c === null) return NOT_FOUND_METADATA;
  if (c === "unreachable") return { title: "Character", robots: NOT_FOUND_METADATA.robots };
  return armoryMetadata({
    title: `${c.name} ${c.surname}, level ${c.level} ${c.race} ${c.class}`,
    description: `${c.name} ${c.surname}, a level ${c.level} ${c.race} ${c.class} on WoW: Forever ${regionLabel(c.region)} ${c.ruleset}: gear, item level and honorable kills from Blizzard's API.`,
    path: armoryCharacterPath(c.region, c.slug),
  });
}

export default async function ArmoryCharacterPage(props: { params: Promise<Params>; searchParams?: Promise<{ refresh?: string }> }) {
  if (!armoryOn()) notFound();
  const { region, slug } = await props.params;
  // The reads keyed by the address alone start with the character read instead of after it: one storage round trip
  // less. The character read still decides everything; for a missing or hidden one their answers are never used.
  const early = addressReads(region, slug);
  const c = await load(region, slug);
  if (c === null) notFound();
  if (c === "unreachable") {
    return (
      <Container width="reading">
        <PageHeader trail={trailFor("/armory")!} title="Character" />
        <div className="space-y-3">
          <Unreachable />
          <ArmoryCredit at={null} />
        </div>
      </Container>
    );
  }
  const path = armoryCharacterPath(c.region, c.slug);
  const fullName = `${c.name} ${c.surname}`;
  // Every read the first screen needs starts at once; none waits on another it does not use. A tab other than the
  // default one loads its own reads when it opens (./later-tab.tsx).
  // The character's own region and slug are the address's (the store matches on both), so the early reads are its reads.
  const { name, sightingRead, ranksRead, linkRead, assetsRead, progressionRead } = early ?? addressReads(c.region, c.slug)!;
  const sighting = c.name.normalize("NFC").toLowerCase() === name ? sightingRead : addonSighting(c);
  const [ranks, associated, addon, assets, { tips, unknown, levels }, progression, seen, defaultParts, search] = await Promise.all([
    ranksRead,
    linkRead,
    linkRead.then((a) => (a?.sharesData ? addonProfile(a.identity).catch(() => null) : null)),
    assetsRead,
    assetsRead.then((a) => loadEquippedItems(a, c.equipment)),
    progressionRead,
    sighting,
    tabParts(c, DEFAULT_TAB),
    props.searchParams,
  ]);
  // Items stored with no level (Blizzard stopped sending them, 2026-11-24/25) show the game files' level, and a missing
  // ranked item level and Gear Score are computed from those, each labelled. Ranks stay the stored row's.
  const shown = withFileLevels(c, (id) => levels.get(id));
  const race = assets?.races.get(c.race.toLowerCase());
  const portrait = c.details?.avatar?.url ?? (c.gender === "FEMALE" ? race?.female : race?.male) ?? assets?.classes.get(c.class.toLowerCase())?.icon ?? null;
  const refresh = search?.refresh;
  const refreshMessages: Record<string, string> = {
    queued: "Refresh queued. The profile updates after the next armory run.",
    "queued-already": "A refresh is already queued.",
    cooldown: "This character was checked within the last hour. Try again later.",
    unavailable: "This character cannot be refreshed right now.",
    limit: "Too many requests from this connection. Try again later.",
    storage: "We could not queue a refresh. Try again in a moment.",
  };
  const lastLogin = day(c.lastLogin);
  const lastRead = newest(readTimes(c));
  const rankBadges = badgesOf(c, ranks);
  const unknownIcon = assets ? unknownItemIcon(assets.base) : null;
  const addonSeenLately = playerPagesOn() && c.addonSeen && Date.now() - Date.parse(c.addonSeen) < 30 * 86_400_000;

  return (
    <Container width="data">
      <article className="space-y-8">
        {/* The header and the facts under it read as one block: the header's own margin is the gap between them. */}
        <div data-character-head>
          <div className="flex items-start gap-4">
            <Portrait src={portrait} name={c.name} />
            <div className="min-w-0 flex-1">
              <PageHeader
                trail={[...trailFor("/armory")!, { name: fullName, path }]}
                title={<span className={classText(classTokenOfName(c.class))}>{fullName}</span>}
                lede={`Level ${c.level} ${c.race} ${c.class}`}
                meta={<>
                  <Badge tone="neutral">{c.faction}</Badge>
                  <RegionRuleset region={c.region} ruleset={c.ruleset} />
                  {c.guildName && <span>{c.guildSlug ? <Link href={armoryGuildPath(c.region, c.guildSlug)} className={link}>{c.guildName}</Link> : c.guildName}</span>}
                  {lastLogin && <span>Last login <span className="font-mono tabular-nums">{lastLogin}</span></span>}
                </>}
                actions={<>
                  <form action={`${path}/refresh`} method="post"><button type="submit" className="btn btn-sm">Update character</button></form>
                  <Link href={compareHref({ region: c.region, slug: c.slug })} className={`text-sm ${link}`}>Compare with…</Link>
                  <a href={`https://worldofwarcraft.blizzard.com/forever/${c.region}/armory/character/${encodeURIComponent(c.slug)}`} className={`text-sm ${link}`}>Blizzard armory</a>
                </>}
              />
            </div>
          </div>

          <div className="space-y-3">
            {(associated || addonSeenLately) && <div data-character-links className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {associated && <Link href={associated.path} className={link}>{associated.sharesData ? "Shares addon data" : "Linked character"}</Link>}
              {addonSeenLately && <span className="text-meta text-muted">Seen in addon uploads <span className="font-mono tabular-nums">{c.addonSeen}</span></span>}
            </div>}
            {refresh && refreshMessages[refresh] && <p role="status" className="text-sm text-fg-2">{refreshMessages[refresh]}</p>}
            <CharacterFacts character={shown.character} lastRead={lastRead} now={Date.now()} computed={shown.computed} />
            <RankBadges ranks={rankBadges} />
            <ArmoryCredit at={lastRead} />
          </div>
        </div>

        <CharacterOverview character={c} />

        <Equipment character={shown.character} tips={tips} unknownIcon={unknownIcon} unknown={unknown} fromFiles={shown.fromFiles} center={<SheetSummary character={c} />} />

        <DungeonRaidSlot data={progression.dungeons} href="#progress" character={c} />

        {seen && <AddonSighting seen={seen} />}

        <div id="progress">
          <Tabs
            label={`${fullName}: character sheet`}
            wrap
            tabs={characterTabs(c, {}, (id) => (id === DEFAULT_TAB ? characterPanel(c, id, defaultParts) : <LaterTab region={c.region} slug={c.slug} tab={id} />))}
          />
        </div>

        {addon && <section aria-labelledby="armory-addon" className="space-y-6 border-t border-line pt-8">
          <SectionHeading id="armory-addon">Shared through the Everloot addon</SectionHeading>
          <ShowcaseSections showcase={addon} preview={false} />
          <p className="text-sm text-fg-2">{FOOTER_LINE}</p>
        </section>}

        <footer className="space-y-3">
          <Card className="text-sm text-fg-2">
            <p>
              Is this your character, and do you want it off Everloot?{" "}
              <Link href={armoryHidePath({ region: c.region, name: c.name, surname: c.surname })} rel="nofollow" className={link}>Hide this character</Link>.
              No account is needed. <Link href="/privacy#armory" className={link}>Privacy policy</Link>.
            </p>
          </Card>
        </footer>
      </article>
    </Container>
  );
}
