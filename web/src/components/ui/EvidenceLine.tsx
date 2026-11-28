import { timeAgo } from "@/lib/time";
import type { Edge } from "@kb/edges";

/**
 * The line over a table of relations: how many installs agree on each row, and when the newest was last seen. It gives
 * the rows' own count, the number their Seen column shows, never one capped at 3. Only the player-observed rows speak
 * for it — a relation read from the game files carries the quiet marker in its table, and an item page prints neither
 * a build nor a source line.
 */
export default function EvidenceLine({ rows, now }: { rows: readonly Edge[]; now: number }) {
  const observed = rows.filter((e) => e.evidence === "observed");
  if (!observed.length) return null;
  const counts = observed.map((e) => e.installs ?? 0);
  const min = Math.min(...counts), max = Math.max(...counts);
  const agree = min === max ? `${min} ${min === 1 ? "install agrees" : "installs agree"} on each row` : `At least ${min} installs agree on each row`;
  const seen = observed.map((e) => e.lastSeen).filter((t): t is string => Boolean(t)).sort().at(-1);
  return <p className="mb-2 text-meta text-fg-2">{seen ? `${agree} · last seen ${timeAgo(Date.parse(seen), now)}` : agree}</p>;
}
