import Link from "next/link";
import { Container, PageHeader, SectionHeading } from "@/components/ui";
import { pageMetadata } from "@/lib/seo";
import { DARKMOON, DARKMOON_HREF, DARKMOON_STATUS, darkmoonSearchHref } from "@/lib/darkmoon";

export const metadata = pageMetadata({
  title: "Darkmoon Faire storage box and ticket items",
  description: "Jerome’s community Darkmoon Faire checklist: turn-in quantities, ticket rewards and reported levels, with the details still awaiting verification in Forever.",
  path: DARKMOON_HREF,
});

export default function DarkmoonGuide() {
  return (
    <Container width="data">
      <PageHeader title="Darkmoon Faire: items to save for a storage box" lede="A community checklist for comparing ticket turn-ins before you buy or sell." />
      <p className="mt-4 text-sm text-muted">{DARKMOON_STATUS}. Source read {DARKMOON.source.readOn}.</p>
      <section className="mt-8 space-y-3" aria-labelledby="box-goal">
        <SectionHeading id="box-goal">Start with the reward and your available turn-ins</SectionHeading>
        <p>Jerome’s calculator uses {DARKMOON.boxTicketGoal} tickets as the goal for one storage box. The box’s exact item identity, capacity and ticket cost still need verification in Forever. Check the reward in game before spending gold.</p>
        <p>The sheet suggests 10 Small Furry Paws and 20 Vibrant Plumes: two paw turn-ins give 2 tickets and four plume turn-ins give 48. That reaches 50 tickets only if both turn-ins are available to your character. This is a planning example, not a guaranteed cheapest route.</p>
        <p>Save the listed items while you check their use. Follow an item’s search link to look for its database page, sources and market information. A search may have no recorded match yet.</p>
      </section>
      <section className="mt-8 space-y-3" aria-labelledby="turnins">
        <SectionHeading id="turnins">Ticket turn-in checklist</SectionHeading>
        <p className="text-sm text-muted">Every value below is reported by the spreadsheet, read with its current-reputation input set to {DARKMOON.source.currentReputation}. Its reputation caps are disputed in its own notes; the listed maximums depend on that input and are not independent allowances for each item. “Unlimited” is also an unverified sheet claim.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Community-reported Darkmoon Faire turn-ins, unverified in Forever</caption>
            <thead className="border-b border-line"><tr>{["Item", "Per turn-in", "Tickets", "Minimum level", "Sheet maximum turn-ins"].map((h) => <th key={h} scope="col" className="p-3">{h}</th>)}</tr></thead>
            <tbody>{DARKMOON.turnins.map((row) => (
              <tr key={row.name} data-darkmoon-row={row.name} className="border-b border-line">
                <th scope="row" className="p-3 font-medium"><Link href={darkmoonSearchHref(row.name)} className="underline">{row.name}</Link></th>
                <td className="p-3 tabular-nums">{row.quantity}</td><td className="p-3 tabular-nums">{row.tickets}</td>
                <td className="p-3 tabular-nums">{row.minLevel}</td><td className="p-3 tabular-nums">{row.sheetMaxTurnins ?? "Unlimited (sheet claim)"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <section className="mt-8 space-y-3" aria-labelledby="before-buying">
        <SectionHeading id="before-buying">Before buying a stack</SectionHeading>
        <ul className="list-disc space-y-2 pl-5">
          <li>Check the quest’s required level, your reputation and whether the turn-in is still offered.</li>
          <li>Subtract tickets you already hold from your goal, then count whole turn-ins. Extra tickets may remain.</li>
          <li>Compare cost per ticket: item price × quantity per turn-in ÷ tickets awarded. Use current prices from your realm and auction house; the sheet’s example prices are not live Everloot prices.</li>
          <li>Confirm the Faire’s location and availability in game. This reference does not establish its schedule.</li>
        </ul>
      </section>
      <section className="mt-8 space-y-3" aria-labelledby="source">
        <SectionHeading id="source">Source and verification</SectionHeading>
        <p>Based on <a href={DARKMOON.source.url} className="underline">Jerome’s DMF Calculator Sheet</a>, Tickets tab. Credit to the original calculator; Everloot summarizes its turn-in values here. Make a copy of the original to change its inputs.</p>
        <p>These community claims are kept separate from player-confirmed drops, vendors and quest rewards. The reward identity, quantities, ticket yields, minimum levels and reputation restrictions remain unverified in Forever.</p>
        <Link href="/guides" className="inline-block underline">Back to Guides</Link>
      </section>
    </Container>
  );
}
