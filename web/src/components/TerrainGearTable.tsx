import Link from "next/link";
import EntityLink from "@/components/EntityLink";
import { GAME_NAME_TITLE } from "@/components/EntityRelations";
import { Badge, DataTable, type Column } from "@/components/ui";
import { instanceHref } from "@/lib/instances";
import { speedLabel, TERRAIN_PATH, triggerLabel, type TerrainGear } from "@/lib/terrain";
import { zoneByMapId, zoneHref } from "@/lib/zones";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

export interface GearNames {
  item: (id: number) => { name?: string | null; icon?: string | null };
  /** A spell name from the game files, shown with the unconfirmed marker. */
  spell: (id: number) => string | undefined;
  /** The instances that have a page, by map id, with their names. */
  instances: ReadonlyMap<number, string | null>;
}

/** Where an effect works: its terrain type, the zones and instances of its zone list, or anywhere. */
function Where({ gear, names, zone }: { gear: TerrainGear; names: GearNames; zone?: number }) {
  if (gear.terrain) {
    const parts = zone !== undefined && !gear.terrain.zones.includes(zone) ? gear.terrain.parts.get(zone) : undefined;
    return <><Link href={`${TERRAIN_PATH}#${gear.terrain.slug}`} className={link}>{gear.terrain.name}</Link>{parts ? <span className="text-fg-2">{` · here: ${parts.join(", ")}`}</span> : null}</>;
  }
  if (gear.places) {
    const places = [
      ...gear.places.zones.flatMap((id) => { const z = zoneByMapId(id); return z ? [{ key: `z${id}`, href: zoneHref(id, z.name), name: z.name }] : []; }),
      ...gear.places.instances.flatMap((id) => (names.instances.has(id) ? [{ key: `i${id}`, href: instanceHref(id, names.instances.get(id) ?? null), name: names.instances.get(id) ?? `Instance ${id}` }] : [])),
    ];
    return places.length ? <>{places.map((p, i) => <span key={p.key}>{i > 0 && ", "}<Link href={p.href} className={link}>{p.name}</Link></span>)}</> : <span className="text-fg-2">Unreleased places</span>;
  }
  return <span className="text-fg-2">Anywhere</span>;
}

/**
 * Items whose effect needs a kind of ground or changes speed, from the game files: the item, its effect (the spell, by
 * its game-file name, and the speed it gives), how it fires and where it works. Names follow the site's name rules;
 * a row with no name keeps "Item N" / "Spell N".
 */
export default function TerrainGearTable({ gear, names, caption, zone, empty }: { gear: readonly TerrainGear[]; names: GearNames; caption: string; zone?: number; empty?: string }) {
  const columns: Column<TerrainGear>[] = [
    { key: "item", header: "Item", cell: (g) => <EntityLink kind="item" id={g.itemId} {...names.item(g.itemId)} /> },
    { key: "effect", header: "Effect", cell: (g) => {
      const spell = names.spell(g.spellId);
      const speed = speedLabel(g.speed);
      return (
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <Link href={`/database/spells/${g.spellId}`} title={spell ? GAME_NAME_TITLE.files : undefined} className={link}>{spell ?? `Spell ${g.spellId}`}</Link>
          {spell ? <Badge tone="files" /> : null}
          {speed ? <span className="font-mono text-meta tabular-nums text-fg-2">{speed}</span> : null}
        </span>
      );
    } },
    { key: "how", header: "How", cell: (g) => triggerLabel(g.trigger) },
    { key: "where", header: "Works in", cell: (g) => <Where gear={g} names={names} zone={zone} /> },
  ];
  return <DataTable dense caption={caption} columns={columns} rows={[...gear]} rowKey={(g) => `${g.itemId}-${g.spellId}`} empty={empty} />;
}
