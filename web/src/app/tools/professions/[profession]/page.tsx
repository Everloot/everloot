import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import EmailCapture from "@/components/EmailCapture";
import ClassContextChip from "@/components/classes/ClassContextChip";
import GameIcon from "@/components/game/GameIcon";
import { Badge, Card, Container, Contribute, DataTable, Disclosure, EmptyState, Field, FilterBar, PageHeader, QUALITY_TEXT, SectionHeading, qualityOf, type Column } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { classContextParams, parseClassContext, withoutClassContext } from "@/lib/class-context";
import { dataAgeLabel } from "@/lib/data-age";
import { loadItemTips, loadSiteAssets, loadSpellNames, type ItemTip } from "@/lib/game-assets";
import { CLIENT_LAYER, CLIENT_TAXONOMY, shownItemName, type ShownItemName } from "@/lib/items";
import { CLIENT_PROFESSIONS, professionBySegment, professionHref, RECIPES_BUILD, recipeGroups, recipeItemIds, type RecipeView } from "@/lib/professions";
import { pageMetadata } from "@/lib/seo";
import { loadShownNames } from "@/lib/shown-item-names";
import { STORAGE_UNREACHABLE, STORAGE_UNREACHABLE_SHORT, uploadStore } from "@/lib/upload-store";
import EdgeDegraded from "@/components/EdgeDegraded";
import { formatCopper, handleProfessionPath } from "../../../../../../kb/src/profession-path";
import { handleRecipeThresholds, pathFactsFromRecords, recipeThresholdsStructured, type Range } from "../../../../../../kb/src/recipe-thresholds";
import { farmingAreas, gatherAreas, GATHERING, inLevels } from "@/lib/farming";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { npcRows } from "@/lib/world-lists";
import { publicZones } from "@/lib/zones";
import { objectSpawnRowsFromRecords } from "../../../../../../kb/src/object-spawns";
import { LINK } from "../../../database/entity";
import { LEVEL_BRACKETS, listHref, range, rangeParam } from "../../../database/list-parts";
import FarmAreaTable from "../../farming-routes/area-table";
import ProfessionPicker from "../picker";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ profession: string }>; searchParams?: Promise<Search> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? "" : value ?? "");
function skill(value: string, fallback: number): number {
  if (!/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return n >= 1 && n <= 500 ? n : fallback;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const p = professionBySegment((await props.params).profession);
  if (!p) notFound();
  return {
    ...pageMetadata({
      title: `WoW Forever ${p.name} Recipes`,
      description: `All ${p.recipes.length} ${p.name} recipes in the WoW: Forever game files: what each makes, its reagents and where it turns yellow and grey, plus player paths.`,
      path: professionHref(p.slug),
    }),
    keywords: [`wow forever ${p.name.toLowerCase()}`, `wow forever ${p.name.toLowerCase()} recipes`, `wow forever ${p.name.toLowerCase()} leveling`],
  };
}

const dash = <span className="text-muted">—</span>;
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const rangeText = (r: Range) => (r.min === null && r.max === null ? "?" : r.min === null ? `≤${r.max}` : r.max === null ? `${r.min}+` : r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);

/**
 * One profession: every recipe the game files list for it, grouped by the skill where it turns yellow, with the
 * item it makes and its reagents; then what players' uploads add (agreed colour ranges, the path, cost per craft).
 * The two are labelled apart: the recipe list is found in game files, unconfirmed; the player facts need 3 installs.
 */
export default async function ProfessionPage(props: Props) {
  const segment = (await props.params).profession;
  const p = professionBySegment(segment);
  if (!p) notFound();
  const searchParams = (await props.searchParams) ?? {};
  // The slug is the one canonical segment; the skill line id and `<id>-<slug>` forms land here and move on, keeping
  // the range and class context they came with, as the hub's `?profession=` redirect does.
  if (segment !== p.slug) {
    const search = new URLSearchParams(Object.entries(searchParams).flatMap(([k, v]) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => [k, x]))).toString();
    permanentRedirect(`${professionHref(p.slug)}${search ? `?${search}` : ""}`);
  }
  const read = parseClassContext(searchParams);
  const context = read.ok ? read.context : null;
  const fromSkill = skill(one(searchParams.from), 1);
  const toSkill = skill(one(searchParams.to), 75);
  const path = professionHref(p.slug);
  // Leather and cloth come from mob areas, which have levels: `?mobs=11-20` filters them (an old
  // `/tools/farming-routes?category=cloth&level=11-20` lands here with it). `level` is the class context's, not this.
  // A malformed range is a 404, as on the farming page.
  const gather = GATHERING[p.slug];
  const mobFarm = gather?.source === "leather" || gather?.source === "cloth" ? gather.source : null;
  const level = mobFarm ? range(searchParams, "mobs") : undefined;
  if (level === null) notFound();

  const [corpus, assets, shown, spellNames] = await Promise.all([
    uploadStore.loadCorpus(), loadSiteAssets(), loadShownNames(), loadSpellNames(CLIENT_LAYER.build.version),
  ]);
  // Names, icons and qualities of the items the recipes make and use, under the item name rule (shown-item-names.ts).
  const ids = recipeItemIds(p.recipes).filter(shown.showsTip);
  const tips: Map<number, ItemTip> = await loadItemTips(ids.length ? assets : null, ids);
  const names = new Map<number, ShownItemName | null>(ids.map((id) => [id, shownItemName(id, shown.agreed, shown.matched?.names, tips.get(id))]));
  const fileQuality = new Map(CLIENT_TAXONOMY.items.map((row) => [row[0], row[4]]));

  // The player layer, as before: three agreeing installs or nothing.
  const facts = corpus.unreachable ? { sightings: [], prices: [], observations: [], derived: [] } : pathFactsFromRecords(corpus.records);
  const answer = corpus.unreachable ? STORAGE_UNREACHABLE : handleProfessionPath({ profession: p.name, fromSkill, toSkill }, facts.sightings, facts.prices, facts.derived);
  const rangesText = corpus.unreachable ? STORAGE_UNREACHABLE : handleRecipeThresholds({ profession: p.name }, facts.observations, facts.prices);
  const agreed = corpus.unreachable ? [] : recipeThresholdsStructured({ profession: p.name }, facts.observations, facts.prices).ranges;
  const byRecipe = new Map(agreed.map((t) => [t.recipe.trim().toLowerCase(), t]));
  const reports = facts.sightings.length + facts.observations.length;
  const pending = !corpus.unreachable && reports === 0;

  // Where to gather, for the gathering professions and the ones that use cloth: from the same uploads, at 3 installs.
  // The mob areas reuse the corpus read above; any read that fails makes the section say storage is unreachable.
  const gathered = !gather || corpus.unreachable ? { rows: [], all: 0, down: corpus.unreachable === true }
    : !mobFarm
      ? (() => { const rows = gatherAreas(objectSpawnRowsFromRecords(corpus.records), gather.source as "herb" | "ore", publicZones()); return { rows, all: rows.length, down: false }; })()
      : await (async () => {
        const [world, rollups] = await Promise.all([loadWorldFacts(corpus), computeRollups(corpus)]);
        const down = world.unreachable || rollups.stats.unreachable;
        const all = down ? [] : farmingAreas(npcRows(world, rollups.rates), rollups.rates)[mobFarm];
        return { rows: level ? all.filter((a) => inLevels(a, level)) : all, all: all.length, down };
      })();
  const gatherRows = gathered.rows;
  // The level menu's links keep the page's other parameters and land back on the section.
  const levelHref = (l?: { min: number; max: number }) =>
    `${listHref(path, [...Object.keys(searchParams).filter((k) => k !== "mobs").map((k): [string, string] => [k, one(searchParams[k])]), ["mobs", rangeParam(l)]])}#gather`;

  const spellName = (id: number) => spellNames?.names.get(id);
  const players = (r: RecipeView) => { const n = spellName(r.spellId); return n ? byRecipe.get(n.trim().toLowerCase()) : undefined; };
  const icons = new Map([...(assets?.professions ?? new Map<string, { icon: string }>())].map(([k, v]) => [k, v.icon]));

  const ItemLink = ({ id, size = 24, count }: { id: number; size?: number; count?: number }) => {
    const name = names.get(id) ?? null;
    const tip = tips.get(id);
    const quality = fileQuality.get(id);
    // A shown name carries its own quality colour; otherwise the game files' quality colours it, as on the item lists.
    const colour = name?.color ? "" : quality !== undefined && quality !== null && quality <= 5 ? QUALITY_TEXT[qualityOf(quality)] : "text-fg";
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {tip?.icon
          ? <GameIcon src={tip.icon} size={size} />
          : <span aria-hidden="true" className="shrink-0 rounded-sm border border-line" style={{ width: size, height: size }} />}
        {count !== undefined && <span className="font-mono tabular-nums text-fg-2">{count}×</span>}
        <Link href={`/database/items/${id}`} className={`min-w-0 ${colour} hover:underline underline-offset-4`} style={name?.color ? { color: name.color } : undefined}>
          {name?.name ?? `Item ${id}`}
        </Link>
        {name?.source === "files" && <Badge tone="files" />}
      </span>
    );
  };

  const anyLearn = p.recipes.some((r) => r.learn !== null);
  const anyPlayers = p.recipes.some((r) => players(r));
  const columns: Column<RecipeView>[] = [
    {
      key: "recipe", header: "Recipe", cell: (r) => {
        const icon = assets?.spellIcons.get(r.spellId);
        return (
          <span className="inline-flex min-w-0 items-center gap-2">
            {icon ? <GameIcon src={icon} size={24} /> : <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-sm border border-line" />}
            <Link href={`/database/spells/${r.spellId}`} className={`min-w-0 ${LINK}`}>{spellName(r.spellId) ?? `Spell ${r.spellId}`}</Link>
            <Badge tone="files" />
          </span>
        );
      },
    },
    { key: "makes", header: "Makes", cell: (r) => (r.itemId ? <ItemLink id={r.itemId} /> : dash) },
    {
      key: "reagents", header: "Reagents", cell: (r) => r.reagents.length
        ? <ul className="flex flex-col gap-1">{r.reagents.map((x) => <li key={x.itemId}><ItemLink id={x.itemId} size={20} count={x.count} /></li>)}</ul>
        : dash,
    },
    ...(anyLearn ? [{ key: "learn", header: "Needs", numeric: true, cell: (r: RecipeView) => r.learn ?? dash }] : []),
    { key: "yellow", header: "Yellow", numeric: true, cell: (r) => r.yellow ?? dash },
    { key: "grey", header: "Grey", numeric: true, cell: (r) => r.grey ?? dash },
    ...(anyPlayers ? [{
      key: "players", header: "Players saw", cell: (r: RecipeView) => {
        const t = players(r);
        if (!t) return dash;
        return (
          <span className="text-cell-2 text-fg-2">
            <Badge tone="confirmed">{t.installs} installs</Badge>{" "}
            yellow {rangeText(t.yellow)}, green {rangeText(t.green)}, grey {rangeText(t.grey)}
            {t.costCopper !== null && <>; {formatCopper(t.costCopper)} a craft</>}
          </span>
        );
      },
    }] : []),
  ];

  const groups = recipeGroups(p.recipes);
  const trail = trailFor(path)!;

  return (
    <Container width="data">
      <EdgeDegraded when={corpus.unreachable === true || gathered.down} />
      <PageHeader
        trail={trail}
        title={`${p.name} recipes`}
        icon={icons.get(p.name.toLowerCase()) ? <GameIcon src={icons.get(p.name.toLowerCase())!} size={40} /> : undefined}
        lede={`Every ${p.name} recipe in the WoW: Forever game files, with what players' uploads add.`}
        meta={<>
          <span className="font-mono tabular-nums">{plural(p.recipes.length, "recipe")}</span>
          <span>Game files, build {RECIPES_BUILD}</span>
          {corpus.unreachable ? <span>{STORAGE_UNREACHABLE_SHORT}</span> : <>
            {reports > 0 && <span className="font-mono tabular-nums">{plural(reports, "recipe report")}</span>}
            <span>{dataAgeLabel(corpus.dataAsOf)}</span>
          </>}
        </>}
      />
      <ClassContextChip read={read} here={withoutClassContext(path, searchParams)} className="-mt-2 mb-6" />

      <div className="space-y-8">
        <ProfessionPicker professions={CLIENT_PROFESSIONS} icons={icons} current={p.slug} context={context} />

        <section aria-labelledby="prof-recipes" className="space-y-4" data-recipes={p.slug}>
          <SectionHeading id="prof-recipes" as="h2">Recipes from the game files</SectionHeading>
          <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">
            <Badge tone="files" />
            Found in game files, unconfirmed, build {RECIPES_BUILD}. Grouped by the skill where a recipe turns yellow.
            {p.otherSpells > 0 && ` ${plural(p.otherSpells, "other spell")} on the ${p.name} line make and cost nothing and are not listed.`}
          </p>
          {groups.length > 1 && (
            <nav aria-label={`${p.name} skill brackets`} className="flex flex-wrap gap-2 text-sm">
              {groups.map((g) => (
                <a key={g.key} href={`#skill-${g.key}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line px-3 text-fg-2 hover:border-accent hover:text-fg">
                  {g.label} <span className="font-mono tabular-nums text-muted">{g.recipes.length}</span>
                </a>
              ))}
            </nav>
          )}
          {groups.length === 0 && <EmptyState message={`The game files list no ${p.name} recipes that make an item or cost a reagent.`} />}
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`skill-${g.key}`} data-skill-group={g.key} className="space-y-2">
              <SectionHeading id={`skill-${g.key}`} as="h3">{g.label}</SectionHeading>
              <DataTable
                dense
                caption={`${p.name} recipes, ${g.label}: ${g.recipes.length}`}
                columns={columns}
                rows={g.recipes}
                rowKey={(r) => String(r.spellId)}
              />
            </section>
          ))}
        </section>

        {gather && (
          <section id="gather" aria-labelledby="prof-gather" className="space-y-3" data-gather={gather.source}>
            <SectionHeading id="prof-gather" as="h2">{gather.source === "herb" || gather.source === "ore" ? `Where to gather ${gather.noun}` : `Where to farm ${gather.noun}`}</SectionHeading>
            <p className="text-meta text-fg-2">{gather.how}</p>
            {mobFarm && (
              <FilterBar
                label={`Where to farm ${gather.noun} filters`}
                active={Number(Boolean(level))}
                clearHref={levelHref(undefined)}
                controls={[{
                  type: "menu", key: "mobs", label: "Mob level",
                  options: [{ label: "Any level", href: levelHref(undefined), on: !level, reset: true }, ...LEVEL_BRACKETS.map((b) => ({
                    label: `${b.min}–${b.max}`, href: levelHref(b), on: level?.min === b.min && level?.max === b.max,
                  }))],
                }]}
              />
            )}
            {gathered.down
              ? <p className="text-cell text-fg-2" role="status">{STORAGE_UNREACHABLE}</p>
              : gatherRows.length
                ? <FarmAreaTable areas={gatherRows} backing={gather.source === "herb" || gather.source === "ore" ? "nodes" : "mobs"} caption={`Where to ${gather.source === "herb" || gather.source === "ore" ? "gather" : "farm"} ${gather.noun}: ${gatherRows.length}`} />
                : level && gathered.all > 0 ? <p data-empty-state className="py-3 text-cell text-fg-2">{`Nothing here for levels ${rangeParam(level)}.`}</p>
                : <EmptyState message={gather.source === "herb" || gather.source === "ore"
                  ? `No ${gather.noun} zones yet: a zone shows once 3 installs gather from the same spot there.`
                  : `No ${gather.noun} zones yet: a zone shows once 3 installs upload loot from the same mobs there.`} />}
          </section>
        )}

        <section aria-labelledby="prof-path" className="space-y-4">
          <SectionHeading id="prof-path" as="h2">Leveling path from player uploads</SectionHeading>
          <Card>
            <form method="get" action={path} className="space-y-4">
              {context && classContextParams(context).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From skill" name="from" defaultValue={fromSkill} inputMode="numeric" mono />
                <Field label="To skill" name="to" defaultValue={toSkill} inputMode="numeric" mono />
              </div>
              <button type="submit" className="btn btn-primary">Show the path</button>
            </form>
          </Card>
          {pending
            ? <EmptyState message={`No recipe ranges for ${p.name} yet: paths and ranges appear once 3 installs report the same recipes.`} />
            : <Card><pre className="whitespace-pre-wrap text-sm text-fg">{answer}</pre></Card>}
        </section>

        {!pending && (
          <section aria-labelledby="prof-ranges">
            <SectionHeading id="prof-ranges" as="h2">Recipe skill ranges players agree on</SectionHeading>
            <Card><pre className="whitespace-pre-wrap text-sm text-fg">{rangesText}</pre></Card>
          </section>
        )}

        <Contribute
          id="prof-contribute"
          title="Add your recipes"
          note="Open your profession windows and trainers with the addon on, and scan the auction house for reagent prices. The Desktop App uploads both when you log out; a range shows once 3 installs agree."
        />

        <section aria-labelledby="prof-help">
          <SectionHeading id="prof-help" as="h2">Questions</SectionHeading>
          <Disclosure summary="Where does the recipe list come from?">
            <p>
              From the game files of build {RECIPES_BUILD}: the spells on the {p.name} skill line, the item each makes and
              its reagents. Being in the files does not mean a recipe is in the game, or say how you learn it. Names and icons
              follow the same rules as the item pages.
            </p>
          </Disclosure>
          <Disclosure summary="What are Yellow and Grey?">
            <p>
              The skill where the files say a recipe turns yellow and where it turns grey. The files do not store where it
              turns green. &quot;Needs&quot; is the files&apos; required skill, given for only a few recipes, so it is shown only
              where they give one above 1; trainers&apos; own ranks come from player uploads.
            </p>
          </Disclosure>
          <Disclosure summary="How is the path estimated?">
            <p>
              Choose a skill range to see a path from available recipe uploads. Routes compare estimated reagent costs from
              reported recipes. Missing recipes remain gaps, and missing prices remain unknown.
            </p>
            <p>
              Prices are not scoped to a realm, build or time; three install reports per reagent do not guarantee
              today&apos;s cheapest route. Reported install IDs do not establish independent contributors.
            </p>
          </Disclosure>
          <Disclosure summary="What does Players saw mean?">
            <p>
              Where {p.name} recipes turned yellow, green and grey in players&apos; profession windows (addon 0.2.3+), as
              ranges once 3 installs agree, matched to the game file recipe by name, with an estimated cost per craft when
              every reagent has an agreed price.
            </p>
          </Disclosure>
          <Disclosure summary="How do I feed the hub?">
            <p>
              With auction capture on, the addon&apos;s auction scans price reagents here. Opening profession
              windows and trainers (addon 0.2.5) builds route steps: only the ranks where a recipe is known
              orange, once 3 installs agree. Ranks past that stay gaps. Upload on the{" "}
              <Link href="/upload" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">upload page</Link>.
            </p>
          </Disclosure>
        </section>

        <Card className="max-w-xl">
          <EmailCapture toolSlug="professions" />
        </Card>
        <AdSlot slot="belowTool" />
      </div>
    </Container>
  );
}
