import { SectionHeading } from "@/components/ui";
import { CLOCK_SKEW_MINUTES, CONFIRMATION, KILL_DAYS_BACK, LEVEL_SLACK, SCORE_VERSION, WEIGHTS, type ComponentScore, type PartKey } from "../../../../kb/src/everloot-score";
import { EXAMPLE_ACCOUNT, EXAMPLE_CHARACTERS, EXAMPLE_SCORES } from "../../../../kb/src/everloot-score-example";

/**
 * The Everloot Score's formula and a worked example on made-up data. The score itself is not shown anywhere: this
 * describes the formula only, so it holds nothing personal and needs no switch. The example's numbers come from
 * running the formula (kb/src/everloot-score.ts), so the text cannot drift from the code.
 */

/** How the example names each part. Worded for the example's own data (one raid tier, three listed final bosses). */
const EXAMPLE_PART: Record<PartKey, (count: number) => string> = {
  raid: (n) => `${n} tier-1 raid bosses`,
  dungeon: (n) => `${n} dungeon bosses, 3 of them final bosses`,
  achievements: (n) => `${n} achievement points`,
  reputations: (n) => `${n} Exalted factions`,
  titles: (n) => `${n} title${n === 1 ? "" : "s"}`,
  quests: (n) => `${n} quests`,
};

const scored = (c: ComponentScore) => (c.status === "scored" ? c : null);

function Example() {
  const [a, ...alts] = EXAMPLE_SCORES;
  const progress = scored(a.progress);
  const completion = scored(a.completion);
  if (!progress || !completion || a.total === null || !EXAMPLE_ACCOUNT.progress || !EXAMPLE_ACCOUNT.completion) return null;
  const line = (c: NonNullable<ReturnType<typeof scored>>) => c.parts.map((p) => `${EXAMPLE_PART[p.key](p.count)}: ${p.points}`).join("; ");
  const both = (s: (typeof EXAMPLE_SCORES)[number], i: number) =>
    `${EXAMPLE_CHARACTERS[i + 1].name} has Progress ${scored(s.progress)?.points} and Completion ${scored(s.completion)?.points}`;
  return (
    <div className="space-y-3 rounded-lg border border-edge p-4">
      <p className="text-fg"><strong>Made-up example.</strong> No boss, list or character below is real.</p>
      <p className="text-fg-2">
        Every kill of Character A&apos;s is in a pull summary another player uploaded, from another install and another address, in
        the same minute, so each one counts. The example&apos;s dungeons have a final-boss list.
      </p>
      <ul className="list-disc pl-6 space-y-1 text-fg-2">
        <li>Progress: {line(progress)}. Progress is <strong className="text-fg">{progress.points}</strong>.</li>
        <li>Completion: {line(completion)}. Completion is <strong className="text-fg">{completion.points}</strong>.</li>
      </ul>
      <p className="text-fg-2">
        A&apos;s profile shows {progress.points} + {completion.points} = <strong className="text-fg">{a.total}</strong> as its Everloot
        Score. No board ranks that sum.
      </p>
      <p className="text-fg-2">
        The same account has linked {EXAMPLE_CHARACTERS.length - 1} more characters, scored the same way: {alts.map(both).join("; ")}.
        The account&apos;s Progress is its best character&apos;s Progress,{" "}
        <strong className="text-fg">{EXAMPLE_ACCOUNT.progress.points}</strong>, and its Completion its best character&apos;s
        Completion, <strong className="text-fg">{EXAMPLE_ACCOUNT.completion.points}</strong>, each picked on its own. Between them
        they have killed {EXAMPLE_ACCOUNT.record} different bosses, which a profile can show but no board ranks.
      </p>
    </div>
  );
}

export function ScoreSection() {
  return (
    <section aria-labelledby="score">
      <SectionHeading id="score">The Everloot Score</SectionHeading>
      <div className="space-y-4">
        <p className="text-fg-2">
          The Everloot Score is not shown anywhere yet. This is the proposed formula, version {SCORE_VERSION}, published first so you can
          check it. The weights may still change before it is used, and any change gets a new version number.
        </p>
        <p className="text-fg-2">
          A character&apos;s points come only from what that character&apos;s own addon file sent about it. Another player&apos;s pull
          summary can confirm one of its kills but never adds one; guild boards, sightings and the census never count. It is not checked
          with Blizzard.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-fg-2">
          <li>
            <span className="text-fg">Progress</span> is raid and dungeon bosses killed this season, each boss once per difficulty. A raid
            boss is worth {WEIGHTS.raidPerTier} times its raid&apos;s tier (tier 1 is the first raid tier) and a dungeon boss{" "}
            {WEIGHTS.dungeonBoss}. A dungeon&apos;s final boss will be worth {WEIGHTS.dungeonFinalBoss} once there is a reviewed list of
            final bosses; until then it is worth {WEIGHTS.dungeonBoss} like the others. Progress starts again when a new raid tier opens.
          </li>
          <li>
            A kill counts only when {CONFIRMATION.witnesses === 1 ? "another player" : `${CONFIRMATION.witnesses} other players`}, from
            another install and another address, uploaded a pull summary of the same boss and difficulty within{" "}
            {CONFIRMATION.windowMinutes} minutes that lists the character in the group and ends in a kill. Other players&apos; anonymous
            kill reports, or the guild&apos;s kill that day, mark a kill &quot;reported, not confirmed&quot; and add nothing.
          </li>
          <li>
            Wipes count for nothing, and so do bosses not on the list three players agree on, difficulties the instance does not have,
            kills before the season, kills dated after they were uploaded (beyond {CLOCK_SKEW_MINUTES} minutes of clock difference), kills
            more than {KILL_DAYS_BACK} days old when uploaded, and kills by a character more than {LEVEL_SLACK} levels under the instance.
            When the character&apos;s level or the instance&apos;s level is unknown, the kill does not count.
          </li>
          <li>
            The addon doesn&apos;t record a character&apos;s own kills yet, so Progress isn&apos;t scored until it does.
          </li>
          <li>
            <span className="text-fg">Completion</span> is achievement points divided by {WEIGHTS.achievementPointsPer} (rounded down),{" "}
            {WEIGHTS.exalted} for each faction at Exalted, {WEIGHTS.title} for each title and 1 for every {WEIGHTS.questsPerPoint} completed
            quests, counting only what is on the lists three players agree on. An achievement the account earned on another character
            counts for that character only, and one earned before launch counts for nothing. Completion is self-reported: it is ranked,
            if at all, only on its own board with that label, never together with Progress.
          </li>
          <li>
            <span className="text-fg">Speed and PvP</span> are not in version {SCORE_VERSION}. Speed waits on dungeon run timing; Everloot
            records no PvP results. Each will be its own part, so adding one changes nothing else.
          </li>
        </ul>
        <p className="text-fg-2">
          A character&apos;s profile shows Progress, Completion and their sum. A character missing something a number uses has no number
          rather than a low one: unrecorded is not zero.
        </p>
        <p className="text-fg-2">
          An account&apos;s Progress is its best linked character&apos;s Progress, and its Completion its best character&apos;s
          Completion, chosen separately. A character counts only from addon files the account sent, and not while it is hidden or two
          accounts have both linked it.
        </p>
        <Example />
      </div>
    </section>
  );
}
