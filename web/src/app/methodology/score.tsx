import { SectionHeading } from "@/components/ui";
import { CORROBORATION, DAYS_BACK, LEVEL_SLACK, SCORE_VERSION, WEIGHTS, type ComponentScore, type PartKey } from "../../../../kb/src/everloot-score";
import { EXAMPLE_ACCOUNT, EXAMPLE_CHARACTERS, EXAMPLE_SCORES } from "../../../../kb/src/everloot-score-example";

/**
 * The Everloot Score's formula and a worked example on made-up data. The score itself is not shown anywhere: this
 * describes the formula only, so it holds nothing personal and needs no switch. The example's numbers come from
 * running the formula (kb/src/everloot-score.ts), so the text cannot drift from the code.
 */

/** How the example names each part. Worded for the example's own data (one raid tier, three final bosses). */
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
  if (!progress || !completion || a.total === null || EXAMPLE_ACCOUNT.total === null) return null;
  const line = (c: NonNullable<ReturnType<typeof scored>>) => c.parts.map((p) => `${EXAMPLE_PART[p.key](p.count)}: ${p.points}`).join("; ");
  return (
    <div className="space-y-3 rounded-lg border border-edge p-4">
      <p className="text-fg"><strong>Made-up example.</strong> No boss, list or character below is real.</p>
      <p className="text-fg-2">
        Every kill of Character A&apos;s was also reported by two other players&apos; installs, from two other addresses, in the same
        minute, so each one counts.
      </p>
      <ul className="list-disc pl-6 space-y-1 text-fg-2">
        <li>Progress: {line(progress)}. Progress is <strong className="text-fg">{progress.points}</strong>.</li>
        <li>Completion: {line(completion)}. Completion is <strong className="text-fg">{completion.points}</strong>.</li>
      </ul>
      <p className="text-fg-2">
        A&apos;s Everloot Score is {progress.points} + {completion.points} = <strong className="text-fg">{a.total}</strong>.
      </p>
      <p className="text-fg-2">
        The same account has linked {EXAMPLE_CHARACTERS.length - 1} more characters, scored the same way at{" "}
        {alts.map((s) => s.total).join(" and ")}. The account&apos;s score is its best character&apos;s:{" "}
        <strong className="text-fg">{EXAMPLE_ACCOUNT.total}</strong>. Between them they have killed {EXAMPLE_ACCOUNT.record} different
        bosses, which a profile can show but no board ranks.
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
          A character&apos;s score comes only from what that character&apos;s own addon file sent about it. What other players&apos; addons
          saw of it, guild boards and the census never add to it. It is self-reported and not checked with Blizzard.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-fg-2">
          <li>
            <span className="text-fg">Progress</span> is raid and dungeon bosses killed this season, each boss once per difficulty. A raid
            boss is worth {WEIGHTS.raidPerTier} times its raid&apos;s tier (tier 1 is the first raid tier), a dungeon boss{" "}
            {WEIGHTS.dungeonBoss}, and a dungeon&apos;s final boss {WEIGHTS.dungeonFinalBoss}. Progress starts again when a new raid tier
            opens.
          </li>
          <li>
            A kill counts only when {CORROBORATION.installs} other players&apos; installs, from {CORROBORATION.addresses} other addresses,
            report the same kill within {CORROBORATION.windowMinutes} minutes, or the character&apos;s own guild has that kill the same day.
            Wipes count for nothing, and so do bosses not on the list three players agree on, kills before launch, kills dated more than{" "}
            {DAYS_BACK} days before their upload, and kills by a character more than {LEVEL_SLACK} levels under the instance.
          </li>
          <li>
            The addon doesn&apos;t record a character&apos;s own kills yet, so Progress isn&apos;t scored until it does.
          </li>
          <li>
            <span className="text-fg">Completion</span> is achievement points divided by {WEIGHTS.achievementPointsPer} (rounded down),{" "}
            {WEIGHTS.exalted} for each faction at Exalted, {WEIGHTS.title} for each title and 1 for every {WEIGHTS.questsPerPoint} completed
            quests, counting only what is on the lists three players agree on. An achievement the account earned on another character
            counts for that character only, and one earned before launch counts for nothing.
          </li>
          <li>
            <span className="text-fg">Speed and PvP</span> are not in version {SCORE_VERSION}. Speed waits on dungeon run timing; Everloot
            records no PvP results. Each will be its own part, so adding one changes nothing else.
          </li>
        </ul>
        <p className="text-fg-2">
          The Everloot Score is Progress plus Completion. A character missing something the score uses has no score rather than a
          low one: unrecorded is not zero.
        </p>
        <p className="text-fg-2">
          An account&apos;s score is its best linked character&apos;s. A character counts only from addon files the account sent, and not
          while it is hidden or two accounts have both linked it.
        </p>
        <Example />
      </div>
    </section>
  );
}
