import Link from "next/link";
import EdgeDegraded from "@/components/EdgeDegraded";
import { Card, SectionHeading } from "@/components/ui";
import { loreSlug, UNAVAILABLE, type LoreMatch, type Unavailable } from "@/lib/lore";

/**
 * The "Lore" block of an entity page: the first paragraph of the matching archive page and a link to it.
 * Nothing shown when there is no match or the archive cannot be opened (the page is about collected data). When the
 * archive or the names cannot be read the page is marked degraded (components/EdgeDegraded.tsx), so the edge keeps it
 * a minute, not as long as a page that answered, and the link comes back once they can.
 */
export default function LoreSection({ match }: { match: LoreMatch | null | Unavailable }) {
  if (match === UNAVAILABLE) return <EdgeDegraded when />;
  if (match === null) return null;
  return (
    <section aria-labelledby="lore">
      <SectionHeading id="lore">Lore</SectionHeading>
      <Card>
        <p className="text-fg leading-relaxed">{match.intro}</p>
        <p className="mt-3 text-sm text-muted">
          From the Warcraft Wiki archive of 2023, which predates WoW: Forever.{" "}
          <Link href={`/lore/${loreSlug(match)}`} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Read {match.name} in the lore archive</Link>
        </p>
      </Card>
    </section>
  );
}
