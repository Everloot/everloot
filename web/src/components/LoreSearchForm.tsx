"use client";

import { track } from "@/lib/analytics/track";

/** Plain GET form scoped to the lore archive; works without JavaScript. */
export default function LoreSearchForm({ query = "", label = "Search the lore archive", placeholder = "Thrall, Zul'Gurub, Ashbringer…" }: { query?: string; label?: string; placeholder?: string }) {
  return (
    <form action="/search" method="get" role="search" onSubmit={() => track("search", { surface: "lore" })} className="flex flex-col sm:flex-row gap-2 max-w-xl">
      <input type="hidden" name="in" value="lore" />
      <label htmlFor="lore-q" className="sr-only">{label}</label>
      <input
        id="lore-q"
        name="q"
        type="search"
        defaultValue={query}
        maxLength={200}
        placeholder={placeholder}
        className="flex-1 min-h-11 rounded-control border border-edge bg-canvas px-3 text-fg placeholder:text-muted"
      />
      <button type="submit" className="btn btn-primary min-h-11">Search</button>
    </form>
  );
}
