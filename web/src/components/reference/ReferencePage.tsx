import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { entityPageJsonLd } from "@/lib/jsonld";
import { chainHref, factionHref, titleHref } from "@/lib/completion-lists";
import { CodeBlock, Container, PageHeader, SectionHeading } from "@/components/ui";
import { REFERENCE_GUIDES, REFERENCE_GUIDES_PUBLISHED, type ReferenceSlug } from "@/lib/reference-guides";
import { GLOSSARY, FIRST_WEEK, RAID_CHECKLIST, PRIMARY_STATS, COMBAT_STATS, PVP_RANK_REWARDS } from "@/data/reference-content";
import { SPELL_SOURCE, SPELL_BUILD, SPELL_NOTE, STARTER_MACROS } from "@/data/reference-spells";
import { Checklist, CopyMacro, KeyboardMap } from "./controls";

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const UI_ROOT = "https://github.com/Gethe/wow-ui-source/blob/bebcb6bf309cf41b41bd74f8ca651e6a105b2676/Interface/AddOns/";
const DATA_ROOT = "https://github.com/Everloot/everloot/blob/8c4fed9166291b10441261f1600897cb17736e17/web/src/data/game-data/";
const UI_STATS = `${UI_ROOT}Blizzard_UIPanels_Game/Camelot/PaperDollFrameStats.lua`;
const UI_COMMANDS = `${UI_ROOT}Blizzard_ChatFrameBase/Shared/SlashCommands.lua`;
const PVP_SOURCE = "https://worldofwarcraft.blizzard.com/en-us/news/24303316";
const BG_SOURCE = "https://worldofwarcraft.blizzard.com/en-us/news/24307308";
const RAID_SOURCE = "https://worldofwarcraft.blizzard.com/en-us/news/24303009";
type Source = { title: string; url: string };
const SOURCES: Record<ReferenceSlug, Source[]> = {
  glossary: [{ title: "Forever character-stat UI", url: UI_STATS }, { title: "Forever secure commands", url: UI_COMMANDS }, { title: "Forever spell tooltips", url: SPELL_SOURCE }, { title: "Blizzard: PvP progression", url: PVP_SOURCE }, { title: "Blizzard: raid overview and attunement", url: RAID_SOURCE }],
  keybinds: [{ title: "Forever spell tooltips", url: SPELL_SOURCE }, { title: "Class-to-spell membership", url: `${DATA_ROOT}client-class-spells.json` }],
  macros: [{ title: "Forever secure-command handlers", url: UI_COMMANDS }, { title: "Forever macro execution", url: `${UI_ROOT}Blizzard_ChatFrameBase/Shared/MacroExecutionManager.lua` }, { title: "Forever macro editor", url: `${UI_ROOT}Blizzard_MacroUI/Blizzard_MacroUI.lua` }, { title: "Forever spell tooltips", url: SPELL_SOURCE }, { title: "Class-to-spell membership", url: `${DATA_ROOT}client-class-spells.json` }],
  stats: [{ title: "Forever stat calculations and tooltip wiring", url: UI_STATS }, { title: "Forever stat categories", url: `${UI_ROOT}Blizzard_UIPanels_Game/Camelot/PaperDollFrameConstants.lua` }, { title: "Forever character-panel spell and healing stats", url: `${UI_ROOT}Blizzard_UIPanels_Game/Camelot/PaperDollFrame.lua` }],
  pvp: [{ title: "Blizzard: PvP progression", url: PVP_SOURCE }, { title: "Blizzard: Darkspear Islands", url: BG_SOURCE }, { title: "Forever faction records", url: `${DATA_ROOT}client-factions.json` }, { title: "Forever quest-line records", url: `${DATA_ROOT}client-quest-lines.json` }, { title: "Forever title records", url: `${DATA_ROOT}client-titles.json` }],
  "raid-prep": [{ title: "Blizzard: raid overview and attunement", url: RAID_SOURCE }, { title: "Forever recipe outputs", url: `${DATA_ROOT}client-recipes.json` }, { title: "Forever item relationships", url: `${DATA_ROOT}client-layer.json` }, { title: "Forever quest-line records", url: `${DATA_ROOT}client-quest-lines.json` }, { title: "Forever resistance tooltip calculation", url: UI_STATS }],
};

function Glossary() {
  const letters = [...new Set(GLOSSARY.map(([, term]) => term[0].toUpperCase()))];
  return <>
    <p>These are plain-language explanations of terms used by the client and Blizzard’s announcements. They describe vocabulary, not a class rotation or a promise about an encounter.</p>
    <nav aria-label="Glossary A to Z" className="flex flex-wrap gap-3">{letters.map((letter) => <a className={LINK} key={letter} href={`#letter-${letter.toLowerCase()}`}>{letter}</a>)}</nav>
    {letters.map((letter) => <section key={letter} aria-labelledby={`letter-${letter.toLowerCase()}`}><SectionHeading id={`letter-${letter.toLowerCase()}`}>{letter}</SectionHeading><dl className="space-y-4">{GLOSSARY.filter(([, term]) => term[0].toUpperCase() === letter).map(([id, term, meaning]) => <div key={id} id={id} className="scroll-mt-24"><dt className="font-semibold"><a href={`#${id}`} className={LINK}>{term}</a></dt><dd className="mt-1 text-fg-2">{meaning}</dd></div>)}</dl></section>)}
    <section aria-labelledby="first-week"><SectionHeading id="first-week">Your first week</SectionHeading><Checklist storageKey="everloot.reference.first-week.v1" items={FIRST_WEEK} /></section>
  </>;
}

const COMMANDS = [
  ["/cast", "Casts the named spell. The handler checks that the spell exists before trying to cast it.", "CAST"],
  ["/use", "Uses the named item or bag/slot reference; the handler can also fall back to a spell.", "USE"],
  ["/stopcasting", "Stops the current cast through SpellStopCasting.", "STOPCASTING"],
  ["/startattack", "Starts attacking the parsed target through StartAttack.", "STARTATTACK"],
  ["/stopattack", "Stops attacking through StopAttack.", "STOPATTACK"],
  ["/cancelaura", "Cancels a named aura or a numeric spell ID through the matching cancellation API.", "CANCELAURA"],
];
function Macros() {
  return <>
    <section aria-labelledby="macro-basics"><SectionHeading id="macro-basics">What a macro is</SectionHeading><p>A macro stores command text behind a button. The Forever UI’s macro execution callback sends each line through its chat edit-box command handler. Open the macro editor, create a macro and use a spell your character has learned. For a first macro, replace the placeholder below with its exact name, then place the macro button on an action bar. These English spell names need the matching name on other client languages.</p><CodeBlock label="Macro command template">{"/cast <spell name from your spellbook>"}</CodeBlock><p>The class examples below make one named cast. They are not a rotation. Command presence in UI code is not an in-game test of the macro, its target or talent availability.</p></section>
    <section aria-labelledby="conditions"><SectionHeading id="conditions">Conditions: verification pending</SectionHeading><p>The handlers call <code>SecureCmdOptionParse</code>, but the inspected Lua does not enumerate the accepted condition tokens. No bracket condition is verified here. Classic-era condition lists are not confirmed for Forever and have been left out.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Condition verification status</caption><thead><tr><th scope="col" className="p-3">Verified condition</th><th scope="col" className="p-3">Status</th></tr></thead><tbody><tr className="border-t border-line"><td className="p-3">None listed</td><td className="p-3">Not confirmed yet. The starters below use no conditions.</td></tr></tbody></table></div></section>
    <section aria-labelledby="commands"><SectionHeading id="commands">Commands found in Forever UI code</SectionHeading><div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Secure-command handlers in the pinned Forever UI source</caption><thead><tr><th scope="col" className="p-3">Command</th><th scope="col" className="p-3">Handler behavior</th><th scope="col" className="p-3">Source key</th></tr></thead><tbody>{COMMANDS.map(([command, meaning, symbol]) => <tr key={command} className="border-t border-line"><th scope="row" className="p-3 font-mono">{command}</th><td className="p-3">{meaning}</td><td className="p-3"><a className={LINK} href={UI_COMMANDS}>{symbol}</a></td></tr>)}</tbody></table></div></section>
    <section aria-labelledby="starters"><SectionHeading id="starters">Talent-dependent examples, one per class</SectionHeading><p>These are not starting-level abilities. Each example requires its specific talent; check your talent tree before using it. The command template above also works with an ability you already know.</p><p className="text-sm text-muted">{SPELL_NOTE} Build {SPELL_BUILD}. Read the ability’s restrictions in game before use.</p><div className="space-y-8">{STARTER_MACROS.map((macro) => <section key={macro.classSlug} aria-labelledby={`macro-${macro.classSlug}`}><h3 id={`macro-${macro.classSlug}`} className="mb-3 text-lg font-semibold">{macro.classSlug[0].toUpperCase() + macro.classSlug.slice(1)}</h3><p className="mb-3"><Link className={LINK} href={`/database/spells/${macro.spell.id}`}>{macro.spell.name}</Link>: a talent-dependent ability found for this class in the files.</p><CopyMacro text={macro.text} label={macro.classSlug} /></section>)}</div></section>
  </>;
}

function Stats() {
  return <>
    <p>This is a reading aid for the Forever character panel, based on the pinned Camelot UI code. Its functions and stat categories are evidence of what the panel displays, not measurements of a live character. Open each stat’s tooltip in game to inspect your own value.</p>
    {[["primary", "Primary attributes", PRIMARY_STATS], ["combat", "Combat and defensive stats", COMBAT_STATS]].map(([id, title, rows]) => <section key={id as string} aria-labelledby={id as string}><SectionHeading id={id as string}>{title as string}</SectionHeading><dl className="space-y-4">{(rows as [string, string][]).map(([name, meaning]) => <div key={name}><dt className="font-semibold">{name}</dt><dd className="mt-1 text-fg-2">{meaning}</dd></div>)}</dl></section>)}
    <section aria-labelledby="priorities"><SectionHeading id="priorities">Before comparing equipment</SectionHeading><p>Check which displayed value applies to the action you care about. A combined headline can hide a difference between melee, ranged and spell values. No per-specialization stat priority, cap, conversion table or raid requirement is established here. The best trade-off for your character is not confirmed yet.</p></section>
  </>;
}

function Pvp() {
  return <>
    <section aria-labelledby="honor"><SectionHeading id="honor">Honor and Rank Points</SectionHeading><p>Blizzard describes Honor as spendable PvP currency earned from player kills, battlegrounds and relevant quests. Rank Points advance your rank; Blizzard describes weekly-capped rank progression. Holiday battlegrounds boost earnings. The announcement does not give the numeric weekly cap.</p><p>Ranks lead toward Grand Marshal or High Warlord. Honor buys blue gear; upgrading it to epic gear also needs an Emboldened Seal with a rank requirement. Seasonal journey tasks award Honor and Rank Points. <a href={PVP_SOURCE} className={LINK}>Blizzard’s progression announcement</a>.</p><p>In our database: <Link className={LINK} href={chainHref(6293, "PvP Season Journey")}>PvP Season Journey</Link>, <Link className={LINK} href={titleHref(1270, "Grand Marshal %s")}>Grand Marshal</Link> and <Link className={LINK} href={titleHref(1284, "High Warlord %s")}>High Warlord</Link>. These records are found in game files, unconfirmed in play; a record alone does not prove the current reward rules.</p></section>
    <section aria-labelledby="rank-rewards"><SectionHeading id="rank-rewards">Announced rank requirements</SectionHeading><p><a className={LINK} href={PVP_SOURCE}>Blizzard’s reward requirements</a>, rather than a Classic-era rank table. These are reward categories, not a list of verified item IDs.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Rank requirements for PvP rewards announced by Blizzard</caption><thead><tr><th scope="col" className="p-3">Rank</th><th scope="col" className="p-3">Reward category</th></tr></thead><tbody>{PVP_RANK_REWARDS.map(([rank, reward]) => <tr className="border-t border-line" key={rank}><th scope="row" className="p-3">{rank}</th><td className="p-3">{reward}</td></tr>)}</tbody></table></div></section>
    <section aria-labelledby="battlegrounds"><SectionHeading id="battlegrounds">Darkspear Islands</SectionHeading><p>Blizzard announced a 15-versus-15 battleground for levels 30–60 off Dustwallow Marsh. Teams hold capture points and return a central flag to a controlled base. Reaching 2000 points wins. Queue at a capital-city battlemaster or the faction bases in the Barrens.</p><p>Its reputation factions have database records: <Link className={LINK} href={factionHref(2798, "Darkspear Raiders")}>Darkspear Raiders</Link> and <Link className={LINK} href={factionHref(2799, "Theramore Expeditionary Force")}>Theramore Expeditionary Force</Link>. <a className={LINK} href={BG_SOURCE}>Blizzard’s battleground announcement</a>.</p><p>Other battleground schedules, live queue times and Classic-era rank-decay assumptions are not confirmed by this draft.</p></section>
  </>;
}

function RaidPrep() {
  return <>
    <section aria-labelledby="before-raid"><SectionHeading id="before-raid">Before your first raid</SectionHeading><p>Blizzard announced Barrow Deeps, Hyjal Summit and Onyxia’s Lair for December 9, with groups of 10, 20 and 40 respectively. The Onyxia announcement requires the Drakefire Amulet and recommends fire resistance. It supplies no required resistance total. <a className={LINK} href={RAID_SOURCE}>Read Blizzard’s raid overview</a>.</p><p>This checklist is a planning aid. Recipe outputs below exist in Everloot’s Forever extract. Their effects, usable level, quantities and ideal raid loadout are not confirmed here; inspect the linked records and your in-game tooltips before buying.</p><Checklist storageKey="everloot.reference.raid-prep.v1" items={RAID_CHECKLIST} /></section>
    <section aria-labelledby="attunements"><SectionHeading id="attunements">Attunement chains: not confirmed yet</SectionHeading><p>The quest-line extract held here has no Onyxia attunement chain. We therefore do not list a quest order, even though Blizzard’s article describes faction-specific routes. Follow Blizzard’s instructions and check your quest log. A Classic-era candidate, item 16309, occurs in the client relationship data, but that alone does not establish its Forever identity as the announced amulet.</p><p>No resistance minimum or consumable stack count is asserted for these raids. Further quest and item verification is needed before this becomes a shopping list.</p></section>
  </>;
}

export default function ReferencePage({ slug }: { slug: ReferenceSlug }) {
  const guide = REFERENCE_GUIDES.find((g) => g.slug === slug)!;
  return <Container width="reading"><article className="space-y-8">
    <JsonLd data={REFERENCE_GUIDES_PUBLISHED ? entityPageJsonLd({ name: guide.title, path: `/guides/${slug}`, identifier: `reference:${slug}` }) : null} />
    <PageHeader title={guide.title} lede={guide.summary} />
    {!REFERENCE_GUIDES_PUBLISHED && <p className="rounded-card border border-line bg-panel p-4 text-warning">Draft, not reviewed yet</p>}
    {slug === "glossary" && <Glossary />}
    {slug === "keybinds" && <><p>This is a suggested layout, not a required setup. Interrupts, defensives, crowd control and cooldowns have consistent places. Movement keys are suggestions too; this page does not change your in-game bindings.</p><p className="text-sm text-muted">{SPELL_NOTE} Build {SPELL_BUILD}. These suggestions cover named active talents in our held extract, not your full spellbook. A blank role means no example is shown here; it does not mean your class lacks that role. One ability is assigned once: explicit interruption first, then protection, control or a cooldown. Protection includes health, mitigation or avoidance; control includes stuns, incapacitation, disorientation, disarms and slows. Restrictions and unresolved values remain visible in each tooltip.</p><KeyboardMap /></>}
    {slug === "macros" && <Macros />}
    {slug === "stats" && <Stats />}
    {slug === "pvp" && <Pvp />}
    {slug === "raid-prep" && <RaidPrep />}
    <section aria-labelledby="sources"><SectionHeading id="sources">Sources</SectionHeading><p className="mb-3 text-sm text-muted">Checked November 15, 2026. Client data is from build {SPELL_BUILD}; the UI links pin the inspected Forever branch revision. Game-file and UI findings are unconfirmed in play. Checklist prompts and key placements are suggestions.</p><ul className="list-disc space-y-2 pl-5">{SOURCES[slug].map((source) => <li key={source.url}><a href={source.url} className={LINK}>{source.title}</a></li>)}</ul></section>
    <p><Link href="/guides" className={LINK}>All guides</Link></p>
  </article></Container>;
}
