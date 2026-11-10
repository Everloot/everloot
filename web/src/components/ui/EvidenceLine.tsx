import { evidenceLine } from "@/lib/evidence";
import Link from "next/link";
import type { Edge } from "../../../../kb/src/edges";

/**
 * The line that goes with a count: how many installs agree, and when it was last seen. Only the
 * player-observed rows speak for it — a relation read from the game files carries the quiet marker in
 * its table and links its build to the changes list.
 */
export default function EvidenceLine({ rows, now }: { rows: readonly Edge[]; now: number }) {
  const observed = rows.filter((e) => e.evidence === "observed");
  if (!observed.length) {
    const file = rows.find((e) => e.evidence === "client");
    return file ? <p className="mb-2 text-meta text-fg-2"><Link href={file.build ? `/changes?show=builds&q=${file.build}` : "/methodology#files"} className="underline decoration-edge underline-offset-4 hover:decoration-fg">{evidenceLine(file, now)}</Link></p> : null;
  }
  const best = [...observed].sort(
    (a, b) => (b.installs ?? 0) - (a.installs ?? 0) || (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""),
  )[0]!;
  return <p className="mb-2 text-meta text-fg-2">{evidenceLine(best, now)}</p>;
}
