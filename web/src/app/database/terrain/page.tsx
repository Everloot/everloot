import type { Metadata } from "next";
import Link from "next/link";
import TerrainGearTable, { type GearNames } from "@/components/TerrainGearTable";
import { Container, DataTitle, SectionHeading } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { loadItemTips, loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { instanceHref, instanceRows } from "@/lib/instances";
import { CLIENT_LAYER } from "@/lib/items";
import { itemNames } from "@/lib/names";
import { loadItemFacts } from "@/lib/rollup-compute";
import { pageMetadata } from "@/lib/seo";
import { speedGear, TERRAIN_BUILD, TERRAIN_PATH, terrainGear, terrainTypes } from "@/lib/terrain";
import { zoneByMapId, zoneHref } from "@/lib/zones";
import { LINK } from "../entity";

export const metadata: Metadata = pageMetadata({
  title: "WoW Forever Terrain Types and Speed Gear",
  description: "Which WoW: Forever zones and instances count as Desert, Snowy, Swamp, Haunted and the other terrain types, the gear whose effect needs them, and every item that changes run, mount or swim speed. From the game files.",
  path: TERRAIN_PATH,
});
export const dynamic = "force-dynamic";

/**
 * The terrain types the game files name, each with its zones and instances and the gear bound to it, then every item
 * that changes speed. All of it is read from data/game-data/client-terrain.json; names follow the site's name rules.
 */
export default async function TerrainPage() {
  const types = terrainTypes();
  const gear = terrainGear();
  const speed = speedGear(gear);
  const instances = new Map([...instanceRows()].map(([id, r]) => [id, r.name]));
  const ids = [...new Set(gear.map((g) => g.itemId))];
  const [facts, spells, assets] = await Promise.all([loadItemFacts(), loadSpellNames(CLIENT_LAYER.build.version), loadSiteAssets()]);
  const tips = await loadItemTips(assets, ids);
  const named = facts.unreachable ? new Map<number, string>() : itemNames(facts);
  const names: GearNames = {
    item: (id) => ({ name: named.get(id) ?? tips.get(id)?.name, icon: tips.get(id)?.icon }),
    spell: (id) => spells?.names.get(id),
    instances,
  };
  const zoneLink = (id: number) => {
    const z = zoneByMapId(id);
    return z ? <Link href={zoneHref(id, z.name)} className={LINK}>{z.name}</Link> : null;
  };

  return (
    <Container width="data">
      <article>
        <DataTitle title="Terrain and speed gear" trail={trailFor(TERRAIN_PATH) ?? undefined} />
        <p className="mb-6 max-w-[70ch] text-fg-2">
          Some item effects in WoW: Forever work only on one kind of ground, such as Desert or Snowy areas. The game files
          list the areas each kind covers. Below are the zones and instances of each terrain type, the gear bound to it, and
          every item that changes run, mount or swim speed. Read from the game files, build {TERRAIN_BUILD}: found in game
          files, unconfirmed.
        </p>

        <nav aria-label="Terrain types" className="mb-8 flex flex-wrap gap-2">
          {types.map((t) => (
            <a key={t.slug} href={`#${t.slug}`} className="inline-flex h-6 items-center rounded-full border border-line px-2.5 font-mono text-xs text-fg-2 hover:text-fg">{t.name}</a>
          ))}
          <a href="#speed" className="inline-flex h-6 items-center rounded-full border border-line px-2.5 font-mono text-xs text-fg-2 hover:text-fg">Speed gear</a>
        </nav>

        <div className="space-y-10">
          {types.map((t) => {
            const bound = gear.filter((g) => g.terrain?.groupId === t.groupId);
            const shownInstances = t.instances.filter((id) => instances.has(id));
            return (
              <section key={t.slug} aria-labelledby={t.slug} data-terrain={t.slug}>
                <SectionHeading id={t.slug} note={`${t.zones.length} ${t.zones.length === 1 ? "zone" : "zones"}${t.parts.size ? `, parts of ${t.parts.size} more` : ""}, ${shownInstances.length} ${shownInstances.length === 1 ? "instance" : "instances"}, ${bound.length} ${bound.length === 1 ? "item effect" : "item effects"}`}>
                  {t.name}
                </SectionHeading>
                <dl className="mb-4 space-y-2 text-sm">
                  {t.zones.length > 0 && (
                    <div><dt className="inline font-semibold text-fg">Zones: </dt><dd className="inline text-fg-2">{t.zones.map((id, i) => <span key={id}>{i > 0 && ", "}{zoneLink(id)}</span>)}</dd></div>
                  )}
                  {t.parts.size > 0 && (
                    <div><dt className="inline font-semibold text-fg">Parts of zones: </dt><dd className="inline text-fg-2">{[...t.parts].map(([id, parts], i) => <span key={id}>{i > 0 && "; "}{parts.join(", ")} in {zoneLink(id)}</span>)}</dd></div>
                  )}
                  {shownInstances.length > 0 && (
                    <div><dt className="inline font-semibold text-fg">Instances: </dt><dd className="inline text-fg-2">{shownInstances.map((id, i) => <span key={id}>{i > 0 && ", "}<Link href={instanceHref(id, instances.get(id) ?? null)} className={LINK}>{instances.get(id) ?? `Instance ${id}`}</Link></span>)}</dd></div>
                  )}
                </dl>
                {bound.length > 0 && <TerrainGearTable gear={bound} names={names} caption={`Gear whose effect needs ${t.name}`} />}
              </section>
            );
          })}

          <section aria-labelledby="speed" data-terrain="speed">
            <SectionHeading id="speed" note="Every item effect the game files give a run, mount or swim speed bonus, fastest first. A Use effect lasts a short time; an Equip effect lasts while it is worn.">
              Speed gear
            </SectionHeading>
            <TerrainGearTable gear={speed} names={names} caption="Items that change run, mount or swim speed" />
          </section>
        </div>

        <p className="mt-8 text-meta text-muted">
          Game data © Blizzard Entertainment, read from the public client; not under Everloot&apos;s licence. Column names from WoWDBDefs, CC BY-SA 4.0.
        </p>
      </article>
    </Container>
  );
}
