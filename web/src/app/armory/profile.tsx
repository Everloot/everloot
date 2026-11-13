import Link from "next/link";
import ItemTip from "@/components/game/ItemTip";
import { SectionHeading } from "@/components/ui";
import { QUALITY_TEXT, type Quality } from "@/components/ui/quality";
import { classTokenOfName, slotLabel } from "@/lib/armory";
import type { ArmoryCharacter } from "@/lib/armory-store";
import type { ItemTip as Tip } from "@/lib/game-assets";
import { ArmoryCredit, link } from "./parts";

const SLOTS = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST", "HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2", "MAIN_HAND", "OFF_HAND", "RANGED"];
const quality = (q: string | null) => QUALITY_TEXT[q?.toLowerCase() as Quality] ?? "text-fg";

export function Equipment({ character: c, tips }: { character: ArmoryCharacter; tips: Map<number, Tip> }) {
  const equipped = new Map(c.equipment.map((item) => [item.slot, item]));
  return <section aria-labelledby="armory-gear" className="space-y-3">
    <SectionHeading id="armory-gear">Equipment</SectionHeading>
    {c.equipment.length === 0 && <p className="text-sm text-fg-2">Nothing equipped when it was read.</p>}
    <ol className="grid gap-x-6 sm:grid-cols-2">
      {SLOTS.map((slot) => {
        const item = equipped.get(slot);
        return <li key={slot} data-equipment-slot={slot} className="min-w-0 border-b border-line py-3">
          <p className="mb-1 text-meta text-muted">{slotLabel(slot)}</p>
          {item ? <div className="flex min-h-11 items-center justify-between gap-3">
            <ItemTip tip={tips.get(item.itemId)} size={36}>
              <Link href={`/database/items/${item.itemId}`} className={`text-sm underline decoration-edge underline-offset-4 hover:decoration-fg ${quality(item.quality)}`}>{item.name}</Link>
            </ItemTip>
            {item.level !== null && <span className="shrink-0 font-mono text-meta tabular-nums text-fg-2" aria-label={`Item level ${item.level}`}>{item.level}</span>}
          </div> : <p className="flex min-h-11 items-center text-sm text-muted">Not equipped</p>}
        </li>;
      })}
    </ol>
    <ArmoryCredit at={c.fetchedAt} />
  </section>;
}

export function ProfileDetailsView({ character: c }: { character: ArmoryCharacter }) {
  const details = c.details;
  if (!details) return null;
  const classSlug = classTokenOfName(c.class).toLowerCase();
  return <>
    {details.statistics && <section aria-labelledby="armory-stats" className="space-y-3">
      <SectionHeading id="armory-stats">Character stats</SectionHeading>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {details.statistics.rows.map((stat) => <div key={stat.label}><dt className="text-meta text-muted">{stat.label}</dt><dd className="font-mono text-lg tabular-nums text-fg">{stat.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}{stat.percent ? "%" : ""}</dd></div>)}
      </dl>
      <ArmoryCredit at={details.statistics.asOf} />
    </section>}
    {details.talents && <section aria-labelledby="armory-talents" className="space-y-3">
      <SectionHeading id="armory-talents">Talents</SectionHeading>
      <div className="divide-y divide-line">
        {details.talents.trees.map((tree) => <div key={tree.name} className="py-3">
          <p className="flex justify-between gap-3 text-sm text-fg"><span>{tree.name}</span><span className="font-mono tabular-nums">{tree.points} points</span></p>
          {tree.talents.length > 0 && <details className="mt-2 text-sm text-fg-2"><summary className="min-h-11 cursor-pointer py-2">Talent details</summary><ul className="space-y-1">{tree.talents.map((talent) => <li key={talent.name} className="flex justify-between gap-3"><span>{talent.name}</span><span className="font-mono tabular-nums">Rank {talent.rank}</span></li>)}</ul></details>}
        </div>)}
      </div>
      {classSlug && <p className="text-sm"><Link href={`/tools/talents/${classSlug}`} className={link}>Plan a build in the talent calculator</Link></p>}
      <ArmoryCredit at={details.talents.asOf} />
    </section>}
    {details.professions && <section aria-labelledby="armory-professions" className="space-y-3">
      <SectionHeading id="armory-professions">Professions</SectionHeading>
      <ul className="space-y-4">{details.professions.rows.map((profession) => <li key={profession.name}>
        <div className="mb-1 flex justify-between gap-3 text-sm"><span className="text-fg">{profession.name}</span><span className="font-mono tabular-nums text-fg-2">{profession.rank} / {profession.max}</span></div>
        <progress className="h-2 w-full accent-accent" value={profession.rank} max={profession.max} aria-label={`${profession.name} skill`} />
      </li>)}</ul>
      <p className="text-sm"><Link href="/tools/professions" className={link}>Find profession leveling routes</Link></p>
      <ArmoryCredit at={details.professions.asOf} />
    </section>}
  </>;
}
