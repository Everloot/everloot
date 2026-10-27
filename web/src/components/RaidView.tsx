import AdSlot from "@/components/AdSlot";
import JsonLd from "@/components/JsonLd";
import { Container, Disclosure, PageHeader, SectionHeading } from "@/components/ui";
import RaidBuilder from "./RaidBuilder";
import { CURRENT_BUILD, TABLES } from "@/data/game-data/raid";
import { trailFor } from "@/lib/breadcrumbs";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { raidTalentFacts } from "@/lib/raid-facts";
import { BANNER_MAP, loadingArt, loadSiteAssets, raidArt } from "@/lib/game-assets";
import { BannerArt } from "@/components/game/PageBanner";

export const TITLE = "WoW Forever Raid Buff Planner";
// The page's lead line carries no "unconfirmed" sentence (owner rule, 2026-10-20); the meta description keeps it.
const lede = "Fill a 10, 20 or 40 player WoW: Forever raid with classes and talent trees to see which buffs and debuffs each group gets.";
export const description = `${lede} Rules are unconfirmed.`;

const PROOF: Record<string, string> = {
  "talent spell": "a talent has the effect's spell",
  "spell chain": "a talent spell learns or triggers it",
  "talent name": "a talent has the same name",
};

/**
 * The raid planner page body. The page renders it with a class hub's context chip under the title (`classContext`,
 * drawn by the planner, which holds the raid its links keep); a raid link (/tools/raid/r/<code>) renders it with the
 * raid to open.
 */
export default async function RaidView({ initialCode, classContext }: { initialCode?: string; classContext?: boolean } = {}) {
  const facts = raidTalentFacts(TABLES[CURRENT_BUILD]);
  // Class, tree and buff icons and a raid's loading screen, only when the asset URL is set and the upload has them.
  const assets = await loadSiteAssets();
  const art = raidArt(assets, TABLES[CURRENT_BUILD]);
  const banner = loadingArt(assets, BANNER_MAP.raid);
  return (
    <Container>
      <JsonLd data={webApplicationJsonLd({ name: TITLE, path: "/tools/raid", description: lede })} />
      <PageHeader
        trail={trailFor("/tools/raid")!}
        title={TITLE}
        lede={lede}
        banner={banner && assets ? { image: <BannerArt art={banner} eager /> } : undefined}
      />

      <RaidBuilder art={art} initialCode={initialCode} classContext={classContext} />
      <AdSlot slot="belowTool" />

      {/* The explanations stay on the page for readers and search engines, closed until asked for. */}
      <section aria-labelledby="questions" className="mt-12">
        <SectionHeading id="questions">Questions</SectionHeading>
        <Disclosure summary="Which raid buffs need a talent?">
          <p>
            In the game files of build {facts.build}, {facts.talent.length} of the effects the planner counts come only through a
            talent{facts.unknownTree.length ? `, and ${facts.unknownTree.length} more have talent matches in more than one tree` : ""}.
            The other {facts.baseline} come with the class. Unconfirmed until seen in play.
          </p>
          <ul className="list-disc space-y-1 pl-6">
            {facts.talent.map((b) => (
              <li key={`${b.class}-${b.label}`}>
                <span className="text-fg">{b.label}</span>: {b.class}, {b.tree} tree{b.proof ? ` (${PROOF[b.proof] ?? b.proof})` : ""}
              </li>
            ))}
            {facts.unknownTree.map((b) => (
              <li key={`${b.class}-${b.label}`}>
                <span className="text-fg">{b.label}</span>: {b.class}, tree unknown
              </li>
            ))}
          </ul>
        </Disclosure>
        <Disclosure summary="How do I read the planner?">
          <p>
            Drag a class into a slot, or pick a class and then a slot; pick a filled slot to set its talent tree.
            Drag a member to another slot to move or swap it, or off the groups to remove it. Each group holds
            five. The coverage shows what the classes you
            picked can bring, not what a raid has assigned: a shaman is counted as able to bring every totem, even
            though one shaman drops one totem per element.
          </p>
          <p>
            A party effect counts for the group that holds the provider. A raid effect counts for every group.
            Buffs cast on players one at a time are marked &ldquo;Cast&rdquo;, because someone has to cast them.
            Effects in one family, such as Mark of the Wild and Gift of the Wild, count once. Whether the Tranquil
            Air, Windfury and Grace of Air totems stack across different shamans is not modelled.
          </p>
        </Disclosure>
        <Disclosure summary="Where do the rules come from?">
          <p>
            Everything here is read from the game files of build {CURRENT_BUILD} and is unconfirmed until it is
            seen in play. Where the files do not settle how far an effect reaches, or its ranks disagree, it reads
            &ldquo;unknown&rdquo; and is not counted as covered. Where a talent gives a class an effect, the
            tree comes from the game&apos;s talent data, and a slot set to the wrong tree does not count; an effect
            with no talent behind it comes with the class.
            Rules stay in data, per build, so a change in a later build is a new row and not a code change.
          </p>
        </Disclosure>
        <Disclosure summary="Can the addon fill in my raid?">
          <p>
            The Everloot addon can list the raid buffs missing in each group of your current raid with{" "}
            <span className="font-mono">/everloot raid</span>, and{" "}
            <span className="font-mono">/everloot raid code</span> gives a link that opens the same raid here. It only
            reads your group and displays; it never casts or acts for you. It cannot read other players&apos; talent
            trees, so those slots come in as &ldquo;any tree&rdquo;.
          </p>
        </Disclosure>
      </section>
    </Container>
  );
}
