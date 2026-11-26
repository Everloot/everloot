import type { ReactNode } from "react";
import Link from "next/link";
import { Card, type Fact } from "@/components/ui";
import DungeonsAndRaids from "@/components/progress/DungeonsAndRaids";
import type { DungeonsAndRaidsData } from "@/lib/dungeon-clears";
import { metricValue } from "@/lib/armory";
import type { ArmoryCharacter } from "@/lib/armory-store";
import { guildPath, guildsOn } from "@/lib/guilds";
import { optOutPath, type Player } from "@/lib/player-pages";
import { PLAYER_SIGHTING_LINE } from "@/app/players/player-view";
import { link } from "../../parts";

/** The stats the summary shows, in the game's order; the Stats tab lists every one Blizzard read. */
const KEY_STATS = ["Health", "Mana / resource", "Strength", "Agility", "Stamina", "Intellect", "Spirit", "Armor"];

const Pair = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0"><dt className="text-cell-2 text-muted">{label}</dt><dd className="font-mono text-cell tabular-nums text-fg">{children}</dd></div>
);

/**
 * The summary in the model's place of the sheet: the item level large, then the other gear numbers and the board ranks
 * (`ranks`, each a link to its board), then the key stats from the last stats read.
 */
export function SheetSummary({ character: c, ranks }: { character: ArmoryCharacter; ranks: Fact[] }) {
  const stats = c.details?.statistics?.rows ?? [];
  const key = KEY_STATS.flatMap((label) => stats.filter((s) => s.label === label));
  return (
    <section aria-label="Summary" data-sheet-summary className="flex h-full flex-col gap-4 rounded-card border border-edge bg-panel p-4">
      <div>
        <p className="text-cell-2 text-muted">Item level</p>
        <p className="font-mono text-title tabular-nums text-fg">{c.itemLevel !== null ? metricValue("item-level", c.itemLevel) : "Not read"}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {c.averageItemLevel !== null && <Pair label="Average item level">{c.averageItemLevel}</Pair>}
        {c.gearScore !== null && <Pair label="Gear Score">{metricValue("gear-score", c.gearScore)}</Pair>}
        {ranks.map((r, i) => <div key={i} className="min-w-0"><dt className="text-cell-2 text-muted">{r.label}</dt><dd className="font-mono text-cell tabular-nums text-fg">{r.value}</dd></div>)}
      </dl>
      {key.length > 0 && <dl aria-label="Key stats" className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
        {key.map((s) => <Pair key={s.label} label={s.label}>{s.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}{s.percent ? "%" : ""}</Pair>)}
      </dl>}
    </section>
  );
}

/**
 * The character's dungeons and raids (components/progress/DungeonsAndRaids): synced boss kills per instance, below the
 * gear sheet so the sheet stays the first thing on the page.
 */
export function DungeonRaidSlot({ data, href }: { data: DungeonsAndRaidsData; href: string }) {
  return <div data-slot="dungeon-raid-progress"><DungeonsAndRaids data={data} href={href} /></div>;
}

/**
 * What the Everloot addon last saw of this character, when a sighting is certainly this character
 * (lib/character-match.ts): the day, the realm, the level and the guild it saw. The sighting's old address redirects
 * here, so its hide form is offered here too.
 */
export function AddonSighting({ seen }: { seen: Player }) {
  return (
    <Card>
      <section aria-labelledby="armory-addon-sighting" data-part="addon-sighting" className="space-y-3 text-sm">
        <h2 id="armory-addon-sighting" className="text-h2 text-fg">Seen by the Everloot addon</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Pair label="Last seen by the addon">{seen.lastSeen}</Pair>
          <div className="min-w-0"><dt className="text-cell-2 text-muted">Realm</dt><dd className="text-cell text-fg">{seen.realm}</dd></div>
          <Pair label="Level seen">{seen.level}</Pair>
          <div className="min-w-0"><dt className="text-cell-2 text-muted">Guild seen</dt><dd className="text-cell text-fg">
            {seen.guild ? (guildsOn() ? <Link href={guildPath(seen.realm, seen.guild)} className={link}>{seen.guild}</Link> : seen.guild) : "None seen"}
          </dd></div>
        </dl>
        <p className="text-fg-2">
          {PLAYER_SIGHTING_LINE}{" "}
          <Link href={optOutPath(seen)} rel="nofollow" className={link}>Hide this sighting</Link>.
        </p>
      </section>
    </Card>
  );
}
