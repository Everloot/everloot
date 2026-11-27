import Link from "@/components/Link";
import EdgeDegraded from "@/components/EdgeDegraded";
import { Card, SectionHeading } from "@/components/ui";
import { loreSlug, UNAVAILABLE, type LoreMatch, type Unavailable } from "@/lib/lore";

/**
 * The "Lore" block of an entity page: the first paragraph of the matching archive page and a link to it.
 * Nothing shown when there is no match or the archive cannot be opened (the page is about collected data). When the
 * archive or the names cannot be read the page is marked degraded (components/EdgeDegraded.tsx), so the edge keeps it
 * a minute, not as long as a page that answered, and the link comes back once they can.
 */
export default function LoreSection({ match, intro = true }: { match: LoreMatch | null | Unavailable; intro?: boolean }) {
  if (match === UNAVAILABLE) return <EdgeDegraded when />;
  if (match === null) return null;
  // `intro={false}`: the page already shows the paragraph (a quest's About fact), so only its source and link remain.
  return (
    <section aria-labelledby="lore">
      <SectionHeading id="lore" size="data">Lore</SectionHeading>
      <Card>
        {intro && <p className="text-cell text-fg">{match.intro}</p>}
        <p className={`${intro ? "mt-3 " : ""}text-meta text-muted`}>
          From the Warcraft Wiki archive of 2023, which predates WoW: Forever.{" "}
          <Link href={`/lore/${loreSlug(match)}`} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Read {match.name} in the lore archive</Link>
        </p>
      </Card>
    </section>
  );
}
