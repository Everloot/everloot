import type { ReactNode } from "react";
import Link from "@/components/Link";
import GameIcon from "@/components/game/GameIcon";
import ArmoryTalentTrees from "@/components/talents/ArmoryTalentTrees";
import { armoryBuild, armoryCatalog } from "@/components/talents/armory-build";
import ItemTip from "@/components/game/ItemTip";
import { Disclosure, SectionHeading } from "@/components/ui";
import { QUALITY_TEXT, type Quality } from "@/components/ui/quality";
import { QUALITIES } from "@/design/tokens";
import { qualityColor } from "@/lib/item-names";
import { itemSetHref, itemSetOf } from "@/lib/item-sets";
import { ARMORY_BOARDS, classTokenOfName, metricValue, PLAY_HISTORY_METRICS, rankable, rankText, slotLabel, type ArmoryMetric } from "@/lib/armory";
import type { ArmoryCharacter } from "@/lib/armory-store";
import type { ItemTip as Tip } from "@/lib/game-assets";
import type { PlayHistoryRankedKey } from "@kb/armory/details";
import { link } from "./parts";

// The game's paper doll: armour down the left, jewellery and the rest down the right, weapons below, the character's
// summary in the model's place between them.
export const LEFT = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST"];
export const RIGHT = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"];
export const WEAPONS = ["MAIN_HAND", "OFF_HAND", "RANGED"];
const qualityName = (q: string | null | undefined): Quality | undefined => QUALITIES.find((x) => x === q?.toLowerCase());
const quality = (q: string | null) => QUALITY_TEXT[qualityName(q) as Quality] ?? "text-fg";
const ICON = 40;

/**
 * The character's gear as the game's character sheet lays it out. Every equipped slot draws its icon in its quality's
 * border: the item's own art where the game files have it, else the game's question mark (`unknownIcon`, as item pages
 * do); no icon at all without the asset files. The icon and the name both link the item page, so the shared hover card
 * (or the item's own tooltip) opens from either. `center` fills the model's place (the summary on the armory page); on
 * a phone it comes first and the slots follow as one list. The right column mirrors the left from a wide screen up.
 * `heading={false}` inside a tab, whose label names it already. An item in `unknown` (the game files carry nothing for
 * it, lib/equipped-item-tips.ts) has a nameless database page and a hover card that would 404, so it gets no link and
 * a tooltip from what Blizzard's armory read (name, quality, item level, slot) instead. With `setNames`, the item sets
 * the worn pieces belong to (as the game files list them) are counted under the heading: "Name 3/8".
 */
export function Equipment({ character: c, tips, unknownIcon = null, unknown: unknownIds, heading = true, center, fromFiles, setNames }: {
  character: ArmoryCharacter; tips: Map<number, Tip>; unknownIcon?: string | null; unknown?: ReadonlySet<number>; heading?: boolean; center?: ReactNode;
  /** The slots whose level is the game files', not the armory read's (lib/armory-file-levels.ts). */
  fromFiles?: ReadonlySet<string>;
  /** The set names file's name for a set id (lib/game-assets loadItemSetNames); a set without one reads "Item set N". */
  setNames?: (id: number) => string | undefined;
}) {
  const equipped = new Map(c.equipment.map((item) => [item.slot, item]));
  // Each set worn, with its distinct pieces worn out of the pieces the files list, most pieces first.
  const worn = new Map<number, { total: number; pieces: Set<number> }>();
  for (const item of c.equipment) {
    const set = itemSetOf(item.itemId);
    if (set) worn.set(set.id, { total: new Set(set.items).size, pieces: (worn.get(set.id)?.pieces ?? new Set()).add(item.itemId) });
  }
  const sets = setNames ? [...worn].map(([id, w]) => ({ id, name: setNames(id) ?? `Item set ${id}`, worn: w.pieces.size, total: w.total }))
    .sort((a, b) => b.worn - a.worn || a.name.localeCompare(b.name)) : [];
  const slot = (key: string, mirror: boolean) => {
    const item = equipped.get(key);
    const known = item ? tips.get(item.itemId) : undefined;
    const unknown = item && !known && unknownIds?.has(item.itemId) ? armoryOnlyTip(item, key, unknownIcon) : undefined;
    const tip = known ?? unknown;
    const src = tip?.icon ?? unknownIcon;
    const href = item && !unknown ? `/database/items/${item.itemId}` : "";
    const art = item && src ? <GameIcon src={src} size={ICON} quality={qualityName(item.quality) ?? qualityName(tip?.quality)} /> : null;
    const icon = art
      ? (href ? <Link href={href} tabIndex={-1} aria-hidden="true" className="shrink-0">{art}</Link> : <span aria-hidden="true" className="shrink-0">{art}</span>)
      : <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-sm border border-dashed border-line" />;
    const nameClass = `text-cell [overflow-wrap:anywhere] ${quality(item?.quality ?? null)}`;
    const name = item && (href
      ? <Link href={href} className={`${nameClass} underline decoration-edge underline-offset-4 hover:decoration-fg`}>{item.name}</Link>
      : <span tabIndex={0} className={nameClass}>{item.name}</span>);
    return <li key={key} data-equipment-slot={key} className={`flex min-h-14 min-w-0 items-center gap-3 rounded-control border border-line bg-panel px-2 py-2 ${mirror ? "lg:flex-row-reverse lg:text-right" : ""}`}>
      {icon}
      <div className="min-w-0 flex-1">
        <p className={`flex items-baseline gap-2 text-cell-2 text-muted ${mirror ? "lg:justify-end" : ""}`}>
          <span>{slotLabel(key)}</span>
          {item?.level != null && (fromFiles?.has(key)
            ? <span className="font-mono tabular-nums text-fg-2 underline decoration-dotted underline-offset-4" title="Item level from the game files" aria-label={`Item level ${item.level}, from the game files`}>{item.level}</span>
            : <span className="font-mono tabular-nums text-fg-2" aria-label={`Item level ${item.level}`}>{item.level}</span>)}
        </p>
        {item ? (tip ? <ItemTip tip={tip} icon={null}>{name!}</ItemTip> : name) : <p className="text-cell text-muted">Not equipped</p>}
      </div>
    </li>;
  };
  return <section aria-labelledby={heading ? "armory-gear" : undefined} aria-label={heading ? undefined : "Equipment"} className="space-y-3">
    {heading && <SectionHeading id="armory-gear">Equipment</SectionHeading>}
    {c.equipment.length === 0 && <p className="text-sm text-fg-2">Nothing equipped when it was read.</p>}
    {sets.length > 0 && <p data-item-sets className="text-meta text-fg-2">
      Sets:{" "}{sets.map((s, i) => <span key={s.id}>{i > 0 && " · "}<Link href={itemSetHref(s.id)} className={link}>{s.name}</Link> <span className="font-mono tabular-nums">{s.worn}/{s.total}</span></span>)}
    </p>}
    {fromFiles && fromFiles.size > 0 && <p data-file-levels className="text-meta text-muted">
      Blizzard&apos;s armory no longer sends item levels, so the levels underlined with dots are the game files&apos; levels for the same items.
    </p>}
    <div data-paper-doll className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,19rem)_minmax(0,1fr)]">
      <ol aria-label="Left side" className="grid content-start gap-2">{LEFT.map((k) => slot(k, false))}</ol>
      {center
        ? <div data-model-space className="order-first sm:col-span-2 lg:order-none lg:col-span-1">{center}</div>
        : <div aria-hidden="true" data-model-space className="hidden lg:block" />}
      <ol aria-label="Right side" className="grid content-start gap-2">{RIGHT.map((k) => slot(k, true))}</ol>
    </div>
    <ol aria-label="Weapons" className="grid gap-2 sm:grid-cols-3">{WEAPONS.map((k) => slot(k, false))}</ol>
  </section>;
}

/** A tooltip for an equipped item the game files do not know, from the fields Blizzard's armory read; nothing invented. */
function armoryOnlyTip(item: ArmoryCharacter["equipment"][number], slot: string, icon: string | null): Tip {
  const q = qualityName(item.quality);
  return {
    name: item.name, color: qualityColor(q ? QUALITIES.indexOf(q) : 1), quality: q ? q[0]!.toUpperCase() + q.slice(1) : "Common", icon,
    lines: [...(item.level != null ? [`Item level ${item.level}`] : []), slotLabel(slot)],
    partial: true, why: [], label: "From Blizzard's armory. Not in the game files yet, so it has no database page.",
    level: item.level ?? 0, required: 0, binding: 0,
  };
}

type Achievement ={ id: number; name: string; completedAt: string };
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
 * The talent trees drawn as the calculator draws them, read-only, with a link that opens the build there. The armory
 * keeps Blizzard's talent names and ranks; each must match a node of the class's trees (armory-build.ts). When one does
 * not, the trees are listed as Blizzard gives them, with the reason, and the link opens the class's empty calculator.
 * `open` lists every talent in that list.
 */
export function TalentTrees({ character: c, trees, open = false }: { character: ArmoryCharacter; trees: NonNullable<Details["talents"]>["trees"]; open?: boolean }) {
  const classSlug = classTokenOfName(c.class).toLowerCase();
  const catalog = armoryCatalog(classSlug);
  const build = catalog ? armoryBuild(catalog, trees) : null;
  if (catalog && build?.ok) return <>
    <ArmoryTalentTrees catalog={catalog} ranks={build.ranks} />
    <p className="text-sm"><Link href={build.href} className={link}>Open this build in the calculator</Link></p>
  </>;
  return <>
    {build && !build.ok && <p className="text-sm text-fg-2">Shown as a list: {build.reason}</p>}
    <div className="divide-y divide-line">
      {trees.map((tree) => <div key={tree.name} className="py-3">
        <p className="flex justify-between gap-3 text-sm text-fg"><span>{tree.name}</span><span><span className="font-mono tabular-nums">{tree.points}</span> points</span></p>
        {tree.talents.length > 0 && <details open={open} className="mt-2 text-sm text-fg-2"><summary className="min-h-11 cursor-pointer py-2">Talent details</summary><ul className="space-y-1">{tree.talents.map((talent) => <li key={talent.name} className="flex justify-between gap-3"><span>{talent.name}</span><span className="shrink-0">Rank <span className="font-mono tabular-nums">{talent.rank}</span></span></li>)}</ul></details>}
      </div>)}
    </div>
    {classSlug && <p className="text-sm"><Link href={`/tools/talents/${classSlug}`} className={link}>Plan a build in the talent calculator</Link></p>}
  </>;
}

/** The profession bars; `grid` lays them out two columns wide from small screens up (the character overview). */
export function ProfessionList({ rows, grid = false }: { rows: NonNullable<Details["professions"]>["rows"]; grid?: boolean }) {
  return <>
    <ul {...(grid ? { "data-profession-grid": "" } : {})} className={grid ? "grid gap-x-8 gap-y-4 sm:grid-cols-2" : "space-y-4"}>{rows.map((profession) => <li key={profession.name}>
      <div className="mb-1 flex justify-between gap-3 text-sm"><span className="text-fg">{profession.name}</span><span className="font-mono tabular-nums text-fg-2">{profession.rank} / {profession.max}</span></div>
      <progress className="h-2 w-full accent-accent" value={profession.rank} max={profession.max} aria-label={`${profession.name} skill`} />
    </li>)}</ul>
    <p className="text-sm"><Link href="/tools/professions" className={link}>Find profession leveling routes</Link></p>
  </>;
}

/** The game's standings, lowest first: a row without Blizzard's tier is placed by its standing's name. */
const STANDINGS = ["hated", "hostile", "unfriendly", "neutral", "friendly", "honored", "revered", "exalted"];
const standingOf = (r: { standing: string; tier?: number }) => r.tier ?? STANDINGS.indexOf(r.standing.toLowerCase());

/** Highest standing first (Exalted), then by name. */
export function ReputationList({ rows }: { rows: NonNullable<Details["reputations"]>["rows"] }) {
  const sorted = [...rows].sort((a, b) => standingOf(b) - standingOf(a) || a.name.localeCompare(b.name));
  return <ul className="divide-y divide-line">{sorted.map((r) =><li key={r.id} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
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
export interface HistoryRank { metric: ArmoryMetric; rank: number; of: number; tied?: number; href: string }

/**
 * Blizzard's play history: the six ranked counts first, each with its rank when the character has one, then every
 * category as Blizzard groups it. A count the read did not bring says "Not read", never 0.
 */
export function PlayHistoryView({ history, ranks = [], source = false }: { history: NonNullable<Details["playHistory"]>; ranks?: readonly HistoryRank[]; source?: boolean }) {
  return <div className="space-y-6">
    {source && <p data-history-source className="text-sm text-fg-2">
      From Blizzard&apos;s API play history, read <span className="font-mono tabular-nums">{history.asOf.slice(0, 10)}</span>. Blizzard
      keeps these counts on its own, so its quests completed can differ from the completed-quest list in the numbers
      above, and its boss kills are not the kills synced through the Everloot Desktop App.
    </p>}
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {PLAY_HISTORY_METRICS.map((m) => {
        const value = history.ranked[HISTORY_COUNT[m]];
        // A count of 0 would only share the last place, so it shows without a rank.
        const rank = rankable(value) ? ranks.find((r) => r.metric === m) : undefined;
        return <div key={m}>
          <dt className="text-meta text-muted">{ARMORY_BOARDS[m].title}</dt>
          <dd className="font-mono text-lg tabular-nums text-fg">{value === undefined ? <span className="text-fg-2">Not read</span> : metricValue(m, value)}</dd>
          {rank && <dd className="text-sm"><Link href={rank.href} className={link}>{rankText(rank)}</Link></dd>}
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

/**
 * When Blizzard's play history counts a boss kill, the sentence that says so and when it was read; null otherwise.
 * Synced kills (Desktop App) and these counts are separate sources, so a "no synced kills" line adds this one.
 */
export function blizzardBossKillsLine(c: ArmoryCharacter): string | null {
  const h = c.details?.playHistory;
  const kills = h?.groups.some((g) => /boss kills/i.test(g.name) && g.rows.some((r) => r.value > 0));
  return h && kills ? `Blizzard's API lists boss kills in Play history, read ${h.asOf.slice(0, 10)}.` : null;
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
    {details.playHistory && details.playHistory.groups.length > 0 && <section aria-labelledby="armory-play-history" className="space-y-3">
      <SectionHeading id="armory-play-history">Play history</SectionHeading>
      <PlayHistoryView history={details.playHistory} />
    </section>}
  </>;
}
