import { evidenceLine } from "@/lib/evidence";
import type { Edge } from "../../../../kb/src/edges";

/**
 * The line that goes with a count: how many installs agree, and when it was last seen. Only the
 * player-observed rows speak for it — a relation read from the game files carries the quiet marker in
 * its table, and an item page prints neither a build nor a source line.
 */
export default function EvidenceLine({ rows, now }: { rows: readonly Edge[]; now: number }) {
  const observed = rows.filter((e) => e.evidence === "observed");
  if (!observed.length) return null;
  const best = [...observed].sort(
    (a, b) => (b.installs ?? 0) - (a.installs ?? 0) || (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""),
  )[0]!;
  return <p className="mb-2 text-meta text-fg-2">{evidenceLine(best, now)}</p>;
}
