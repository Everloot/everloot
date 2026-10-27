import { LABEL } from "../../../../kb/src/talents/catalog";
import { PUBLISHED_CHANGES, classTalentChanges, codeFreshness, freshnessLines } from "@/lib/talents/freshness";
import type { TalentCatalog } from "@/lib/talents/types";
import WhilePlanShown from "./WhilePlanShown";

// Under a build link's calculator: what the game files changed in each set's talents since the build the set
// was made on, from the build watch's change records. It only reads. The link's codes keep the build they
// carry, and the note holds no link, code or button that could save or re-stamp the plan. A set made on the
// tree's own build gets no note, and neither does a code that does not load: the calculator's report says why.
// In the browser, beside a calculator that reads the page address, the note stays only while the address shows
// the plan it describes (WhilePlanShown).

export default function FreshnessNote({ catalog, codes, entries = PUBLISHED_CHANGES, spoilers = false, followsAddress = true, className = "" }: {
  catalog: TalentCatalog;
  /** The link's share codes, one per set; null for an empty set. */
  codes?: readonly (string | null)[];
  /** The change records; the published ones unless a test gives its own. */
  entries?: readonly unknown[];
  /** Whether the reader turned spoilers on. Off, a spoiler build's changes are counted but not shown. */
  spoilers?: boolean;
  /** Whether the calculator beside the note loads a plan from the page address. A saved build's page shows its own
   *  codes whatever the address holds, so there the note stays put. */
  followsAddress?: boolean;
  className?: string;
}) {
  const sets = (codes ?? []).flatMap((code, i) => (code ? [{ set: i + 1, code }] : []));
  if (sets.length === 0) return null;
  const changes = classTalentChanges(entries, catalog.classId);
  const notes = sets
    .map(({ set, code }) => {
      const freshness = codeFreshness(catalog, changes, code);
      return { set, lines: freshness ? freshnessLines(freshness, { spoilers }) : [] };
    })
    .filter((n) => n.lines.length > 0);
  if (notes.length === 0) return null;

  const note = (
    <section aria-label="Game build changes" className={`space-y-3 rounded-control border border-line bg-canvas p-4 text-sm text-fg-2 ${className}`.trim()}>
      {notes.map(({ set, lines: [lead, ...rest] }) => (
        <div key={set} className="space-y-1">
          <p className="font-semibold text-fg">{sets.length > 1 && `Set ${set}: `}{lead}</p>
          {rest.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {rest.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
        </div>
      ))}
      {/* Points spent after the page opens rewrite the address without an event; the note stays about the opened plan. */}
      <p className="font-mono text-xs text-muted">On the plan this page opened with · from the game build change records · {LABEL}</p>
    </section>
  );
  return followsAddress ? <WhilePlanShown codes={codes ?? []}>{note}</WhilePlanShown> : note;
}
