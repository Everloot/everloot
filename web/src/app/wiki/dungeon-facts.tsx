import Link from "next/link";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { bossLine, instanceTitle, type InstancePlace } from "@/lib/instances";
import { mapHref } from "@/lib/map-view";
import { dayLabel } from "@/lib/report-labels";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import type { DungeonFacts } from "@/lib/wiki-dungeon";
import { zoneHref } from "@/lib/zones";

/** The line under a dungeon or raid page's "Before you go", which keeps the advice apart from the facts. */
export const ADVICE_NOTE = "Advice in Everloot's own words, not data from the game files or from players.";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** A released zone and a spot in it: the zone's page, and the map at that spot. */
function Place({ place }: { place: InstancePlace }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <Link href={zoneHref(place.mapId, place.zoneName)} className={link}>{place.zoneName}</Link>
      <Link href={mapHref({ mapId: place.mapId, x: place.x, y: place.y })} className="font-mono text-xs text-muted hover:underline underline-offset-4">{place.x}, {place.y}</Link>
    </span>
  );
}

const placeKey = (p: InstancePlace) => `${p.mapId}-${p.x}-${p.y}`;

/**
 * The infobox of a dungeon or raid page. The level and entrance the game files give carry the unconfirmed marker; an
 * entrance 3 installs zoned in from says how many and when last. A fact no source gives has no row, and a box with no
 * row is not drawn.
 */
export function DungeonGlance({ facts }: { facts: DungeonFacts }) {
  const { row, level, unreachable } = facts;
  if (level === null && !row.files.length && !row.confirmed.length) return null;
  return (
    <Card as="section" aria-labelledby="at-a-glance" className="mb-8">
      <h2 id="at-a-glance" className="text-sm font-semibold text-fg">At a glance</h2>
      <p className="mt-1 text-sm text-muted">What the game files give is marked unconfirmed. A confirmed entrance is the place 3 installs zoned in from.</p>
      {unreachable && <p className="mt-2 text-meta text-warning">{STORAGE_UNREACHABLE} Players&apos; reports cannot be shown until it is back; what is here is from the game files.</p>}
      <dl data-wiki-facts className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        {level !== null && (
          <>
            <dt className="text-muted">Level</dt>
            <dd className="text-fg">{level} <Badge tone="files" /></dd>
          </>
        )}
        {row.files.length > 0 && (
          <>
            <dt className="text-muted">Entrance</dt>
            <dd className="space-y-1">
              {row.files.map((p) => <div key={placeKey(p)} className="flex flex-wrap items-center gap-2"><Place place={p} /><Badge tone="files" /></div>)}
            </dd>
          </>
        )}
        {row.confirmed.length > 0 && (
          <>
            <dt className="text-muted">Confirmed entrance</dt>
            <dd className="space-y-1">
              {row.confirmed.map((p) => (
                <div key={placeKey(p)} className="flex flex-wrap items-baseline gap-x-2"><Place place={p} /><span className="text-fg-2">from {p.installs} installs, last seen {dayLabel(p.lastSeen)}</span></div>
              ))}
            </dd>
          </>
        )}
      </dl>
      <p className="mt-3 text-sm"><Link href={facts.href} className={link}>{instanceTitle(row)} in the database</Link></p>
    </Card>
  );
}

/**
 * The bosses 3 installs report in the instance, each with its kills, installs and last seen. With none there is no
 * section; with storage down the row has none either, and the infobox says why.
 */
export function DungeonBosses({ facts }: { facts: DungeonFacts }) {
  if (!facts.row.bosses.length) return null;
  return (
    <section aria-labelledby="bosses" className="mt-12">
      <SectionHeading id="bosses" note="A boss is listed once 3 installs report its encounter ending here. Kills count every install's kills together; wipes are not kills.">
        Bosses
      </SectionHeading>
      <ul className="space-y-1 text-sm text-fg-2">
        {facts.row.bosses.map((b) => <li key={b.encounterId}>{bossLine(b)}</li>)}
      </ul>
    </section>
  );
}
