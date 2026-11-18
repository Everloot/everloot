"use client";

import Link from "next/link";
import { track } from "@/lib/analytics/track";
import { SuggestField } from "./ui/SearchBar";

/** Three ways in, each to the page that answers it: the item list, the quest list and the chat. */
const EXAMPLES = [
  { label: "Look up an item", href: "/database/items" },
  { label: "Find a quest", href: "/database/quests" },
  { label: "Ask the AI", href: "/chat" },
];

/**
 * The home hero's one search box: the header's field (the same suggestions and the same /search results), larger, with
 * three example chips under it. A GET form, so it works without JavaScript.
 */
export default function HomeSearch() {
  return (
    <div className="w-full max-w-xl">
      <form action="/search" method="get" role="search" aria-label="Search Everloot" onSubmit={() => track("search", { surface: "home" })} className="flex gap-2">
        <SuggestField
          id="home-search"
          label="Search Everloot"
          placeholder="Search items, NPCs, quests and zones"
          className="min-h-11 w-full min-w-0 rounded-full border border-edge bg-canvas/80 px-4 text-base text-fg placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button type="submit" className="btn btn-primary min-h-11 shrink-0 px-5">Search</button>
      </form>
      <ul aria-label="Examples" className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((e) => (
          <li key={e.href}>
            <Link href={e.href} className="inline-flex min-h-11 items-center rounded-full border border-line bg-canvas/80 px-4 text-sm text-fg-2 hover:border-accent hover:text-fg">{e.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
