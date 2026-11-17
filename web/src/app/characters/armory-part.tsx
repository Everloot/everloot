import Link from "next/link";
import { Facts, SectionHeading } from "@/components/ui";
import { Equipment, ProfileDetailsView } from "@/app/armory/profile";
import { ArmoryCredit, day, link } from "@/app/armory/parts";
import { armoryCharacterPath, metricValue } from "@/lib/armory";
import { shownCharacter, type CharacterArmory } from "@/lib/character-armory";
import type { ItemTip } from "@/lib/game-assets";

/** The heading of Blizzard's part of a character page: the source and the day of the read. */
export const armoryHeading = (fetchedAt: string) => `From Blizzard's API, ${day(fetchedAt) ?? "read time unrecorded"}`;

/**
 * Blizzard's data for a linked character, as its own part of the page: never mixed into the owner's uploads, labelled
 * with its source and the time of the read, and credited. Each section carries its own read time. Only the parts the
 * caller allows reach the markup (shownCharacter).
 */
export function ArmoryPart({ armory, tips }: { armory: CharacterArmory; tips: Map<number, ItemTip> }) {
  const c = shownCharacter(armory.character, armory.shown);
  const numbers = [
    ...(c.itemLevel !== null ? [{ label: "Item level", value: metricValue("item-level", c.itemLevel), numeric: true }] : []),
    ...(c.gearScore !== null ? [{ label: "Gear Score", value: metricValue("gear-score", c.gearScore), numeric: true }] : []),
    ...(c.honorableKills !== null ? [{ label: "Honorable kills", value: metricValue("honorable-kills", c.honorableKills), numeric: true }] : []),
    ...(c.pvpRank !== null ? [{ label: "PvP rank", value: c.pvpRank, numeric: true }] : []),
  ];
  return (
    <section aria-labelledby="character-armory" data-part="armory" className="space-y-8">
      <div className="space-y-3">
        <SectionHeading id="character-armory">{armoryHeading(c.fetchedAt)}</SectionHeading>
        {numbers.length > 0 && <Facts label="From Blizzard's API" items={numbers} />}
        <p className="text-sm">
          <Link href={armoryCharacterPath(c.region, c.slug)} className={link}>{c.name} {c.surname} in the armory</Link>
        </p>
        <ArmoryCredit at={c.fetchedAt} />
      </div>
      {armory.shown.gear && <Equipment character={c} tips={tips} />}
      <div className="space-y-8"><ProfileDetailsView character={c} /></div>
    </section>
  );
}
