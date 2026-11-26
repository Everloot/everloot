import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import DungeonsAndRaids from "@/components/progress/DungeonsAndRaids";
import type { DungeonsAndRaidsData } from "@/lib/dungeon-clears";
import { metricValue, readLine } from "@/lib/armory";
import { timeAgo } from "@/lib/time";
import { ProfessionList } from "../../profile";
import type { ArmoryCharacter } from "@/lib/armory-store";
import { guildPath, guildsOn } from "@/lib/guilds";
import { optOutPath, type Player } from "@/lib/player-pages";
import { PLAYER_SIGHTING_LINE } from "@/app/players/player-view";
import { link } from "../../parts";

/** The stats the summary shows, in the game's order; the Stats tab lists every one Blizzard read. */
const KEY_STATS = ["Health", "Mana / resource", "Strength", "Agility", "Stamina", "Intellect", "Spirit", "Armor"];

const Pair = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0"><dt className="text-cell-2 text-muted">{label}</dt><dd className="font-mono text-cell tabular-nums text-fg">{children}</dd></div>
);

/**
 * The first line under the header: the numbers that say how geared the character is and how fresh the read is. A
 * number the read did not bring is left out, never shown as 0. The read age names its exact time on hover.
 */
export function CharacterFacts({ character: c, lastRead, now }: { character: ArmoryCharacter; lastRead: string | null; now: number }) {
  const d = c.details;
  const items: [string, ReactNode][] = [
    ...(c.itemLevel !== null ? [["Item level", metricValue("item-level", c.itemLevel)] as [string, ReactNode]] : []),
    ...(c.gearScore !== null ? [["Gear Score", metricValue("gear-score", c.gearScore)] as [string, ReactNode]] : []),
    ...(c.honorableKills !== null ? [["Honorable kills", metricValue("honorable-kills", c.honorableKills)] as [string, ReactNode]] : []),
    ...(d?.achievements ? [["Achievements", d.achievements.rows.length.toLocaleString("en-US")] as [string, ReactNode]] : []),
    ...(d?.quests ? [["Quests completed", d.quests.completed.length.toLocaleString("en-US")] as [string, ReactNode]] : []),
    ...(lastRead ? [["Last read", <time key="read" dateTime={lastRead} title={readLine(lastRead)}>{timeAgo(Date.parse(lastRead), now)}</time>] as [string, ReactNode]] : []),
  ];
  if (items.length === 0) return null;
  return (
    <dl data-character-facts aria-label="At a glance" className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-card border border-line bg-panel px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-meta text-muted">{label}</dt><dd className="font-mono text-lg tabular-nums text-fg">{value}</dd></div>)}
    </dl>
  );
}

/** A board rank as a badge with its scope ("EU Normal · Item level #6 of 20,943"), linking to that board. */
export interface RankBadge { label: string; href: string }

export function RankBadges({ ranks }: { ranks: readonly RankBadge[] }) {
  if (ranks.length === 0) return null;
  return (
    <ul data-rank-badges aria-label="Board ranks" className="flex flex-wrap gap-2">
      {ranks.map((r) => <li key={r.href}><Link href={r.href} className="inline-flex rounded-full hover:text-fg">
        <Badge tone="neutral">{r.label}</Badge>
      </Link></li>)}
    </ul>
  );
}

/**
 * The overview above the gear, stacked: a compact row of cards per talent tree (the largest first and brightest),
 * then the profession bars, two columns from small screens up so four professions do not outgrow the spec cards.
 * Nothing when the last read brought neither.
 */
export function CharacterOverview({ character: c }: { character: ArmoryCharacter }) {
  const trees = [...(c.details?.talents?.trees ?? [])].sort((a, b) => b.points - a.points);
  const professions = c.details?.professions?.rows ?? [];
  if (trees.length === 0 && professions.length === 0) return null;
  return (
    <div data-character-overview="stacked" className="space-y-6">
      {trees.length > 0 && <section aria-labelledby="armory-spec" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="armory-spec" className="text-h2 text-fg">Specialization</h2>
          <a href="#talents" className={`text-sm ${link}`}>Talent details</a>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2 lg:grid-cols-[repeat(auto-fill,minmax(10rem,12rem))]">
          {trees.map((tree, i) => <li key={tree.name} data-spec-card={tree.name} className="min-w-0 rounded-card border border-line bg-panel p-3"><p className={`text-sm [overflow-wrap:break-word] ${i === 0 ? "text-fg" : "text-fg-2"}`}>{tree.name}</p>
            <p className={`font-mono text-lg tabular-nums ${i === 0 ? "text-fg" : "text-fg-2"}`}>{tree.points} points</p>
          </li>)}
        </ul>
      </section>}
      {professions.length > 0 && <section aria-labelledby="armory-overview-professions" className="space-y-3">
        <h2 id="armory-overview-professions" className="text-h2 text-fg">Professions</h2>
        <ProfessionList rows={professions} grid />
      </section>}
    </div>
  );
}

/**
 * The summary in the model's place of the sheet: the average item level, then the key stats from the last stats read.
 * The item level, Gear Score and ranks sit above the sheet (CharacterFacts, RankBadges).
 */
export function SheetSummary({ character: c }: { character: ArmoryCharacter }) {
  const stats = c.details?.statistics?.rows ?? [];
  const key = KEY_STATS.flatMap((label) => stats.filter((s) => s.label === label));
  return (
    <section aria-label="Summary" data-sheet-summary className="flex h-full flex-col gap-4 rounded-card border border-edge bg-panel p-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {c.averageItemLevel !== null && <Pair label="Average item level">{c.averageItemLevel}</Pair>}
      </dl>
      {key.length > 0 && <dl aria-label="Key stats" className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
        {key.map((s) => <Pair key={s.label} label={s.label}>{s.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}{s.percent ? "%" : ""}</Pair>)}
      </dl>}
    </section>
  );
}

/**
 * The character's dungeons and raids (components/progress/DungeonsAndRaids): synced boss kills per instance, below the
 * gear sheet so the sheet stays the first thing on the page. With no kill to list it is one muted line and the link.
 */
export function DungeonRaidSlot({ data, href }: { data: DungeonsAndRaidsData; href: string }) {
  if (!data.synced || data.instances.length === 0) {
    return <p data-slot="dungeon-raid-progress" className="text-meta text-muted">
      Dungeons &amp; raids: {data.synced ? "no boss kill is recorded in this character's synced history yet" : "no boss kills are synced for this character"}.{" "}
      <a href={href} className={link}>Every instance</a>
    </p>;
  }
  return <div data-slot="dungeon-raid-progress"><DungeonsAndRaids data={data} href={href} /></div>;
}

/**
 * What the Everloot addon last saw of this character, when a sighting is certainly this character
 * (lib/character-match.ts): the day, the realm, the level and the guild it saw. The sighting's old address redirects
 * here, so its hide form is offered here too.
 */
export function AddonSighting({ seen }: { seen: Player }) {
  return (
    <Card>
      <section aria-labelledby="armory-addon-sighting" data-part="addon-sighting" className="space-y-3 text-sm">
        <h2 id="armory-addon-sighting" className="text-h2 text-fg">Seen by the Everloot addon</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Pair label="Last seen by the addon">{seen.lastSeen}</Pair>
          <div className="min-w-0"><dt className="text-cell-2 text-muted">Realm</dt><dd className="text-cell text-fg">{seen.realm}</dd></div>
          <Pair label="Level seen">{seen.level}</Pair>
          <div className="min-w-0"><dt className="text-cell-2 text-muted">Guild seen</dt><dd className="text-cell text-fg">
            {seen.guild ? (guildsOn() ? <Link href={guildPath(seen.realm, seen.guild)} className={link}>{seen.guild}</Link> : seen.guild) : "None seen"}
          </dd></div>
        </dl>
        <p className="text-fg-2">
          {PLAYER_SIGHTING_LINE}{" "}
          <Link href={optOutPath(seen)} rel="nofollow" className={link}>Hide this sighting</Link>.
        </p>
      </section>
    </Card>
  );
}
