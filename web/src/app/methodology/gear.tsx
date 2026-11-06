import Link from "next/link";
import { SectionHeading } from "@/components/ui";
import { GEAR_SCORE_DIVISOR, GEAR_SCORE_VERSION, GEAR_WEIGHTS_BUILD, GROUP_BUDGET } from "../../../../kb/src/gear-score";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

const GROUPS: { slots: string; budget: number }[] = [
  { slots: "Head, chest, legs", budget: GROUP_BUDGET.major },
  { slots: "Shoulders, hands, waist, feet, both trinkets", budget: GROUP_BUDGET.minor },
  { slots: "Neck, back, wrists, both rings, off hand", budget: GROUP_BUDGET.small },
  { slots: "Main hand", budget: GROUP_BUDGET.weapon },
  { slots: "Ranged, thrown, wand or relic", budget: GROUP_BUDGET.ranged },
];

/** How the gear rankings count (docs/DATA_POLICY.md, "Gear rankings"); shown only while the boards are on. */
export function GearSection() {
  return (
    <section aria-labelledby="gear-rankings">
      <SectionHeading id="gear-rankings">Item level and Gear Score</SectionHeading>
      <div className="space-y-4 text-fg-2">
        <p>
          The <Link href="/rankings/item-level" className={link}>item level</Link> and{" "}
          <Link href="/rankings/gear-score" className={link}>Gear Score</Link> rankings list only characters whose player linked them,
          made the page public, turned gear sync on and chose Rank my gear. The gear is what that player&apos;s own addon last sent, in the
          last 30 days. It is not checked with Blizzard.
        </p>
        <p>
          Both numbers are averages over the same 17 equipment slots, shirt and tabard left out. An empty slot counts 0, so one good item
          and nothing else ranks low, and a two-handed weapon fills both hands. Each item counts at the game files&apos; item level for
          it. Gear with an item the files do not list or a page may not show yet, a level that differs from the files, or an item in a
          slot it cannot go in is not counted at all. Both numbers are rounded down.
        </p>
        <p>
          <span className="text-fg">Item level</span> is the plain average. <span className="text-fg">Gear Score</span> ({GEAR_SCORE_VERSION}) is
          Everloot&apos;s own formula: each slot&apos;s item level times its weight, summed, divided by {GEAR_SCORE_DIVISOR} (the weights&apos;
          total), so a full set at one item level scores that item level. The weights are each slot&apos;s stat budget at item level 60,
          Epic column, in the game&apos;s <span className="font-mono">RandPropPoints</span> table, read from build{" "}
          <span className="font-mono">{GEAR_WEIGHTS_BUILD}</span> (found in game files, unconfirmed). Which slot falls in which group is the
          long-documented classic mapping, not something the files state. A new weight is a new version.
        </p>
        <table className="w-full max-w-xl border-collapse text-sm">
          <caption className="sr-only">Gear Score weights</caption>
          <thead>
            <tr className="border-b border-line text-left text-fg"><th className="py-2 font-medium">Slots</th><th className="py-2 text-right font-medium">Weight</th></tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <tr key={g.slots} className="border-b border-line"><td className="py-2">{g.slots}</td><td className="py-2 text-right font-mono tabular-nums">{g.budget}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
