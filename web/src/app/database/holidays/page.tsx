import type { Metadata } from "next";
import Link from "next/link";
import { Container, DataTable, DataTitle } from "@/components/ui";
import { pageMetadata } from "@/lib/seo";
import { holidayEntries, holidayHref, lastsLabel, startLabel } from "@/lib/world-events";
import { CLIENT_LABEL } from "@kb/edges";
import { LINK } from "../entity";
import { Unreadable } from "../list-parts";

export const metadata: Metadata = pageMetadata({
  title: "WoW Forever Holidays and World Events",
  description: "Holidays and world events in WoW: Forever, with when each starts and how long it lasts. From the game files.",
  path: "/database/holidays",
});

/** Every holiday the game files name, in id order: a short list, so no filter or pages. */
export default function HolidayListPage() {
  const rows = holidayEntries();
  return (
    <Container width="data">
      <article>
        <DataTitle title="Holidays and world events" />
        <p data-list-note className="mb-2 text-meta text-muted">Every holiday and world event the game files name, with its first start in server time. {CLIENT_LABEL}.</p>
        <DataTable
          dense
          caption={`Holidays in the game files: ${rows?.length ?? 0}`}
          columns={[
            { key: "name", header: "Name", cell: (h) => <Link prefetch={false} href={holidayHref(h.id, h.name)} className={LINK}>{h.name}</Link> },
            { key: "starts", header: "Starts", cell: (h) => (h.starts[0] ? startLabel(h.starts[0]) : <span className="text-muted">–</span>) },
            { key: "lasts", header: "Lasts", cell: (h) => lastsLabel(h.hours) ?? <span className="text-muted">–</span> },
            { key: "id", header: "ID", numeric: true, cell: (h) => h.id },
          ]}
          rows={rows ?? []}
          rowKey={(h) => String(h.id)}
          meta={(h) => `ID ${h.id}`}
          empty={rows === null ? <Unreadable>The game files could not be read just now, so this list is unrecorded.</Unreadable> : <p className="py-4 text-cell text-fg-2">No holiday is in the game files read so far.</p>}
        />
      </article>
    </Container>
  );
}
