"use client";

import Link from "@/components/Link";
import { useEffect, useState } from "react";
import type { PeopleSearch, PersonResult } from "@/lib/people-search-types";
import { compareHref, compareSide, type Side } from "./sides";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** An armory character's row as the other side; addon sightings and guilds have no gear to compare. */
function sideOf(r: PersonResult): Side | null {
  const m = r.type === "character" ? /^\/armory\/([^/]+)\/([^/]+)$/.exec(r.href) : null;
  return m ? compareSide(`${m[1]}/${m[2]}`) : null;
}

/**
 * The stored characters whose name starts with `q`, each a link to compare it with `keep`. Asked from the browser
 * through the site's own people search (GET /search/people, its rate limit and its hides), never drawn into the page.
 */
export default function ComparePicks({ keep, q }: { keep: Side; q: string }) {
  const [rows, setRows] = useState<{ side: Side; r: PersonResult }[] | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setRows(null);
    fetch(`/search/people?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((body: Partial<PeopleSearch>) => (body.characters?.results ?? []).flatMap((r) => {
        const side = sideOf(r);
        return side && !(side.region === keep.region && side.slug === keep.slug) ? [{ side, r }] : [];
      }))
      .then(setRows, () => { if (!ctrl.signal.aborted) setRows([]); });
    return () => ctrl.abort();
  }, [q, keep.region, keep.slug]);
  if (rows === null) return <p role="status" className="text-sm text-fg-2">Searching…</p>;
  if (rows.length === 0) return <p role="status" className="text-sm text-fg-2">No stored character starts with “{q}”.</p>;
  return <ul aria-label="Characters to compare with" className="divide-y divide-line">
    {rows.map(({ side, r }) => <li key={r.href} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 py-2 text-sm">
      <Link href={compareHref(keep, side)} className={link}>{r.label}</Link>
      <span className="text-fg-2">{r.meta}</span>
    </li>)}
  </ul>;
}
