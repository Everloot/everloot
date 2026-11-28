import AhledgerCrafting, { type CraftingRead } from "../../auctions/AhledgerCrafting";
import { RealmHousePicker, realmHouseHref, realmHouseParams } from "../../auctions/RealmHousePicker";
import type { AuctionHouse } from "@everloot/protocol";
import { ahledgerMarket, craftingAsOf, craftingMargins, isAhledgerMarket, isAhledgerProfession } from "@/lib/ahledger";
import { readAhledgerPage } from "@/lib/ahledger-proxy";
import { busiestHouse, findBoard, realmBoards, realmSlug } from "@/lib/auction-house";
import { realmRegion, realmRuleset } from "@/lib/realms";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import EmailCapture from "@/components/EmailCapture";
import ClassContextChip from "@/components/classes/ClassContextChip";
import GameIcon from "@/components/game/GameIcon";
import { Badge, Card, Container, Contribute, Disclosure, EmptyState, FilterBar, PageHeader, QUALITY_TEXT, ResultStrip, SectionHeading, qualityOf } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { classContextParams, parseClassContext, withClassContext, withoutClassContext } from "@/lib/class-context";
import { dataAgeLabel } from "@/lib/data-age";
import { loadItemTips, loadSiteAssets, loadSpellNames, type ItemTip } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@kb/client-layer-file";
import { CLIENT_TAXONOMY, shownItemName, type ShownItemName } from "@/lib/items";
import { CLIENT_PROFESSIONS, professionBySegment, professionHref, RECIPES_BUILD, recipeGroups, recipeItemIds, SKILL_BRACKETS, type ProfessionInfo, type RecipeView } from "@/lib/professions";
import { filterRecipeViews, RECIPE_PAGE_SIZES, recipeListHref, recipeListQuery, recipePage, recipeSearchKeep } from "@/lib/recipe-list";
import { pageMetadata } from "@/lib/seo";
import { loadListNames } from "@/lib/item-view";
import { STORAGE_UNREACHABLE, STORAGE_UNREACHABLE_SHORT, uploadStore } from "@/lib/upload-store";
import { loadProfessions } from "@/lib/profession-store";
import EdgeDegraded from "@/components/EdgeDegraded";
import { formatCopper } from "@kb/profession-path";
import type { GuideMode } from "@kb/profession-guide";
import { handleRecipeThresholds, recipeThresholdsStructured, type Range } from "@kb/recipe-thresholds";
import { farmingAreas, GATHERING, inLevels } from "@/lib/farming";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { npcRows } from "@/lib/world-lists";
import { LEVEL_BRACKETS, listHref, range, rangeParam } from "../../../database/list-parts";
import FarmAreaTable from "../../farming-routes/area-table";
import ProfessionPicker from "../picker";
import { buildRecipeCatalog, teachingItemIds } from "@/lib/recipe-catalog";
import LevelingGuide from "../leveling-guide";
import { buildProfessionGuideData, PROFESSION_TRAINER_LICENSE_URL, PROFESSION_TRAINER_SOURCE_URL } from "@/lib/profession-guide-data";
import { loadDisenchant } from "@/lib/disenchant";
import { GATHERING_GUIDE_SLUGS } from "@/lib/gathering-guide";
import type { GuideDisenchants } from "@/lib/profession-guide-prices";
import RecipeTables, { type RecipeItem, type RecipeRow } from "../recipe-table";
import RecipeShopping from "../recipe-shopping";
import ProfessionViewTabs from "../profession-view-tabs";
import { loadStoredFarmAreas } from "@/lib/farm-areas-store";
import GatheringGuide from "./gathering/guide";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ profession: string }>; searchParams?: Promise<Search> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? "" : value ?? "");
function skill(value: string, fallback: number): number {
  if (!/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return n >= 1 && n <= 300 ? n : fallback;
}

const GUIDE_MODES = new Set<string>(["materials", "vendor", "auction", "disenchant"]);
const REFERENCE_PARAMS = [
  "recipe", "crafts", "q", "min", "max", "size", "page", "mobs",
  "market", "sort", "skill_min", "skill_max", "min_sales", "priced", "craft_size", "craft_page",
] as const;
const REFERENCE_ANCHORS = [
  "#prof-recipes", "#recipe-shopping", "#ahledger-margins", "#gather", "#prof-ranges", "#prof-help", "#prof-contribute",
] as const;

function queryString(search: Search): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined) for (const entry of Array.isArray(value) ? value : [value]) query.append(key, entry);
  }
  return query.toString();
}

/** The planner accepts a display name, while the reference pickers address a realm by slug. */
function referenceMarketParams(search: Search) {
  return realmHouseParams({ realm: realmSlug(one(search.realm)), house: one(search.house).toLowerCase() });
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const p = professionBySegment((await props.params).profession);
  if (!p) notFound();
  const gathering = GATHERING_GUIDE_SLUGS.has(p.slug);
  return {
    ...pageMetadata({
      title: gathering ? `WoW Forever ${p.name} Gathering Guide` : `WoW Forever ${p.name} Leveling Guide & Recipes`,
      description: p.slug === "herbalism"
        ? "Where to gather herbs in WoW: Forever from player uploads, followed by Herbalism crafts new in Forever."
        : gathering ? `Find WoW: Forever ${p.name} zones, materials and trainers from player reports.`
          : `Plan your WoW: Forever ${p.name} leveling route, compare recipes and realm prices, and build a shopping list for your skill range.`,
      path: professionHref(p.slug),
    }),
    keywords: [`wow forever ${p.name.toLowerCase()}`, `wow forever ${p.name.toLowerCase()} recipes`, `wow forever ${p.name.toLowerCase()} leveling`],
  };
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const rangeText = (r: Range) => (r.min === null && r.max === null ? "?" : r.min === null ? `≤${r.max}` : r.max === null ? `${r.min}+` : r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);

/** AH Ledger has a market per faction: the Alliance and Horde houses, never the neutral one. */
const LEDGER_HOUSES: readonly AuctionHouse[] = ["Alliance", "Horde"];

/**
 * The AH Ledger market and its picker: the realm's region and ruleset and the house's faction name AH Ledger's market.
 * A realm is offered only where AH Ledger has a market for it. With no house asked, the realm's busier faction house.
 * A link with no realm keeps working as before: `?market=` (the old Region, Ruleset and Faction selects' parameter)
 * names the market, else the AH Ledger panels' default, PvE Alliance in the US.
 */
function ledgerMarket(search: Search, path: string, state: Parameters<typeof realmBoards>[0] | null) {
  const { realm, house: asked } = referenceMarketParams(search);
  const legacy = realm ? null : one(search.market);
  const shared = legacy && isAhledgerMarket(legacy) ? legacy : null;
  const realms = state ? realmBoards(state, new Date()).filter((b) => {
    const region = realmRegion(b.realm.name);
    return region !== null && ahledgerMarket(realmRuleset(b.realm.name), "alliance", region) !== null;
  }) : [];
  const board = realm ? findBoard(realms, realm) : null;
  const sharedHouse = shared ? LEDGER_HOUSES.find((h) => shared.split(".")[2] === h.toLowerCase()) ?? null : null;
  const house = asked ?? (board ? busiestHouse(board.rows.filter((r) => r.house !== "Neutral"))?.house ?? "Alliance" : sharedHouse);
  const region = board ? realmRegion(board.realm.name) : null;
  const faction = house === "Alliance" ? "alliance" : house === "Horde" ? "horde" : null;
  const market = realm
    ? (board && region && faction ? ahledgerMarket(realmRuleset(board.realm.name), faction, region) : null)
    : shared ?? ahledgerMarket("normal", "alliance", "us");
  const none = !board ? "AH Ledger has no market for this realm." : "AH Ledger has no market for the neutral auction house: pick Alliance or Horde.";
  // A realm replaces the old market parameter, and the links land back on the margins.
  const rest = Object.fromEntries(Object.entries(search).filter(([k]) => k !== "market"));
  const picker = (
    <RealmHousePicker
      realms={realms.map((b) => ({ slug: b.realm.slug, name: b.realm.name }))}
      realm={realm}
      house={house}
      houses={LEDGER_HOUSES}
      href={(r, h) => realmHouseHref(path, rest, r, h, "#ahledger-margins")}
      remember={shared ? "save" : "redirect"}
    />
  );
  return { market, picker, none };
}

/** The margins for that market, read on the server: only the rows and their time, kept nowhere but this render. */
async function readCrafting(market: string | null, profession: string): Promise<CraftingRead | null> {
  if (!market) return null;
  const read = await readAhledgerPage(`crafting/${market}?profession=${encodeURIComponent(profession)}`, (body) => ({ recipes: craftingMargins(body), asOf: craftingAsOf(body) }));
  return read.ok ? { ok: true, ...read.value, credit: read.credit } : { ok: false };
}

async function CraftingPlanner({ profession: p, search }: { profession: ProfessionInfo; search: Search }) {
  const path = professionHref(p.slug);
  const read = parseClassContext(search);
  const context = read.ok ? read.context : null;
  const to = Math.max(2, skill(one(search.to), 300));
  const from = Math.min(skill(one(search.from), 1), to - 1);
  const modeParam = one(search.mode);
  const mode = GUIDE_MODES.has(modeParam) ? modeParam as GuideMode : undefined;
  const realm = one(search.realm), house = one(search.house);
  const modeled = one(search.estimate) !== "0";
  const [view, assets, shown, spellNames] = await Promise.all([
    loadProfessions(), loadSiteAssets(), loadListNames(), loadSpellNames(CLIENT_LAYER.build.version),
  ]);
  const guide = buildProfessionGuideData(p, view.facts, id => spellNames?.names.get(id));
  const guideItemIds = new Set(guide.recipes.flatMap(recipe => [
    ...recipe.reagents.map(reagent => reagent.itemId),
    ...(recipe.toolIds ?? []),
    ...(recipe.unlockReagents?.map(reagent => reagent.itemId) ?? []),
    ...("teachingItemIds" in recipe.source ? recipe.source.teachingItemIds : []),
  ]));
  const outputIds = new Set(guide.recipes.flatMap(recipe => recipe.output ? [recipe.output.itemId] : []));
  for (const { source } of guide.rankStops) {
    if (source?.kind === "book") guideItemIds.add(source.itemId);
    if (source?.kind === "quest") for (const { itemId } of source.requirements) guideItemIds.add(itemId);
  }
  // Only the materials the planner can use and its eligible outputs need tooltip names or vendor resale prices.
  const tipIds = [...new Set([...guideItemIds, ...outputIds])].filter(shown.showsTip);
  const [tips, disenchant] = await Promise.all([
    loadItemTips(assets, tipIds),
    outputIds.size ? loadDisenchant(view.corpus) : null,
  ]);
  const items = Object.fromEntries([...guideItemIds].flatMap(id => {
    const name = shownItemName(id, shown.agreed, shown.matched?.names, tips.get(id))?.name;
    return name ? [[id, { name }]] : [];
  }));
  const recipes = guide.recipes.map(recipe => {
    const output = recipe.output;
    const vendorSellCopper = output ? tips.get(output.itemId)?.vendorSellCopper : undefined;
    return output && vendorSellCopper !== undefined ? { ...recipe, output: { ...output, vendorSellCopper } } : recipe;
  });
  let disenchants: GuideDisenchants | undefined;
  if (disenchant && !disenchant.unreachable) {
    const yields = new Map(disenchant.yields.filter(row => row.state === "rated").map(row => [row.band.id, row.rows]));
    disenchants = Object.fromEntries([...outputIds].flatMap(itemId => {
      const match = disenchant.placer.place(itemId);
      if (match.kind === "no-disenchant") return [[itemId, []]];
      const materials = match.kind === "band" ? yields.get(match.band.id) : null;
      return materials ? [[itemId, materials.map(row => ({ itemId: row.materialId, count: row.perDisenchant }))]] : [];
    }));
  }
  const icons = new Map([...(assets?.professions ?? new Map<string, { icon: string }>())].map(([key, value]) => [key, value.icon]));
  const icon = icons.get(p.name.toLowerCase());
  return (
    <Container width="data">
      <EdgeDegraded when={view.unreachable === true} />
      <PageHeader trail={trailFor(path)!} title={`${p.name} profession guide`} icon={icon ? <GameIcon src={icon} size={40} /> : undefined} />
      <ClassContextChip read={read} here={withoutClassContext(path, search)} className="-mt-2 mb-6" />
      <div className="space-y-4">
        <ProfessionViewTabs path={path} reference={false} initialQuery={queryString(search)} referenceParams={REFERENCE_PARAMS} referenceAnchors={REFERENCE_ANCHORS}
          professions={CLIENT_PROFESSIONS.map(profession => ({ path: withClassContext(professionHref(profession.slug), context), label: profession.name }))} />
        <LevelingGuide
          key={JSON.stringify([p.slug, from, to, mode, realm, house, modeled])}
          profession={p.name} recipes={recipes} items={items} from={from} to={to} initialMode={mode}
          contextFields={context ? classContextParams(context) : undefined}
          initialRealm={realm} initialHouse={house} initialModeled={modeled}
          vendor={guide.vendorBuyCopper} vendorNpcs={guide.vendorNpcIds} disenchants={disenchants} rankStops={guide.rankStops}
        />
        <Disclosure summary="Guide sources">
          <p>Selected Forever trainer and vendor facts are adapted from <a href={PROFESSION_TRAINER_SOURCE_URL} className="underline underline-offset-4">Efficient Games</a> under <a href={PROFESSION_TRAINER_LICENSE_URL} className="underline underline-offset-4">CC BY 4.0</a>.</p>
        </Disclosure>
      </div>
    </Container>
  );
}

/**
 * Crafting opens on the planner. The reference view carries the game-file recipes, market margins and player
 * observations. Gathering pages retain their field guides and references together.
 */
export default async function ProfessionPage(props: Props) {
  const segment = (await props.params).profession;
  const p = professionBySegment(segment);
  if (!p) notFound();
  const requested = (await props.searchParams) ?? {};
  const path = professionHref(p.slug);
  // The slug is the one canonical segment; the skill line id and `<id>-<slug>` forms land here and move on, keeping
  // the range and class context they came with, as the hub's `?profession=` redirect does.
  if (segment !== p.slug) {
    const search = queryString(requested);
    permanentRedirect(`${path}${search ? `?${search}` : ""}`);
  }
  const gathering = GATHERING_GUIDE_SLUGS.has(p.slug);
  const pane = one(requested.view);
  const reference = !gathering && (pane === "reference" || (!pane && REFERENCE_PARAMS.some(key => one(requested[key]))));
  if (!gathering && !reference) return CraftingPlanner({ profession: p, search: requested });
  // Commands inside the reference stay there even when they clear the last filter in a legacy link.
  const searchParams = reference ? { ...requested, view: "reference" } : requested;
  const read = parseClassContext(searchParams);
  const context = read.ok ? read.context : null;
  // Leather and cloth come from mob areas, which have levels: `?mobs=11-20` filters them (an old
  // `/tools/farming-routes?category=cloth&level=11-20` lands here with it). `level` is the class context's, not this.
  // A malformed range is a 404, as on the farming page.
  const gather = p.slug === "herbalism" || p.slug === "mining" ? undefined : GATHERING[p.slug];
  const mobFarm = gather?.source === "leather" || gather?.source === "cloth" ? gather.source : null;
  const level = mobFarm ? range(searchParams, "mobs") : undefined;
  if (level === null) notFound();

  const ledger = isAhledgerProfession(p.name);
  const sources = { view: loadProfessions(), assets: loadSiteAssets(), names: loadListNames() };
  const [view, assets, shown, spellNames, market, gatheringGuide] = await Promise.all([
    sources.view, sources.assets, sources.names, loadSpellNames(CLIENT_LAYER.build.version),
    ledger ? uploadStore.loadMarket() : Promise.resolve(null),
    gathering ? GatheringGuide({ profession: p, searchParams, embedded: true, sources }) : null,
  ]);
  // Names, icons and qualities of the items the recipes make and use, under the item name rule (shown-item-names.ts).
  const ids = [...new Set([...recipeItemIds(p.recipes), ...teachingItemIds(p.recipes.map(r => r.spellId))])].filter(shown.showsTip);
  const ledgerAt = ledger ? ledgerMarket(searchParams, path, market?.state ?? null) : null;
  const [tips, crafting]: [Map<number, ItemTip>, CraftingRead | null] = await Promise.all([
    loadItemTips(ids.length ? assets : null, ids),
    readCrafting(ledgerAt?.market ?? null, p.name),
  ]);
  const names = new Map<number, ShownItemName | null>(ids.map((id) => [id, shownItemName(id, shown.agreed, shown.matched?.names, tips.get(id))]));
  const fileQuality = new Map(CLIENT_TAXONOMY.items.map((row) => [row[0], row[4]]));

  // The player layer, as before: three agreeing installs or nothing.
  const facts = view.facts;
  const rangesText = view.unreachable ? STORAGE_UNREACHABLE : handleRecipeThresholds({ profession: p.name }, facts.observations, facts.prices);
  const agreed = view.unreachable ? [] : recipeThresholdsStructured({ profession: p.name }, facts.observations, facts.prices).ranges;
  const byRecipe = new Map(agreed.map((t) => [t.recipe.trim().toLowerCase(), t]));
  const reports = facts.sightings.length + facts.observations.length;
  const pending = !view.unreachable && reports === 0;

  // Leather and cloth farming referrals use the stored areas or reuse this page's fallback corpus.
  const gathered = !mobFarm || view.unreachable ? { rows: [], all: 0, down: view.unreachable === true }
    : await (async () => {
      const stored = await loadStoredFarmAreas();
      if (stored) {
        const all = stored.areas[mobFarm];
        return { rows: level ? all.filter((a) => inLevels(a, level)) : all, all: all.length, down: false };
      }
      const [world, rollups] = await Promise.all([loadWorldFacts(view.corpus), computeRollups(view.corpus)]);
      const down = world.unreachable || rollups.stats.unreachable;
      const all = down ? [] : farmingAreas(npcRows(world, rollups.rates), rollups.rates, world.kills)[mobFarm];
      return { rows: level ? all.filter((a) => inLevels(a, level)) : all, all: all.length, down };
    })();
  const gatherRows = gathered.rows;
  // The level menu's links keep the page's other parameters and land back on the section.
  const levelHref = (l?: { min: number; max: number }) =>
    `${listHref(path, [...Object.keys(searchParams).filter((k) => k !== "mobs").map((k): [string, string] => [k, one(searchParams[k])]), ["mobs", rangeParam(l)]])}#gather`;

  const spellName = (id: number) => spellNames?.names.get(id);
  const catalog = buildRecipeCatalog(p, id => names.get(id)?.name ?? `Item ${id}`, spellName, id => names.get(id)?.source === "files");
  const selectedRecipe = catalog.find(r => String(r.spellId) === searchParams.recipe && r.reagents.length > 0);
  const recipeMarket = referenceMarketParams(searchParams);
  const requestedCrafts = Number(searchParams.crafts);
  const crafts = Number.isInteger(requestedCrafts) && requestedCrafts >= 1 && requestedCrafts <= 999 ? requestedCrafts : 1;
  const players = (r: RecipeView) => { const n = spellName(r.spellId); return n ? byRecipe.get(n.trim().toLowerCase()) : undefined; };
  // The recipe table, filtered and paged here: the page carries only the rows it shows (`?page=&size=&q=&min=&max=`).
  const listQuery = recipeListQuery(searchParams);
  const planHref = (id: string) => recipeListHref(path, { ...searchParams, recipe: id, crafts: undefined },
    listQuery, { page: listQuery.page }).replace(/#prof-recipes$/, "#recipe-shopping");
  const listed = recipePage(filterRecipeViews(recipeGroups(p.recipes).flatMap((g) => g.recipes), catalog, listQuery), listQuery);
  const listHere = (change: Parameters<typeof recipeListHref>[3]) => recipeListHref(path, searchParams, listQuery, change);
  const teaching = new Map(catalog.map((r) => [r.spellId, r.recipeItems]));
  const icons = new Map([...(assets?.professions ?? new Map<string, { icon: string }>())].map(([k, v]) => [k, v.icon]));

  // The recipe rows as ids and numbers, each item they name once with its name, colour and icon (recipe-table.tsx).
  const iconBase = assets?.base ? `${assets.base}/icons/` : "";
  const iconFile = (src: string | null | undefined) => (src && iconBase && src.startsWith(iconBase) ? src.slice(iconBase.length) : src);
  const items: Record<number, RecipeItem> = {};
  const item = (id: number) => {
    if (items[id]) return;
    const name = names.get(id) ?? null;
    const quality = fileQuality.get(id);
    // A shown name carries its own quality colour; otherwise the game files' quality colours it, as on the item lists.
    const tone = name?.color ? undefined : quality !== undefined && quality !== null && quality <= 5 ? QUALITY_TEXT[qualityOf(quality)] : "text-fg";
    const icon = iconFile(tips.get(id)?.icon);
    items[id] = { name: name?.name ?? `Item ${id}`, ...(name?.color ? { color: name.color } : {}), ...(tone ? { tone } : {}), ...(icon ? { icon } : {}), ...(name?.source === "files" ? { files: true as const } : {}) };
  };
  const row = (r: RecipeView): RecipeRow => {
    const name = spellName(r.spellId);
    const icon = iconFile(assets?.spellIcons.get(r.spellId));
    const taught = (teaching.get(r.spellId) ?? []).map((x) => x.itemId);
    const t = players(r);
    for (const id of [...(r.itemId ? [r.itemId] : []), ...r.reagents.map((x) => x.itemId), ...taught]) item(id);
    return {
      id: r.spellId, ...(name ? { name } : {}), ...(icon ? { icon } : {}), ...(r.itemId ? { makes: r.itemId } : {}),
      reagents: r.reagents.map((x): [number, number] => [x.itemId, x.count]),
      ...(r.learn !== null ? { learn: r.learn } : {}), ...(r.yellow !== null ? { yellow: r.yellow } : {}), ...(r.grey !== null ? { grey: r.grey } : {}),
      ...(taught.length ? { taught } : {}),
      ...(t ? { players: { installs: t.installs, text: `yellow ${rangeText(t.yellow)}, green ${rangeText(t.green)}, grey ${rangeText(t.grey)}`, ...(t.costCopper !== null ? { cost: formatCopper(t.costCopper) } : {}) } } : {}),
    };
  };
  const anyLearn = p.recipes.some((r) => r.learn !== null);
  const anyPlayers = p.recipes.some((r) => players(r));

  const groups = recipeGroups(p.recipes);
  const shownGroups = recipeGroups(listed.rows);
  const tableGroups = shownGroups.map((g) => ({ key: g.key, label: g.label, rows: g.recipes.map(row) }));
  const listFilters = Number(Boolean(listQuery.q)) + Number(listQuery.min !== null || listQuery.max !== null);
  const strip = <ResultStrip total={listed.total} noun={listed.total === 1 ? "recipe" : "recipes"} page={listed.page} perPage={listQuery.size} href={(page) => listHere({ page })} label={`${p.name} recipe pages`} />;
  const trail = trailFor(path)!;
  const gatheringSection = gather && mobFarm && (
    <section id="gather" aria-labelledby="prof-gather" className="scroll-mt-24 space-y-3" data-gather={gather.source}>
      <SectionHeading id="prof-gather" as="h2">Where to farm {gather.noun}</SectionHeading>
      <p className="text-meta text-fg-2">{gather.how}</p>
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
      {gathered.down
        ? <p className="text-cell text-fg-2" role="status">{STORAGE_UNREACHABLE}</p>
        : gatherRows.length
          ? <FarmAreaTable areas={gatherRows} backing="mobs" caption={`Where to farm ${gather.noun}: ${gatherRows.length}`} />
          : level && gathered.all > 0 ? <p data-empty-state className="py-3 text-cell text-fg-2">{`Nothing here for levels ${rangeParam(level)}.`}</p>
          : <EmptyState message={`No ${gather.noun} zones yet: a zone shows once 3 installs upload loot from the same mobs there.`} />}
    </section>
  );

  return (
    <Container width="data">
      <EdgeDegraded when={view.unreachable === true || gathered.down || crafting?.ok === false} />
      <PageHeader
        trail={trail}
        title={gathering ? `${p.name} gathering` : `${p.name} profession reference`}
        icon={icons.get(p.name.toLowerCase()) ? <GameIcon src={icons.get(p.name.toLowerCase())!} size={40} /> : undefined}
        lede={p.slug === "herbalism"
          ? "Find herb gathering areas from player uploads. Herbalism crafts new in Forever are listed below."
          : gathering ? `Find ${p.name} zones, materials and trainers reported by WoW: Forever players.`
            : `Browse ${p.name} recipes, crafting margins, and skill ranges reported by players.`}
        meta={<>
          <span className="font-mono tabular-nums">{plural(p.recipes.length, "recipe")}</span>
          <span>Game files, build {RECIPES_BUILD}</span>
          {view.unreachable ? <span>{STORAGE_UNREACHABLE_SHORT}</span> : <>
            {reports > 0 && <span className="font-mono tabular-nums">{plural(reports, "recipe report")}</span>}
            <span>{dataAgeLabel(view.dataAsOf)}</span>
          </>}
        </>}
        actions={<>
          {ledgerAt && <a className="btn" href="#ahledger-margins">Crafting margins</a>}
          <a className="btn" href="#prof-recipes">Recipes</a>
        </>}
      />
      <ClassContextChip read={read} here={withoutClassContext(path, searchParams)} className="-mt-2 mb-6" />

      <div className="space-y-8">
        <ProfessionPicker professions={CLIENT_PROFESSIONS} icons={icons} current={p.slug} context={context} />
        {reference && <ProfessionViewTabs path={path} reference initialQuery={queryString(searchParams)} referenceParams={REFERENCE_PARAMS} referenceAnchors={REFERENCE_ANCHORS} />}
        {gatheringGuide}
        {ledgerAt && (
          <div id="ahledger-margins" className="scroll-mt-24">
            <AhledgerCrafting profession={p.name} market={ledgerAt.market} read={crafting} path={path} search={searchParams} spellIcon={(id) => assets?.spellIcons.get(id)} picker={ledgerAt.picker} none={ledgerAt.none} />
          </div>
        )}

        <section id="prof-recipes" aria-labelledby="prof-recipes-heading" className="scroll-mt-24 space-y-4" data-recipes={p.slug}>
          <SectionHeading id="prof-recipes-heading" as="h2">{p.slug === "herbalism" ? "Herbalism crafts (new in Forever)" : "Recipes from the game files"}</SectionHeading>
          <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">
            <Badge tone="files" />
            Found in game files, unconfirmed, build {RECIPES_BUILD}. Grouped by the skill where a recipe turns yellow.
            {p.otherSpells > 0 && ` ${plural(p.otherSpells, "other spell")} on the ${p.name} line make and cost nothing and are not listed.`}
          </p>
          {selectedRecipe && <RecipeShopping key={`${selectedRecipe.spellId}:${recipeMarket.realm}:${recipeMarket.house}`} recipe={selectedRecipe} initialCrafts={crafts}
            initialMarket={recipeMarket.realm && recipeMarket.house ? { realm: recipeMarket.realm, house: recipeMarket.house } : undefined} />}
          {groups.length > 0 && (
            <FilterBar
              label={`${p.name} recipe filters`}
              search={{ action: `${path}#prof-recipes`, value: listQuery.q, placeholder: "Recipe, item or reagent", label: "Filter recipes by recipe, item or reagent", keep: recipeSearchKeep(searchParams, listQuery) }}
              active={listFilters}
              clearHref={listHere({ q: "", min: null, max: null })}
              controls={[
                {
                  type: "menu", key: "skill", label: "Turns yellow",
                  options: [
                    { label: "Any skill", href: listHere({ min: null, max: null }), on: listQuery.min === null && listQuery.max === null, reset: true },
                    ...SKILL_BRACKETS.map((b) => {
                      const max = b.max >= 999 ? null : b.max;
                      return {
                        label: max === null ? `${b.min}+` : `${b.min}–${b.max}`, href: listHere({ min: b.min, max }),
                        on: listQuery.min === b.min && listQuery.max === max,
                        count: p.recipes.filter((r) => r.yellow !== null && r.yellow >= b.min && r.yellow <= b.max).length,
                      };
                    }),
                  ],
                },
                {
                  type: "menu", key: "size", label: "Rows",
                  options: RECIPE_PAGE_SIZES.map((size) => ({ label: String(size), href: listHere({ size }), on: listQuery.size === size })),
                },
              ]}
              aside={strip}
            />
          )}
          {groups.length === 0 && <EmptyState message={`The game files list no ${p.name} recipes that make an item or cost a reagent.`} />}
          {groups.length > 0 && listed.total === 0 && <p data-empty-state className="py-3 text-cell text-fg-2">No {p.name} recipes match these filters.</p>}
          {tableGroups.length > 0 && (
            <RecipeTables
              profession={p.name}
              groups={tableGroups}
              items={items}
              iconBase={iconBase}
              planHref={planHref("RECIPEID")}
              learn={anyLearn}
              players={anyPlayers}
            />
          )}
          {listed.pages > 1 && strip}
        </section>

        {gatheringSection}

        {pending && <EmptyState message={`No recipe ranges for ${p.name} yet: paths and ranges appear once 3 installs report the same recipes.`} />}

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
              The guide uses eligible recipes from Forever data and player observations. The route favors skill coverage,
              then compares the estimated cost of eligible crafts. Gaps and unpriced materials are shown in the plan.
            </p>
            <p>
              Auction prices are public listing estimates for the chosen realm and house. The gold estimate can change as
              listings change. Recipe resale and disenchant returns depend on what you can actually sell.
            </p>
            <p>Selected Forever trainer and vendor facts are adapted from <a href={PROFESSION_TRAINER_SOURCE_URL} className="underline underline-offset-4">Efficient Games</a> under <a href={PROFESSION_TRAINER_LICENSE_URL} className="underline underline-offset-4">CC BY 4.0</a>.</p>
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
              windows and trainers helps verify recipe unlocks and skill windows. Upload on the{" "}
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
