import Link from "@/components/Link";
import type { AuctionHouse } from "@everloot/protocol";
import { SectionHeading } from "@/components/ui";
import { formatCopper } from "@kb/profession-path";

export interface RankedCraft {
  id: number;
  name: string;
  href: string;
  profit: number;
  margin: number | null;
  cost: number;
  value: number;
  stale: boolean;
  cooldown: boolean;
}

export interface RankingSummary {
  /** Recipes that make an item from materials. */
  total: number;
  /** Rows with a known profit. */
  ranked: number;
  unknownOutput: number;
  noSale: number;
  unpriced: number;
}

const money = (copper: number) => (copper < 0 ? `−${formatCopper(-copper)}` : formatCopper(copper));

/**
 * The whole profession ranked by Everloot's estimated profit per craft for one realm and auction house, computed on
 * the server only when the link names both. Everloot's own community market values, the house's cut, one craft each;
 * labelled apart from AH Ledger's margins and with no sales-per-day claim. Not checked against any character.
 */
export default function ProfitRanking({ profession, realmName, house, cutPercent, rows, summary }: {
  profession: string;
  realmName: string;
  house: AuctionHouse;
  cutPercent: number;
  rows: RankedCraft[];
  summary: RankingSummary;
}) {
  const left = summary.total - summary.ranked;
  return (
    <section id="profit-ranking" aria-labelledby="profit-ranking-heading" className="scroll-mt-24 space-y-3" data-profit-ranking={house.toLowerCase()}>
      <SectionHeading id="profit-ranking-heading" as="h2">{`Everloot profit estimates: ${realmName}, ${house}`}</SectionHeading>
      <p className="text-meta text-fg-2">
        Everloot estimate per craft from Everloot&apos;s community market values for this realm and house, after the {cutPercent}% auction cut.
        Materials are bought at market value; a material or result without one is left out, never counted as zero. Separate from AH
        Ledger&apos;s margins, with no sales per day. Recent observations, not live offers; a craft is not checked against any character.
      </p>
      {rows.length > 0 && (
        <p data-ranking-count className="text-meta text-fg-2">
          {rows.length < summary.ranked
            ? `Top ${rows.length.toLocaleString("en-US")} of ${summary.ranked.toLocaleString("en-US")} estimated recipes by profit per craft.`
            : `All ${summary.ranked.toLocaleString("en-US")} estimated recipes by profit per craft.`}
        </p>
      )}
      {rows.length === 0
        ? <p data-empty-state className="py-3 text-cell text-fg-2">No {profession} recipe has a complete estimate on this market yet.</p>
        : <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-cell">
            <caption className="sr-only">{`${profession} recipes by Everloot estimated profit per craft, ${realmName}, ${house}`}</caption>
            <thead>
              <tr className="border-b border-line text-left text-meta text-fg-2">
                <th scope="col" className="py-2 pr-3 font-medium">Recipe</th>
                <th scope="col" aria-sort="descending" className="py-2 pr-3 text-right font-medium">Profit per craft</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Margin</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Materials</th>
                <th scope="col" className="py-2 text-right font-medium">Item value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line" data-ranked={r.id}>
                  <td className="max-w-[18rem] break-words py-2 pr-3">
                    <Link href={r.href} prefetch={false} className="underline decoration-edge underline-offset-4 hover:decoration-fg">{r.name}</Link>
                    {(r.stale || r.cooldown) && <span className="ml-2 text-meta text-muted">{[r.stale ? "stale price" : "", r.cooldown ? "cooldown" : ""].filter(Boolean).join(" · ")}</span>}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{money(r.profit)}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{r.margin === null ? "—" : `${Math.round(r.margin * 100)}%`}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatCopper(r.cost)}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{formatCopper(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      {left > 0 && (
        <p className="text-meta text-fg-2">
          {`${left.toLocaleString("en-US")} of ${summary.total.toLocaleString("en-US")} recipes have no estimate: `}
          {[
            summary.unknownOutput ? `${summary.unknownOutput.toLocaleString("en-US")} with an output count the files do not give` : "",
            summary.noSale ? `${summary.noSale.toLocaleString("en-US")} with no market value for the item` : "",
            summary.unpriced ? `${summary.unpriced.toLocaleString("en-US")} with a material that has no price` : "",
          ].filter(Boolean).join(", ")}.
        </p>
      )}
    </section>
  );
}
