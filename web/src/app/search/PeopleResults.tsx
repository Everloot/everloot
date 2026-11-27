"use client";

import Link from "@/components/Link";
import { useEffect, useState, type ReactNode } from "react";
import DataTable, { type Column } from "@/components/ui/DataTable";
import type { PeopleSearch, PersonGroup, PersonResult } from "@/lib/people-search-types";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
// Above the Blizzard lookup's 4 s answer (lib/armory-lookup.ts) plus the stored search, so a found character arrives.
export const PEOPLE_PAGE_TIMEOUT_MS = 6000;

type Counts = Partial<Record<"characters" | "guilds", string>>;
const COUNTS_EVENT = "everloot:people-counts";
/** The last answer's counts, for a tab that mounts after it arrived. */
let lastCounts: { q: string; counts: Counts } | null = null;
const countOf = (g: PersonGroup | undefined) => (g && g.total > 0 ? `${g.total.toLocaleString("en-US")}${g.capped ? "+" : ""}` : undefined);

/**
 * The count beside the overview's Characters or Guilds tab: the server draws the tab, the browser asks for the rows
 * (below), so the count arrives with the same answer the groups show, " (2)" as the other tabs write it.
 */
export function PeopleTabCount({ q, kind }: { q: string; kind: keyof Counts }) {
  const [count, setCount] = useState<string | undefined>(() => (lastCounts?.q === q ? lastCounts.counts[kind] : undefined));
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ q: string; counts: Counts }>).detail; if (d.q === q) setCount(d.counts[kind]); };
    window.addEventListener(COUNTS_EVENT, on);
    return () => window.removeEventListener(COUNTS_EVENT, on);
  }, [q, kind]);
  return count ? <span className="ml-1 tabular-nums text-muted">{` (${count})`}</span> : null;
}

/**
 * The Characters and Guilds groups of the /search overview. The page's HTML is kept by the CDN for minutes, and a
 * hidden name must leave search at once, so these rows are asked for from the browser (GET /search/people, never
 * stored) instead of being drawn into that HTML. `empty` (the page's "nothing matches" line) shows only when there
 * are none, never first and then replaced; until the answer settles a page with nothing else to show says it is still
 * searching (the lookup may ask Blizzard, up to the page timeout), and one with database groups keeps the slot empty.
 */
export default function PeopleResults({ q, empty }: { q: string; empty?: ReactNode }) {
  const [found, setFound] = useState<Partial<PeopleSearch> | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    let current = true;
    const settle = (body: Partial<PeopleSearch> | null) => {
      if (!current) return;
      setFound(body ?? {});
      const counts: Counts = { characters: countOf(body?.characters), guilds: countOf(body?.guilds) };
      lastCounts = { q, counts };
      window.dispatchEvent(new CustomEvent(COUNTS_EVENT, { detail: lastCounts }));
    };
    // A slow answer counts as none, so the empty line is not held back for long.
    const limit = setTimeout(() => ctrl.abort(), PEOPLE_PAGE_TIMEOUT_MS);
    setFound(null);
    // lookup=1: a full name nobody stored may be read from Blizzard now (search/people/route.ts); never asked as one types.
    fetch(`/search/people?q=${encodeURIComponent(q)}&lookup=1`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then(settle, () => settle({}))
      .finally(() => clearTimeout(limit));
    return () => { current = false; clearTimeout(limit); ctrl.abort(); };
  }, [q]);
  if (found === null) return empty ? <p role="status" className="py-4 text-cell text-fg-2">Searching characters and guilds…</p> : null;

  const groups = [
    { type: "character", heading: "Characters", group: found?.characters, more: `/players?q=${encodeURIComponent(q)}`, where: "Find a player" },
    { type: "guild", heading: "Guilds", group: found?.guilds, more: `/guilds?q=${encodeURIComponent(q)}`, where: "Guilds" },
  ].filter((g): g is typeof g & { group: PersonGroup } => Boolean(g.group?.results?.length));
  if (groups.length === 0) return <>{empty}</>;

  return groups.map(({ type, heading, group, more, where }) => {
    const columns: Column<PersonResult>[] = [
      { key: "name", header: "Name", cell: (r) => <Link href={r.href} className={link}>{r.label}</Link> },
      { key: "about", header: "About", cell: (r) => <span className="line-clamp-1 text-fg-2">{r.meta}</span> },
    ];
    // The same heading row as the database groups above (app/search/page.tsx): the group's name and its count.
    return (
      <section key={type} id={`results-${type}`} aria-labelledby={`results-${type}-heading`} className="mb-6 scroll-mt-20">
        <h2 id={`results-${type}-heading`} className="mb-1 text-h2-sm font-semibold text-fg sm:text-h2">{heading} <span className="font-normal text-muted tabular-nums">({group.capped ? `${group.total}+` : group.total})</span></h2>
        <DataTable
          dense
          caption={`${heading} matching ${q}`}
          columns={columns}
          rows={group.results}
          rowKey={(r) => r.href}
          meta={(r) => r.meta}
          footer={group.total > group.results.length ? <Link href={more} className={link}>More on {where}</Link> : undefined}
        />
      </section>
    );
  });
}
