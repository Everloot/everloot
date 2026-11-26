import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { cache } from "react";
import { Badge, Card, Container, PageHeader, SectionHeading, Tabs, type Fact } from "@/components/ui";
import ShowcaseSections from "@/components/showcase/ShowcaseSections";
import { FOOTER_LINE } from "@/lib/character-showcase";
import { playerPagesOn } from "@/lib/player-pages";
import {
  armoryBoardHref, armoryCharacterPath, armoryGuildPath, armoryHidePath, armoryOn, classTokenOfName, isArmoryRegion,
  metricOfKey, PLAY_HISTORY_METRICS, regionLabel, slugFromSegment, validArmorySlug, ARMORY_BOARDS,
} from "@/lib/armory";
import { armoryStore, type ArmoryCharacter, type ArmoryRank } from "@/lib/armory-store";
import { loadSiteAssets, unknownItemIcon } from "@/lib/game-assets";
import { loadEquippedTips } from "@/lib/equipped-item-tips";
import { loadCatalog } from "@/lib/completion-lists";
import { publicArmoryLink } from "@/lib/armory-links";
import { Equipment, readTimes } from "../../profile";
import { characterTabs } from "../../character-tabs";
import { loadCharacterProgression } from "@/lib/progression";
import { addonSighting } from "@/lib/character-match";
import { AddonSighting, DungeonRaidSlot, SheetSummary } from "./sheet";
import Portrait from "../../portrait";
import { addonProfile } from "../../addon-profile";
import { classText } from "@/app/players/player-view";
import { ArmoryCredit, armoryMetadata, day, link, newest, NOT_FOUND_METADATA, RegionRuleset, Unreachable } from "../../parts";

/** Read on every request, so a hidden character is gone at once. */
export const dynamic = "force-dynamic";

type Params = { region: string; slug: string };

/** The character, null when there is none (or the address is not one), "unreachable" when storage did not answer. */
const load = cache(async (region: string, segment: string): Promise<ArmoryCharacter | null | "unreachable"> => {
  const slug = slugFromSegment(segment);
  if (!isArmoryRegion(region) || slug === null || !validArmorySlug(slug)) return null;
  try { return await armoryStore().character(region, slug); } catch { return "unreachable"; }
});

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

function rankFacts(c: ArmoryCharacter, ranks: ArmoryRank[]): Fact[] {
  return ranks.flatMap((r) => {
    const metric = metricOfKey(r.metric);
    if (!metric) return [];
    const href = armoryBoardHref(metric, { region: isArmoryRegion(c.region) ? c.region : null, ruleset: c.rulesetId });
    return [{ label: `${ARMORY_BOARDS[metric].title} rank`, value: <Link href={href} className={link}>#{r.rank} of {r.of.toLocaleString("en-US")}</Link>, numeric: true }];
  });
}

export default async function ArmoryCharacterPage(props: { params: Promise<Params>; searchParams?: Promise<{ refresh?: string }> }) {
  if (!armoryOn()) notFound();
  const { region, slug } = await props.params;
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
  // A rank the store cannot give leaves the ranks out; the rest of the page stands.
  const ranks = await armoryStore().rank(c.region, c.slug).catch(() => [] as ArmoryRank[]);
  const path = armoryCharacterPath(c.region, c.slug);
  const fullName = `${c.name} ${c.surname}`;
  const associated = await publicArmoryLink(c.region, c.slug).catch(() => null);
  const addon = associated?.sharesData ? await addonProfile(associated.identity).catch(() => null) : null;
  const assets = await loadSiteAssets().catch(() => null);
  const tips = await loadEquippedTips(assets, c.equipment);
  // Achievement category names come from player reports only (the game files carry the id); none read leaves "Other".
  const categories = c.details?.achievements?.rows.length
    ? await loadCatalog().then((cat) => new Map((cat?.achievements ?? []).flatMap((a) => (a.category ? [[a.achievementId, a.category] as const] : [])))).catch(() => new Map<number, string>())
    : new Map<number, string>();
  const race = assets?.races.get(c.race.toLowerCase());
  const portrait = c.details?.avatar?.url ?? (c.gender === "FEMALE" ? race?.female : race?.male) ?? assets?.classes.get(c.class.toLowerCase())?.icon ?? null;
  const refresh = (await props.searchParams)?.refresh;
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
  // The honorable-kills rank sits with the kills in the PvP tab; the gear ranks stay with the numbers above the tabs.
  const pvpRanks = rankFacts(c, ranks.filter((r) => r.metric === "honorable_kills"));
  // The play-history ranks sit beside their counts in the Play history tab.
  const historyKeys = new Set<string>(PLAY_HISTORY_METRICS.map((m) => ARMORY_BOARDS[m].key));
  const historyRanks = ranks.flatMap((r) => {
    const metric = metricOfKey(r.metric);
    return metric && historyKeys.has(r.metric)
      ? [{ metric, rank: r.rank, of: r.of, href: armoryBoardHref(metric, { region: isArmoryRegion(c.region) ? c.region : null, ruleset: c.rulesetId }) }]
      : [];
  });
  const progression = await loadCharacterProgression(c.region, c.slug);
  // The gear ranks sit in the sheet's summary; honorable kills in the PvP tab, play history in its own.
  const gearRanks = rankFacts(c, ranks.filter((r) => r.metric !== "honorable_kills" && !historyKeys.has(r.metric)));
  const seen = await addonSighting(c);
  const unknownIcon = assets ? unknownItemIcon(assets.base) : null;

  return (
    <Container width="wide">
      <article className="space-y-8">
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
                {lastRead && <span>Last read <time dateTime={lastRead} className="font-mono tabular-nums">{day(lastRead)}</time></span>}
              </>}
              actions={<>
                <form action={`${path}/refresh`} method="post"><button type="submit" className="btn btn-secondary min-h-11">Update character</button></form>
                <a href={`https://worldofwarcraft.blizzard.com/forever/${c.region}/armory/character/${encodeURIComponent(c.slug)}`} className={link}>View Blizzard armory</a>
              </>}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="rounded-control border border-edge px-2 py-1 text-fg-2">Blizzard profile</span>
          {associated && <Link href={associated.path} className={link}>{associated.sharesData ? "Shares addon data" : "Linked character"}</Link>}
          {playerPagesOn() && c.addonSeen && Date.now() - Date.parse(c.addonSeen) < 30 * 86_400_000 && <span className="text-meta text-muted">Seen in addon uploads {c.addonSeen}</span>}
          <ArmoryCredit at={lastRead} />
        </div>
        {refresh && refreshMessages[refresh] && <p role="status" className="text-sm text-fg-2">{refreshMessages[refresh]}</p>}

        <Equipment character={c} tips={tips} unknownIcon={unknownIcon} center={<SheetSummary character={c} ranks={gearRanks} />} />

        <DungeonRaidSlot data={progression.dungeons} href="#progress" />

        {seen && <AddonSighting seen={seen} />}

        <div id="progress">
          <Tabs label={`${fullName}: character sheet`} tabs={characterTabs(c, { categories, pvpFacts: pvpRanks, historyRanks, progression })} />
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
