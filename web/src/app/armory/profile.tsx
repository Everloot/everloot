import Link from "next/link";
import GameIcon from "@/components/game/GameIcon";
import ItemTip from "@/components/game/ItemTip";
import { Disclosure, SectionHeading } from "@/components/ui";
import { QUALITY_TEXT, type Quality } from "@/components/ui/quality";
import { QUALITIES } from "@/design/tokens";
import { ARMORY_BOARDS, classTokenOfName, metricValue, PLAY_HISTORY_METRICS, slotLabel, type ArmoryMetric } from "@/lib/armory";
import type { ArmoryCharacter } from "@/lib/armory-store";
import type { ItemTip as Tip } from "@/lib/game-assets";
import type { PlayHistoryRankedKey } from "@kb/armory/details";
import { link } from "./parts";

// The game's paper doll: armour down the left, jewellery and the rest down the right, weapons below, the model's place left empty.
const LEFT = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST"];
const RIGHT = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"];
const WEAPONS = ["MAIN_HAND", "OFF_HAND", "RANGED"];
const qualityName = (q: string | null | undefined): Quality | undefined => QUALITIES.find((x) => x === q?.toLowerCase());
const quality = (q: string | null) => QUALITY_TEXT[qualityName(q) as Quality] ?? "text-fg";

/**
 * The character's gear. Every equipped slot draws its icon in its quality's border: the item's own art where the game files
 * have it, else the game's question mark (`unknownIcon`, as item pages do); no icon at all without the asset files.
 */
/** `heading={false}` inside a tab, whose label names it already. */
export function Equipment({ character: c, tips, unknownIcon = null, heading = true }: { character: ArmoryCharacter; tips: Map<number, Tip>; unknownIcon?: string | null; heading?: boolean }) {
  const equipped = new Map(c.equipment.map((item) => [item.slot, item]));
  const slot = (key: string) => {
    const item = equipped.get(key);
    const tip = item ? tips.get(item.itemId) : undefined;
    const src = tip?.icon ?? unknownIcon;
    const icon = item && src ? <GameIcon src={src} size={36} quality={qualityName(item.quality) ?? qualityName(tip?.quality)} /> : null;
    const name = item && <Link href={`/database/items/${item.itemId}`} className={`text-sm underline decoration-edge underline-offset-4 hover:decoration-fg ${quality(item.quality)}`}>{item.name}</Link>;
    return <li key={key} data-equipment-slot={key} className="min-w-0 border-b border-line py-3">
      <p className="mb-1 text-meta text-muted">{slotLabel(key)}</p>
      {item ? <div className="flex min-h-11 items-center justify-between gap-3">
        {tip ? <ItemTip tip={tip} size={36} icon={icon}>{name!}</ItemTip> : <span className="inline-flex items-center gap-1.5 align-middle">{icon}{name}</span>}
        {item.level !== null && <span className="shrink-0 font-mono text-meta tabular-nums text-fg-2" aria-label={`Item level ${item.level}`}>{item.level}</span>}
      </div> : <p className="flex min-h-11 items-center text-sm text-muted">Not equipped</p>}
    </li>;
  };
  return <section aria-labelledby={heading ? "armory-gear" : undefined} aria-label={heading ? undefined : "Equipment"} className="space-y-3">
    {heading && <SectionHeading id="armory-gear">Equipment</SectionHeading>}
    {c.equipment.length === 0 && <p className="text-sm text-fg-2">Nothing equipped when it was read.</p>}
    <div data-paper-doll className="grid gap-x-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,6rem)_minmax(0,1fr)]">
      <ol aria-label="Left side">{LEFT.map(slot)}</ol>
      <div aria-hidden="true" data-model-space className="hidden sm:block" />
      <ol aria-label="Right side">{RIGHT.map(slot)}</ol>
    </div>
    <ol aria-label="Weapons" className="grid gap-x-6 sm:grid-cols-3">{WEAPONS.map(slot)}</ol>
  </section>;
}

type Achievement = { id: number; name: string; completedAt: string };
/** The achievements shown open before the rest close under a disclosure. */
export const OPEN_ACHIEVEMENTS = 5;

function AchievementRows({ rows }: { rows: Achievement[] }) {
  return <ul className="divide-y divide-line">{rows.map((a) => <li key={a.id} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
    <Link href={`/database/achievements/${a.id}`} className={link}>{a.name}</Link>
    <time dateTime={a.completedAt} className="shrink-0 font-mono text-meta tabular-nums text-fg-2">{a.completedAt.slice(0, 10)}</time>
  </li>)}</ul>;
}

/** Newest first, then grouped by category (player-confirmed names; "Other" where none is confirmed), groups by their newest. */
function byCategory(rows: Achievement[], categories: ReadonlyMap<number, string>): [string, Achievement[]][] {
  const groups = new Map<string, Achievement[]>();
  for (const a of rows) {
    const name = categories.get(a.id) || "Other";
    groups.set(name, [...(groups.get(name) ?? []), a]);
  }
  return [...groups].sort(([a], [b]) => Number(a === "Other") - Number(b === "Other"));
}

export function Achievements({ rows, categories }: { rows: Achievement[]; categories: ReadonlyMap<number, string> }) {
  const newest = [...rows].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const open = newest.slice(0, OPEN_ACHIEVEMENTS), rest = newest.slice(OPEN_ACHIEVEMENTS);
  return <>
    <AchievementRows rows={open} />
    {rest.length > 0 && <Disclosure summary={`${rest.length.toLocaleString("en-US")} more, by category`} wide>
      {byCategory(rest, categories).map(([name, list]) => <div key={name} data-achievement-category={name} className="space-y-1">
        <p className="text-meta text-muted">{name}</p>
        <AchievementRows rows={list} />
      </div>)}
    </Disclosure>}
  </>;
}

/** The read times of a character's Blizzard data: the profile and each detail section, for one credit line. */
export function readTimes(c: ArmoryCharacter): string[] {
  const d = c.details;
  return [c.fetchedAt, d?.statistics?.asOf, d?.talents?.asOf, d?.professions?.asOf, d?.achievements?.asOf, d?.reputations?.asOf, d?.quests?.asOf, d?.playHistory?.asOf]
    .filter((t): t is string => typeof t === "string");
}

type Details = NonNullable<ArmoryCharacter["details"]>;

export function StatList({ rows }: { rows: NonNullable<Details["statistics"]>["rows"] }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
    {rows.map((stat) => <div key={stat.label}><dt className="text-meta text-muted">{stat.label}</dt><dd className="font-mono text-lg tabular-nums text-fg">{stat.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}{stat.percent ? "%" : ""}</dd></div>)}
  </dl>;
}

/**
 * The talent trees as Blizzard lists them, and a link to the calculator for the class. The armory keeps talent names
 * and ranks, not the calculator's node ids, so the build itself cannot be opened there. `open` lists every talent.
 */
export function TalentTrees({ character: c, trees, open = false }: { character: ArmoryCharacter; trees: NonNullable<Details["talents"]>["trees"]; open?: boolean }) {
  const classSlug = classTokenOfName(c.class).toLowerCase();
  return <>
    <div className="divide-y divide-line">
      {trees.map((tree) => <div key={tree.name} className="py-3">
        <p className="flex justify-between gap-3 text-sm text-fg"><span>{tree.name}</span><span className="font-mono tabular-nums">{tree.points} points</span></p>
        {tree.talents.length > 0 && <details open={open} className="mt-2 text-sm text-fg-2"><summary className="min-h-11 cursor-pointer py-2">Talent details</summary><ul className="space-y-1">{tree.talents.map((talent) => <li key={talent.name} className="flex justify-between gap-3"><span>{talent.name}</span><span className="font-mono tabular-nums">Rank {talent.rank}</span></li>)}</ul></details>}
      </div>)}
    </div>
    {classSlug && <p className="text-sm"><Link href={`/tools/talents/${classSlug}`} className={link}>Plan a build in the talent calculator</Link></p>}
  </>;
}

export function ProfessionList({ rows }: { rows: NonNullable<Details["professions"]>["rows"] }) {
  return <>
    <ul className="space-y-4">{rows.map((profession) => <li key={profession.name}>
      <div className="mb-1 flex justify-between gap-3 text-sm"><span className="text-fg">{profession.name}</span><span className="font-mono tabular-nums text-fg-2">{profession.rank} / {profession.max}</span></div>
      <progress className="h-2 w-full accent-accent" value={profession.rank} max={profession.max} aria-label={`${profession.name} skill`} />
    </li>)}</ul>
    <p className="text-sm"><Link href="/tools/professions" className={link}>Find profession leveling routes</Link></p>
  </>;
}

export function ReputationList({ rows }: { rows: NonNullable<Details["reputations"]>["rows"] }) {
  return <ul className="divide-y divide-line">{rows.map((r) => <li key={r.id} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
    <Link href={`/database/factions/${r.id}`} className={link}>{r.name}</Link>
    <span className="shrink-0 text-fg-2">{r.standing}</span>
  </li>)}</ul>;
}

export function QuestCount({ completed }: { completed: readonly number[] }) {
  return <p className="text-sm text-fg"><span className="font-mono tabular-nums">{completed.length.toLocaleString("en-US")}</span> completed quests</p>;
}

/** Each play-history board and the ranked count it reads. */
const HISTORY_COUNT: Record<string, PlayHistoryRankedKey> = {
  "quests-completed": "quests", "creatures-killed": "creatures", "fish-caught": "fish", "flight-paths": "flights", "dungeons-entered": "dungeons", deaths: "deaths",
};
/** A board rank shown beside its count: the character's place within its region and ruleset, linking to that board. */
export interface HistoryRank { metric: ArmoryMetric; rank: number; of: number; href: string }

/**
 * Blizzard's play history: the six ranked counts first, each with its rank when the character has one, then every
 * category as Blizzard groups it. A count the read did not bring says "Not read", never 0.
 */
export function PlayHistoryView({ history, ranks = [] }: { history: NonNullable<Details["playHistory"]>; ranks?: readonly HistoryRank[] }) {
  return <div className="space-y-6">
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {PLAY_HISTORY_METRICS.map((m) => {
        const value = history.ranked[HISTORY_COUNT[m]];
        const rank = ranks.find((r) => r.metric === m);
        return <div key={m}>
          <dt className="text-meta text-muted">{ARMORY_BOARDS[m].title}</dt>
          <dd className="font-mono text-lg tabular-nums text-fg">{value === undefined ? <span className="text-fg-2">Not read</span> : metricValue(m, value)}</dd>
          {rank && <dd className="text-sm"><Link href={rank.href} className={link}>#{rank.rank} of {rank.of.toLocaleString("en-US")}</Link></dd>}
        </div>;
      })}
    </dl>
    {history.groups.map((group) => <div key={group.name} className="space-y-1">
      <p className="text-meta text-muted">{group.name}</p>
      <ul className="divide-y divide-line">{group.rows.map((row) => <li key={row.id} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
        <span className="text-fg">{row.name}</span>
        <span className="shrink-0 font-mono tabular-nums text-fg-2">{row.value.toLocaleString("en-US")}{row.note ? ` (${row.note})` : ""}</span>
      </li>)}</ul>
    </div>)}
  </div>;
}

/** A read that asked for achievements and found none completed. */
export const NO_ACHIEVEMENTS = "None completed when it was read.";

export function ProfileDetailsView({ character: c, categories = new Map() }: { character: ArmoryCharacter; categories?: ReadonlyMap<number, string> }) {
  const details = c.details;
  if (!details) return null;
  return <>
    {details.statistics && <section aria-labelledby="armory-stats" className="space-y-3">
      <SectionHeading id="armory-stats">Character stats</SectionHeading>
      <StatList rows={details.statistics.rows} />
    </section>}
    {details.talents && <section aria-labelledby="armory-talents" className="space-y-3">
      <SectionHeading id="armory-talents">Talents</SectionHeading>
      <TalentTrees character={c} trees={details.talents.trees} />
    </section>}
    {details.professions && <section aria-labelledby="armory-professions" className="space-y-3">
      <SectionHeading id="armory-professions">Professions</SectionHeading>
      <ProfessionList rows={details.professions.rows} />
    </section>}
    {details.achievements && <section aria-labelledby="armory-achievements" className="space-y-3">
      <SectionHeading id="armory-achievements">Achievements</SectionHeading>
      {details.achievements.rows.length === 0 ? <p className="text-sm text-fg-2">{NO_ACHIEVEMENTS}</p>
        : <Achievements rows={details.achievements.rows} categories={categories} />}
    </section>}
    {details.reputations && details.reputations.rows.length > 0 && <section aria-labelledby="armory-reputations" className="space-y-3">
      <SectionHeading id="armory-reputations">Reputations</SectionHeading>
      <ReputationList rows={details.reputations.rows} />
    </section>}
    {details.quests && <section aria-labelledby="armory-quests" className="space-y-3">
      <SectionHeading id="armory-quests">Quests</SectionHeading>
      <QuestCount completed={details.quests.completed} />
    </section>}
    {details.playHistory && <section aria-labelledby="armory-play-history" className="space-y-3">
      <SectionHeading id="armory-play-history">Play history</SectionHeading>
      <PlayHistoryView history={details.playHistory} />
    </section>}
  </>;
}
