import type { ReactNode } from "react";
import { Card, EmptyState } from "@/components/ui";
import { ANOTHER_CHARACTER_NOTE, COMPLETION_AGREEMENT, completionEmptyState, droppedCharactersNote, type CharacterProgress, type CompletionProgress } from "../../../../../kb/src/completion";

const pct = (done: number, total: number) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);

export function Bar({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(done, total)}
      className="h-2 w-full rounded-full bg-canvas border border-line overflow-hidden"
    >
      <div className="h-full bg-accent" style={{ width: `${pct(done, total)}%` }} />
    </div>
  );
}

function Stat({ title, done, total, unit, note }: { title: string; done: number; total: number; unit: string; note?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm text-fg">{title}</h4>
        <p className="font-mono text-xs tabular-nums text-fg-2">{done} of {total} {unit}</p>
      </div>
      <Bar done={done} total={total} label={title} />
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

function Closest({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-mono text-muted">{title}</h4>
      {children.length === 0 ? <p className="text-sm text-fg-2">{empty}</p> : <ul className="space-y-1 text-sm text-fg">{children}</ul>}
    </div>
  );
}

function Character({ c }: { c: CharacterProgress }) {
  return (
    <Card as="section" aria-labelledby={`character-${c.characterKey}`} className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`character-${c.characterKey}`} className="text-lg font-semibold text-fg">{c.class[0]}{c.class.slice(1).toLowerCase()} <span className="font-mono text-sm text-fg-2">level {c.level}</span></h3>
        <p className="font-mono text-xs text-muted">key {c.characterKey}</p>
      </header>
      <div className="grid gap-6 sm:grid-cols-2">
        <Stat title="Achievements" done={c.achievements.done} total={c.achievements.total} unit="done" note={`${c.achievements.points} of ${c.achievements.pointsTotal} points`} />
        <Stat title="Reputation" done={c.reputation.exalted} total={c.reputation.total} unit="Exalted" />
        <Stat title="Titles" done={c.titles.known} total={c.titles.total} unit="known" />
        <Stat title="Quest chains" done={c.quests.chainsDone} total={c.quests.chainsTotal} unit="finished" note={`${c.quests.completed} quests completed in all`} />
      </div>
      <CharacterClosest c={c} />
    </Card>
  );
}

/** What is closest to done for one character: achievements by share, reputations by what the next standing needs, chains by quests left. */
export function CharacterClosest({ c }: { c: CharacterProgress }) {
  return (
      <div className="grid gap-6 sm:grid-cols-3">
        <Closest title="Achievements closest to done" empty="None started that the list covers.">
          {c.achievements.closest.map((a) => (
            <li key={a.achievementId}>{a.name} <span className="block font-mono text-xs text-fg-2">{a.category} · {a.have} of {a.of} {a.unit === "progress" ? "progress" : "criteria"}</span></li>
          ))}
        </Closest>
        <Closest title="Reputations nearest the next standing" empty="None below Exalted that the list covers.">
          {[
            ...c.reputation.closest.map((f) => (
              <li key={f.factionId}>{f.name} <span className="block font-mono text-xs text-fg-2">{f.standing} · {f.toNext} to go</span></li>
            )),
            ...c.reputation.unscaled.map((f) => (
              <li key={`u${f.factionId}`}>{f.name} <span className="block font-mono text-xs text-fg-2">value {f.standing} · scale unknown</span></li>
            )),
          ]}
        </Closest>
        <Closest title="Quest chains closest to done" empty="No chain started that the list covers.">
          {c.quests.closest.map((q) => (
            <li key={q.questLineId}>{q.name} <span className="block font-mono text-xs text-fg-2">{q.done} of {q.truncated ? `at least ${q.total}` : q.total} quests</span></li>
          ))}
        </Closest>
      </div>
  );
}

/** One install's completion progress, or an honest account of why there is none. */
export default function CompletionView({ progress }: { progress: CompletionProgress | null }) {
  if (!progress) {
    return (
      <p className="text-fg-2">
        Enter an install id to see achievements, reputation, titles and quest chains for that install&apos;s characters.
      </p>
    );
  }
  const empty = completionEmptyState(progress);
  const dropped = droppedCharactersNote(progress);
  const droppedNote = dropped && <p className="text-sm text-fg-2" role="status">{dropped}</p>;
  if (empty) {
    return (
      <div className="space-y-4">
        {droppedNote}
        {progress.ownedRecorded
          ? <Card><p className="text-fg" role="status">{empty}</p></Card>
          : <EmptyState message={empty} />}
      </div>
    );
  }
  const { listed } = progress;
  // Until a list is public every total would read 0: say why instead of drawing empty bars.
  if (listed.achievements + listed.factions + listed.titles + listed.chains === 0) {
    return (
      <div className="space-y-4">
        {droppedNote}
        <EmptyState message={`No list is public yet: an entry appears when ${COMPLETION_AGREEMENT} players (installs uploading from different addresses) report the same achievement, faction, title or chain.`} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {droppedNote}
      {progress.characters.map((c) => <Character key={c.characterKey} c={c} />)}
      <p className="text-xs text-muted">{ANOTHER_CHARACTER_NOTE}</p>
    </div>
  );
}
