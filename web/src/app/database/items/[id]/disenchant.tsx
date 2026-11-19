import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable, type Column } from "@/components/ui";
import { chanceText } from "@/lib/disenchant";
import { bandLabel, unitsRange, type BandYield, type DisenchantTally, type Placement, type YieldRow } from "@kb/disenchant";
import { INDEPENDENT_INSTALLS } from "@kb/drop-rollup";
import { EmptyTab, LINK } from "../../entity";

const NOTE = "py-2 text-meta text-fg-2";
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** Whether an item page shows a Disenchant tab: the files place it in a band, or say it cannot be disenchanted. */
export const showsDisenchant = (placement: Placement) => placement.kind !== "none";

/**
 * The Disenchant tab of an item page: what its band gives, once 3 installs disenchanted items in the band, with the
 * denominator beside every number; before that, what is missing. A material's average counts the disenchants that
 * gave none of it.
 */
export function DisenchantPanel({ placement, band, own, title, item }: {
  placement: Placement;
  band: BandYield | null;
  /** Disenchants of this very item, if any were recorded. */
  own: DisenchantTally | undefined;
  title: string;
  item: (itemId: number) => ReactNode;
}) {
  if (placement.kind === "no-disenchant") {
    return <EmptyTab message="The game files mark this item as one that cannot be disenchanted." players={false} action={null} />;
  }
  if (placement.kind !== "band" || !band) return null;
  const where = `${bandLabel(band.band)}${placement.from === "players" ? " (placed by the item level players' tooltips reported)" : ""}`;
  const ownLine = own?.windows ? <p className={NOTE}>{`${plural(own.windows, "disenchant")} of this item itself recorded, from ${plural(own.installs.size, "install")}.`}</p> : null;
  const tool = <p className={NOTE}><Link href="/tools/disenchanting" className={LINK}>What this band is worth on your auction house</Link></p>;
  if (band.state !== "rated") {
    const missing = band.state === "none"
      ? `No disenchants recorded in this band yet. Its results show once ${INDEPENDENT_INSTALLS} installs disenchanted an item in it.`
      : `${plural(band.windows, "disenchant")} in this band from ${plural(band.installs, "install")}. Its results show once ${INDEPENDENT_INSTALLS} installs disenchanted an item in it: ${band.missingInstalls} more.`;
    return <>
      <p className="py-3 text-meta text-fg">{`Disenchanting ${title} draws from the band for ${where}.`}</p>
      <p className={NOTE}>{missing}</p>
      {ownLine}
    </>;
  }
  const columns: Column<YieldRow>[] = [
    { key: "material", header: "Material", cell: (r) => item(r.materialId) },
    { key: "chance", header: "Chance", numeric: true, cell: (r) => chanceText(r.chance) },
    { key: "with", header: "Disenchants with it", numeric: true, cell: (r) => `${r.withMaterial} of ${r.windows}` },
    { key: "each", header: "Each time", numeric: true, nowrap: true, cell: (r) => unitsRange(r) },
    { key: "mean", header: "Average", numeric: true, cell: (r) => r.perDisenchant.toFixed(2) },
  ];
  const dated = band.first && band.last ? (band.first === band.last ? `, dated ${band.first}` : `, dated ${band.first} to ${band.last}`) : "";
  return <>
    <p className="py-3 text-meta text-fg">{`Disenchanting ${title} draws from the band for ${where}: every item in it gives from the same table.`}</p>
    <DataTable dense caption={`What disenchanting ${title} gives`} columns={columns} rows={band.rows} rowKey={(r) => String(r.materialId)} />
    <p className={NOTE}>{`Out of ${plural(band.windows, "disenchant")} in the band from ${plural(band.installs, "install")}${dated}, recorded by the Everloot addon. The average counts the disenchants that gave none of a material; it is not the next result.`}</p>
    {ownLine}
    {tool}
  </>;
}
