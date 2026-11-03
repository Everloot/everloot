import Link from "next/link";
import { DataTable, type Column } from "@/components/ui";
import type { FarmArea } from "@/lib/farming";
import { zoneHref, zoneMapHref } from "@/lib/zones";
import { LINK } from "../../database/entity";

export const levelsText = (a: FarmArea) => (a.levels ? (a.levels.min === a.levels.max ? String(a.levels.min) : `${a.levels.min}–${a.levels.max}`) : null);

/**
 * Farming areas as one table: the zone, its continent, the levels players agree on for its mobs, and what backs it:
 * looted mobs, or gathering spots 3 installs placed. The farming page and the gathering professions' pages share it.
 */
export default function FarmAreaTable({ areas, backing, caption }: { areas: FarmArea[]; backing: "mobs" | "nodes"; caption: string }) {
  const dash = <span className="text-muted">—</span>;
  const columns: Column<FarmArea>[] = [
    { key: "zone", header: "Zone", cell: (a) => <Link href={zoneHref(a.zone.mapId, a.zone.name)} className={LINK}>{a.zone.name}</Link> },
    { key: "continent", header: "Continent", cell: (a) => a.zone.continentName },
    ...(backing === "mobs"
      ? [
        { key: "levels", header: "Levels", numeric: true, cell: (a: FarmArea) => levelsText(a) ?? dash },
        { key: "mobs", header: "Looted mobs", numeric: true, cell: (a: FarmArea) => a.mobs },
      ]
      : [{ key: "nodes", header: "Spots", numeric: true, cell: (a: FarmArea) => a.nodes }]),
    { key: "map", header: "Map", cell: (a) => <Link href={zoneMapHref(a.zone.mapId)} className={LINK}>Map</Link> },
  ];
  return (
    <DataTable
      dense
      caption={caption}
      columns={columns}
      rows={areas}
      rowKey={(a) => a.key}
      meta={(a) => [a.zone.name, levelsText(a) && `Levels ${levelsText(a)}`].filter(Boolean).join(" · ")}
    />
  );
}
