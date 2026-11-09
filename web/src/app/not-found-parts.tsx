"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Glint from "@/components/glint/Glint";
import { SearchBar } from "@/components/ui";

/** A database detail address with a numeric id: `/database/items/999999`, not the hub, a list or a slug page. */
export const isDatabaseIdPath = (path: string) => /^\/database\/[a-z-]+\/\d+\/?$/.test(path);

/** The last segment of the attempted path, decoded, as a first search to offer: `/database/items/999999` gives `999999`. */
export function lastSegment(path: string): string {
  const tail = path.split("/").filter(Boolean).at(-1) ?? "";
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

/**
 * The 404 body every not-found page shows: sad Glint, the heading, a search box prefilled with the last segment of
 * the address tried (search-first, like the rest of the site), and the two links. Under a database detail address
 * with an id (`/database/<kind>/<digits>`), `database` adds the line that says why there is no page yet: no install
 * has reported that id, and three installs make a fact public.
 */
export default function NotFoundBody({ database = false }: { database?: boolean }) {
  const path = usePathname() ?? "";
  const unreported = database && isDatabaseIdPath(path);
  return (
    <div className="max-w-xl mx-auto text-center py-16 space-y-4">
      {/* Sad Glint: an empty satchel. */}
      <Glint size={144} pose="sad" className="mx-auto block" />
      <p className="font-mono text-xs text-muted">No drop here</p>
      <h1 className="text-4xl font-bold text-fg">Nothing looted on this page.</h1>
      {unreported ? (
        <p className="text-fg-2">
          No report for this id yet; three installs make it public.{" "}
          <Link href="/addon" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Get the addon</Link>
        </p>
      ) : (
        <p className="text-fg-2">
          The URL doesn&apos;t exist — or the data hasn&apos;t been collected yet.
        </p>
      )}
      <div className="pt-2 text-left">
        <SearchBar action="/search" id="not-found-search" label="Search the site" placeholder="A name or an id" defaultValue={lastSegment(path)} />
      </div>
      <div className="flex items-center justify-center gap-3 pt-2">
        <Link href="/" className="btn btn-primary">
          Home
        </Link>
        <Link href="/database" className="btn">
          The database
        </Link>
      </div>
    </div>
  );
}
