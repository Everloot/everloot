import Link from "next/link";
import { Card, SectionHeading } from "@/components/ui";
import { DARKMOON, DARKMOON_HREF, DARKMOON_STATUS } from "@/lib/darkmoon";

export default function DarkmoonItemNote({ name }: { name?: string }) {
  const row = DARKMOON.turnins.find((r) => r.name === name);
  if (!row) return null;
  return (
    <section aria-labelledby="darkmoon-use" className="mt-6">
      <SectionHeading id="darkmoon-use">Darkmoon Faire tickets</SectionHeading>
      <Card>
        <p>{row.quantity} {row.name} → {row.tickets} {row.tickets === 1 ? "ticket" : "tickets"} per turn-in, according to Jerome’s sheet.</p>
        <p className="mt-2 text-sm text-muted">Sheet minimum: level {row.minLevel}. Check turn-in availability and reputation caps in game before buying.</p>
        <p className="mt-2 text-sm text-muted">{DARKMOON_STATUS}. Source read {DARKMOON.source.readOn}.</p>
        <p className="mt-3 text-sm">
          <Link href={DARKMOON_HREF} className="underline">Storage box guide and all turn-ins</Link>
          {" · "}<a href={DARKMOON.source.url} className="underline">Jerome’s calculator</a>
        </p>
      </Card>
    </section>
  );
}
