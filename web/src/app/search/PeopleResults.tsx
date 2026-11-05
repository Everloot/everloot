"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import DataTable, { type Column } from "@/components/ui/DataTable";
import type { PeopleSearch, PersonGroup, PersonResult } from "@/lib/people-search";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
export const PEOPLE_PAGE_TIMEOUT_MS = 3000;

/**
 * The Characters and Guilds groups of the /search overview. The page's HTML is kept by the CDN for minutes, and a
 * hidden name must leave search at once, so these rows are asked for from the browser (GET /search/people, never
 * stored) instead of being drawn into that HTML. The slot stays empty until the answer settles, so `empty` (the
 * page's "nothing matches" line) shows only when there are none, never first and then replaced.
 */
export default function PeopleResults({ q, empty }: { q: string; empty?: ReactNode }) {
  const [found, setFound] = useState<Partial<PeopleSearch> | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    let current = true;
    const settle = (body: Partial<PeopleSearch> | null) => { if (current) setFound(body ?? {}); };
    // A slow answer counts as none, so the empty line is not held back for long.
    const limit = setTimeout(() => ctrl.abort(), PEOPLE_PAGE_TIMEOUT_MS);
    setFound(null);
    fetch(`/search/people?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then(settle, () => settle({}))
      .finally(() => clearTimeout(limit));
    return () => { current = false; clearTimeout(limit); ctrl.abort(); };
  }, [q]);
  if (found === null) return null;

  const groups = [
    { type: "character", heading: "Characters", group: found?.characters, more: `/players?q=${encodeURIComponent(q)}`, where: "Find a player" },
    { type: "guild", heading: "Guilds", group: found?.guilds, more: `/guilds?q=${encodeURIComponent(q)}`, where: "Guilds" },
  ].filter((g): g is typeof g & { group: PersonGroup } => Boolean(g.group?.results?.length));
  if (groups.length === 0) return <>{empty}</>;

  return groups.map(({ type, heading, group, more, where }) => {
    const columns: Column<PersonResult>[] = [
      { key: "name", header: <>{heading} <span className="font-normal tabular-nums">({group.capped ? `${group.total}+` : group.total})</span></>, cell: (r) => <Link href={r.href} className={link}>{r.label}</Link> },
      { key: "about", header: "", cell: (r) => <span className="line-clamp-1 text-fg-2">{r.meta}</span> },
    ];
    return (
      <section key={type} id={`results-${type}`} aria-labelledby={`results-${type}-heading`} className="mb-6 scroll-mt-20">
        <h2 id={`results-${type}-heading`} className="sr-only">{heading}</h2>
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
