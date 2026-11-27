import type { ReactNode } from "react";
import { Facts, type Fact, type TabItem } from "@/components/ui";
import { metricValue } from "@/lib/armory";
import type { ArmoryCharacter } from "@/lib/armory-store";
import ProgressionMatrix, { type ProgressionMatrixProps } from "@/components/progression/ProgressionMatrix";
import { characterProgression, progressionCatalogue } from "@kb/progression";
import { Achievements, blizzardBossKillsLine, NO_ACHIEVEMENTS, PlayHistoryView, QuestCount, ReputationList, StatList, TalentTrees, type HistoryRank } from "./profile";
import { link } from "./parts";

/**
 * The character sheet's tabs: one per part of a Blizzard profile the armory stores, below the gear sheet (which is the
 * page's own, not a tab). Every tab is drawn, so the strip is
 * the same on every sheet; a part the last read did not bring says so in one sentence rather than leaving a gap.
 * Gold, Completionist and Alts wait on #1275. Progress lists the files and synced boss kills publicly for everyone. Legacy perks waits on a stored field.
 */
export const CHARACTER_TABS = [
  ["talents", "Talents"], ["stats", "Stats"], ["pvp", "PvP"],
  ["achievements", "Achievements"], ["professions", "Professions"], ["reputations", "Reputations"], ["quests", "Quests"],
  ["history", "Play history"], ["progress", "Progress"],
] as const;
export type CharacterTabId = typeof CHARACTER_TABS[number][0];

const notRead = (what: string) => `The last read from Blizzard's API did not include ${what} for this character.`;

/** What an empty tab says, one sentence each. */
export const EMPTY_TAB: Record<CharacterTabId, string> = {
  talents: notRead("talents"),
  stats: notRead("stats"),
  pvp: notRead("honorable kills or a PvP rank"),
  achievements: notRead("achievements"),
  professions: notRead("professions"),
  reputations: notRead("reputations"),
  quests: notRead("completed quests"),
  history: notRead("play history"),
  progress: "No boss kills synced through the Everloot Desktop App for this character yet.",
};

/** Blizzard's API gives no talents below level 10, where the game gives no talent points. */
export const NO_TALENT_POINTS = "No talent points before level 10.";

const Empty = ({ id, text = EMPTY_TAB[id] }: { id: CharacterTabId; text?: string }) => <p data-empty-tab={id} className="py-3 text-sm text-fg-2">{text}</p>;

export interface SheetParts {
  /** Achievement categories that players have confirmed, by achievement id. */
  categories?: ReadonlyMap<number, string>;
  /** Facts for the PvP tab beyond the two numbers, such as the honorable-kills board rank. */
  pvpFacts?: Fact[];
  /** The character's places on the play-history boards, shown beside each count. */
  historyRanks?: readonly HistoryRank[];
  progression?: ProgressionMatrixProps;
}

/** The tab that opens when the address names none: drawn with the page. */
export const DEFAULT_TAB: CharacterTabId = CHARACTER_TABS[0][0];

export const isCharacterTab = (id: string): id is CharacterTabId => CHARACTER_TABS.some(([t]) => t === id);

/** One tab's content, or its one-sentence empty line. */
export function characterPanel(c: ArmoryCharacter, id: CharacterTabId, parts: SheetParts): ReactNode {
  const d = c.details;
  switch (id) {
    case "talents": return d?.talents?.trees.length ? <TalentTrees character={c} trees={d.talents.trees} open /> : <Empty id={id} text={c.level < 10 ? NO_TALENT_POINTS : undefined} />;
    case "stats": return d?.statistics?.rows.length ? <StatList rows={d.statistics.rows} /> : <Empty id={id} />;
    case "pvp": {
      const pvp: Fact[] = [
        ...(c.honorableKills !== null ? [{ label: "Honorable kills", value: metricValue("honorable-kills", c.honorableKills), numeric: true }] : []),
        ...(c.pvpRank !== null ? [{ label: "PvP rank", value: c.pvpRank, numeric: true }] : []),
      ];
      return pvp.length ? <Facts label="PvP" items={[...pvp, ...(parts.pvpFacts ?? [])]} /> : <Empty id={id} />;
    }
    case "achievements": return !d?.achievements ? <Empty id={id} /> : d.achievements.rows.length
      ? <Achievements rows={d.achievements.rows} categories={parts.categories ?? new Map()} />
      : <p className="py-3 text-sm text-fg-2">{NO_ACHIEVEMENTS}</p>;
    // The bars sit in the overview above the gear (sheet.tsx CharacterOverview); the tab points there, not repeats them.
    case "professions": return d?.professions?.rows.length
      ? <p className="py-3 text-sm text-fg-2">The profession bars are with the specialization above the gear. <a href="#armory-overview-professions" className={link}>Go to professions</a></p>
      : <Empty id={id} />;
    case "reputations": return d?.reputations?.rows.length ? <ReputationList rows={d.reputations.rows} /> : <Empty id={id} />;
    case "quests": return d?.quests ? <QuestCount completed={d.quests.completed} /> : <Empty id={id} />;
    case "history": return d?.playHistory?.groups.length ? <PlayHistoryView history={d.playHistory} ranks={parts.historyRanks} source /> : <Empty id={id} />;
    case "progress": return <>
      {(!parts.progression || parts.progression.instances.every((r) => r.state === "no data")) && <p className="py-3 text-sm text-fg-2">
        {EMPTY_TAB.progress}{blizzardBossKillsLine(c) && <> {blizzardBossKillsLine(c)}</>}
      </p>}
      <ProgressionMatrix {...(parts.progression ?? { instances: characterProgression(progressionCatalogue(null), null) })} />
    </>;
  }
}

/**
 * The tab strip. `later` stands in for a tab's content that is not drawn with the page (it loads when the tab opens);
 * without it every tab is drawn.
 */
export function characterTabs(c: ArmoryCharacter, parts: SheetParts, later?: (id: CharacterTabId) => ReactNode): TabItem[] {
  // No count on any tab: a "(0)" tab would leave the strip, and every tab stays so an empty one can say why.
  return CHARACTER_TABS.map(([id, label]) => ({
    id, label,
    panel: <div className="space-y-3">{later ? later(id) : characterPanel(c, id, parts)}</div>,
  }));
}
