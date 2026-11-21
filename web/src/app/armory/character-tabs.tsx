import type { ReactNode } from "react";
import { Facts, type Fact, type TabItem } from "@/components/ui";
import { metricValue } from "@/lib/armory";
import type { ArmoryCharacter } from "@/lib/armory-store";
import ProgressionMatrix, { type ProgressionMatrixProps } from "@/components/progression/ProgressionMatrix";
import { characterProgression, progressionCatalogue } from "@kb/progression";
import { Achievements, Equipment, NO_ACHIEVEMENTS, PlayHistoryView, ProfessionList, QuestCount, ReputationList, StatList, TalentTrees, type HistoryRank } from "./profile";

/**
 * The character sheet's tabs: one per part of a Blizzard profile the armory stores. Every tab is drawn, so the strip is
 * the same on every sheet; a part the last read did not bring says so in one sentence rather than leaving a gap.
 * Gold, Completionist and Alts wait on #1275. Progress lists the files and synced boss kills publicly for everyone. Legacy perks waits on a stored field.
 */
export const CHARACTER_TABS = [
  ["gear", "Gear"], ["talents", "Talents"], ["stats", "Stats"], ["pvp", "PvP"],
  ["achievements", "Achievements"], ["professions", "Professions"], ["reputations", "Reputations"], ["quests", "Quests"],
  ["history", "Play history"], ["progress", "Progress"],
] as const;
export type CharacterTabId = typeof CHARACTER_TABS[number][0];

const notRead = (what: string) => `The last read from Blizzard's API did not include ${what} for this character.`;

/** What an empty tab says, one sentence each. */
export const EMPTY_TAB: Record<CharacterTabId, string> = {
  gear: "Nothing was equipped when this character was last read.",
  talents: notRead("talents"),
  stats: notRead("stats"),
  pvp: notRead("honorable kills or a PvP rank"),
  achievements: notRead("achievements"),
  professions: notRead("professions"),
  reputations: notRead("reputations"),
  quests: notRead("completed quests"),
  history: notRead("play history"),
  progress: "No synced boss kills are available for this character yet.",
};

const Empty = ({ id }: { id: CharacterTabId }) => <p data-empty-tab={id} className="py-3 text-sm text-fg-2">{EMPTY_TAB[id]}</p>;

export interface SheetParts {
  tips: Parameters<typeof Equipment>[0]["tips"];
  unknownIcon?: string | null;
  /** Achievement categories that players have confirmed, by achievement id. */
  categories?: ReadonlyMap<number, string>;
  /** Facts for the PvP tab beyond the two numbers, such as the honorable-kills board rank. */
  pvpFacts?: Fact[];
  /** The character's places on the play-history boards, shown beside each count. */
  historyRanks?: readonly HistoryRank[];
  progression?: ProgressionMatrixProps;
}

export function characterTabs(c: ArmoryCharacter, parts: SheetParts): TabItem[] {
  const d = c.details;
  const pvp: Fact[] = [
    ...(c.honorableKills !== null ? [{ label: "Honorable kills", value: metricValue("honorable-kills", c.honorableKills), numeric: true }] : []),
    ...(c.pvpRank !== null ? [{ label: "PvP rank", value: c.pvpRank, numeric: true }] : []),
  ];
  const panels: Record<CharacterTabId, ReactNode> = {
    gear: c.equipment.length ? <Equipment character={c} tips={parts.tips} unknownIcon={parts.unknownIcon} heading={false} /> : null,
    talents: d?.talents?.trees.length ? <TalentTrees character={c} trees={d.talents.trees} open /> : null,
    stats: d?.statistics?.rows.length ? <StatList rows={d.statistics.rows} /> : null,
    pvp: pvp.length ? <Facts label="PvP" items={[...pvp, ...(parts.pvpFacts ?? [])]} /> : null,
    achievements: !d?.achievements ? null : d.achievements.rows.length
      ? <Achievements rows={d.achievements.rows} categories={parts.categories ?? new Map()} />
      : <p className="py-3 text-sm text-fg-2">{NO_ACHIEVEMENTS}</p>,
    professions: d?.professions?.rows.length ? <ProfessionList rows={d.professions.rows} /> : null,
    reputations: d?.reputations?.rows.length ? <ReputationList rows={d.reputations.rows} /> : null,
    quests: d?.quests ? <QuestCount completed={d.quests.completed} /> : null,
    history: d?.playHistory?.groups.length ? <PlayHistoryView history={d.playHistory} ranks={parts.historyRanks} /> : null,
    progress: <>
      {(!parts.progression || parts.progression.instances.every((r) => r.state === "no data")) && <p className="py-3 text-sm text-fg-2">{EMPTY_TAB.progress}</p>}
      <ProgressionMatrix {...(parts.progression ?? { instances: characterProgression(progressionCatalogue(null), null) })} />
    </>,
  };
  // No count on any tab: a "(0)" tab would leave the strip, and every tab stays so an empty one can say why.
  return CHARACTER_TABS.map(([id, label]) => ({
    id, label,
    panel: <div className="space-y-3">{panels[id] ?? <Empty id={id} />}</div>,
  }));
}
