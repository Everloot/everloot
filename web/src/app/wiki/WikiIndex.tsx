"use client";

import Link from "next/link";
import { useState } from "react";

export interface WikiGroup { type: string; label: string; pages: { slug: string; title: string }[] }

/**
 * The hub's pages by type, with a box that narrows them by title as you type. Without JavaScript every
 * page is listed and the box does nothing.
 */
export default function WikiIndex({ groups }: { groups: WikiGroup[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, pages: q ? g.pages.filter((p) => p.title.toLowerCase().includes(q)) : g.pages }))
    .filter((g) => g.pages.length > 0);
  return (
    <div className="space-y-8">
      <div role="search" className="max-w-xl">
        <label htmlFor="wiki-q" className="sr-only">Find a wiki page by title</label>
        <input
          id="wiki-q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={80}
          placeholder="Find a page by title"
          className="min-h-11 w-full rounded-control border border-edge bg-canvas px-3 text-fg placeholder:text-muted"
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted" aria-live="polite">No page title matches “{query.trim()}”.</p>
      ) : (
        shown.map((g) => (
          <section key={g.type} aria-labelledby={`type-${g.type}`}>
            <h2 id={`type-${g.type}`} className="mb-3 text-xl font-semibold tracking-tight text-fg">{g.label}</h2>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {g.pages.map((p) => (
                <li key={p.slug}><Link href={`/wiki/${p.slug}`} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{p.title}</Link></li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
