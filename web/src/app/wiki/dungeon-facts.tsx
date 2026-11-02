import Link from "next/link";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { bossLine, bossRows, instanceTitle, type InstancePlace } from "@/lib/instances";
import { mapHref } from "@/lib/map-view";
import { dayLabel } from "@/lib/report-labels";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import type { DungeonFacts } from "@/lib/wiki-dungeon";
import { zoneHref } from "@/lib/zones";
import { WORLD_MAP } from "@/lib/world-map";
import type { DungeonRecords } from "@/lib/wiki-dungeon-records";
import type { LoadingArt } from "@/lib/game-assets";

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
  if (level === null && !row.files.length && !row.confirmed.length && !row.difficulties.length) return null;
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
        {row.difficulties.length > 0 && (
          <>
            <dt className="text-muted">Difficulties in the files</dt>
            <dd className="space-y-1">
              {row.difficulties.map((id) => {
                const difficulty = WORLD_MAP.difficulties?.[id];
                return <div key={id}>{difficulty?.name ?? `Difficulty ${id}`}{difficulty?.maxPlayers && difficulty.maxPlayers > 0 ? `, up to ${difficulty.maxPlayers} players` : ""} <Badge tone="files" /></div>;
              })}
            </dd>
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
 * Confirmed bosses keep their evidence; file-only encounters stay unconfirmed, including when storage is down.
 */
export function DungeonBosses({ facts }: { facts: DungeonFacts }) {
  const bosses = bossRows(facts.unreachable ? { bosses: [], encounters: facts.row.encounters } : facts.row);
  if (!bosses.length) return null;
  return (
    <section aria-labelledby="bosses" className="mt-12">
      <SectionHeading id="bosses" note="Encounters from the game files are unconfirmed. Player reports appear once 3 installs report an encounter ending here. Kills count every install's kills together; wipes are not kills.">
        Bosses
      </SectionHeading>
      <ul className="space-y-1 text-sm text-fg-2">
        {bosses.map((b) => (
          <li key={b.encounterId}>
            {b.boss ? bossLine({ ...b.boss, name: b.name }) : b.name ?? `Encounter ${b.encounterId}`} {b.filesName && <Badge tone="files" />}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DungeonRecordedFacts({ records }: { records: DungeonRecords }) {
  if (records.unavailable) return <p className="mt-8 text-sm text-warning">Player reports are unavailable. Recorded loot and quests are unknown until storage is back.</p>;
  return (
    <div className="mt-12 space-y-10">
      <section aria-labelledby="recorded-loot">
        <SectionHeading id="recorded-loot" note="Public loot observations from NPCs players confirmed for these bosses. These are recorded loot windows, not a complete loot table, and are not separated by difficulty.">Recorded boss loot</SectionHeading>
        {records.loot.length ? <ul className="space-y-2 text-sm text-fg-2">{records.loot.map((drop) => (
          <li key={`${drop.encounterId}-${drop.sourceNpcId}-${drop.itemId}`}>
            {drop.boss}: <Link href={`/database/items/${drop.itemId}`} className={link}>{drop.itemName ?? `Item ${drop.itemId}`}</Link>
            {` — ${drop.drops} drops in ${drop.kills} loot windows, from ${drop.reporters} installs`}
          </li>
        ))}</ul> : <p className="text-sm text-muted">No public boss loot observations yet. Unrecorded does not mean a boss drops nothing.</p>}
      </section>
      <section aria-labelledby="recorded-quests">
        <SectionHeading id="recorded-quests" note="Player reports agree on this dungeon's quest category and dungeon tag. Each displayed fact keeps its own confirmation rule.">Recorded dungeon quests</SectionHeading>
        {records.quests.length ? <ul className="space-y-2 text-sm text-fg-2">{records.quests.map((quest) => (
          <li key={quest.questId}>
            <Link href={`/database/quests/${quest.questId}`} className={link}>{quest.title ?? `Quest ${quest.questId}`}</Link>
            {quest.side && ` · ${quest.side}`}
            {quest.giverNpcId !== null && <> · given by <Link href={`/database/npcs/${quest.giverNpcId}`} className={link}>NPC {quest.giverNpcId}</Link></>}
            {quest.rewards.length > 0 && <> · rewards: {quest.rewards.map((id, index) => <span key={id}>{index > 0 && ", "}<Link href={`/database/items/${id}`} className={link}>Item {id}</Link></span>)}</>}
          </li>
        ))}</ul> : <p className="text-sm text-muted">No public dungeon quest reports yet. This does not mean there are no quests here.</p>}
      </section>
      <p className="text-sm text-muted">After your run, <Link href="/upload" className={link}>upload the addon's saved data</Link> to help confirm what is here. Gameplay facts appear once three separate installs agree.</p>
    </div>
  );
}

export function DungeonLoadingArt({ art }: { art: LoadingArt | null }) {
  if (!art) return null;
  return (
    <figure className="my-6">
      {/* Approved loading-screen art; never an interior map or evidence of an encounter. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art.small?.url ?? art.url} width={art.small?.width ?? art.width} height={Math.round((art.small?.width ?? art.width) * 9 / 16)} alt="" loading="lazy" className="aspect-video w-full rounded-card object-cover" />
      <figcaption className="mt-2 text-meta text-muted">Loading-screen artwork from the game files. <Link href="/methodology#credits" className={link}>Blizzard artwork credits</Link>. This is not an interior map.</figcaption>
    </figure>
  );
}
