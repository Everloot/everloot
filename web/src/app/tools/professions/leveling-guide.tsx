"use client";

import Link from "@/components/Link";
import { Fragment, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CopyButton, Input } from "@/components/ui";
import type { ProfessionGuideRecipe, ProfessionRankStop } from "@/lib/profession-guide-data";
import { guideBuyPrice, priceGuideRecipe, requestedGuideItems, type GuideDisenchants, type VendorPrices } from "@/lib/profession-guide-prices";
import { planGuideShopping } from "@/lib/profession-guide-shopping";
import { planProfessionGuide, type GuideMode, type GuideStep } from "@kb/profession-guide";
import { formatCopper } from "@kb/profession-path";
import { GuideMarketControls, useGuideMarket } from "./leveling-guide-market";
import { SELECT_CLASS } from "./controls";

const MODES = {
  materials: "Material cost",
  vendor: "After vendor resale",
  auction: "After auction resale",
  disenchant: "After disenchanting",
} satisfies Record<GuideMode, string>;
const money = (copper: number) => `${copper < 0 ? "−" : ""}${formatCopper(Math.round(Math.abs(copper)))}`;
const count = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const EMPTY_MAP = new Map<number, number>();
const EMPTY_VENDOR: VendorPrices = {};
const EMPTY_DISENCHANTS: GuideDisenchants = {};
const NO_RANK_STOPS: readonly ProfessionRankStop[] = [];

type Items = Readonly<Record<number, { name: string }>>;
type Props = {
  profession: string;
  recipes: readonly ProfessionGuideRecipe[];
  items: Items;
  from: number;
  to: number;
  initialMode?: GuideMode;
  initialRealm?: string;
  initialHouse?: string;
  initialModeled?: boolean;
  vendor?: VendorPrices;
  vendorNpcs?: Readonly<Record<number, number[]>>;
  disenchants?: GuideDisenchants;
  rankStops?: readonly ProfessionRankStop[];
  contextFields?: readonly [string, string][];
};

function RankStop({ stop, items, during }: { stop: ProfessionRankStop; items: Items; during?: boolean }) {
  const { source } = stop;
  return <div className="space-y-1 text-cell text-fg-2">
    <p>{during ? "During this step, at skill " : "At skill "}<strong className="font-mono text-fg">{stop.cap}</strong>, learn{" "}
    <Link prefetch={false} className="underline underline-offset-4" href={`/database/spells/${stop.nextSpellId}`}>{stop.nextRank}</Link>
    {stop.nextCap && ` (cap ${stop.nextCap})`}.</p>
    <GuideDetails label="Training details">
      {source?.kind === "trainer" && <p>From {source.npcIds.slice(0, 3).map((id, index) => <span key={id}>
        {index > 0 && ", "}<Link prefetch={false} className="underline" href={`/database/npcs/${id}`}>trainer {id}</Link>
      </span>)} at skill {source.minimumSkill}{source.minimumLevel ? ` and character level ${source.minimumLevel}` : ""}.</p>}
      {source?.kind === "book" && <p>Use <Link prefetch={false} className="underline" href={`/database/items/${source.itemId}`}>
        {items[source.itemId]?.name ?? `training book ${source.itemId}`}
      </Link> at skill {source.minimumSkill}{source.minimumLevel ? ` and character level ${source.minimumLevel}` : ""}.</p>}
      {source?.kind === "quest" && <p>Complete {source.questIds.map((id, index) => <span key={id}>
        {index > 0 && " or "}<Link prefetch={false} className="underline" href={`/database/quests/${id}`}>quest {id}</Link>
      </span>)}{source.minimumLevel > 0 && ` at character level ${source.minimumLevel}+`}.
        {source.requirements.length > 0 && " Known quest materials are included in the shopping list."}
      </p>}
      {!source && <p>Check your profession trainer for the unlock.</p>}
    </GuideDetails>
  </div>;
}

function StepSource({ recipe, items }: { recipe: ProfessionGuideRecipe; items: Items }) {
  const { source } = recipe;
  if (source.kind === "starter") return <span>Available after learning the profession.</span>;
  if (source.kind === "quest") return <span>Complete {source.questIds.map((id, i) => <span key={id}>
    {i > 0 && " or "}<Link prefetch={false} className="underline underline-offset-4" href={`/database/quests/${id}`}>quest {id}</Link>
  </span>)}{source.minimumLevel > 0 && ` · character level ${source.minimumLevel}+`}</span>;
  if (source.kind === "trainer") return source.npcIds.length > 0
    ? <span>Learn from {source.npcIds.slice(0, 5).map((id, i) => <span key={id}>{i > 0 && ", "}<Link prefetch={false} className="underline underline-offset-4" href={`/database/npcs/${id}`}>trainer {id}</Link></span>)}{source.npcIds.length > 5 && ` and ${source.npcIds.length - 5} more`}
      {source.minimumLevel ? ` · character level ${source.minimumLevel}+` : ""}
      {source.questIds?.map(id => <span key={id}> · <Link prefetch={false} className="underline underline-offset-4" href={`/database/quests/${id}`}>Rank quest {id}</Link></span>)}
      {source.provider === "efficient-games" && <span> · Efficient Games{source.build ? ` (${source.build})` : ""}</span>}
      {source.referenceUrl && <span> · <a className="underline underline-offset-4" href={source.referenceUrl}>Source</a></span>}
    </span>
    : <span>Train this recipe with a profession trainer.</span>;
  return source.teachingItemIds.length > 0
    ? <span>{source.kind === "teaching-item" ? "Learn from" : "Possible teaching item"} {source.teachingItemIds.map((id, i) => <span key={id}>{i > 0 && ", "}<Link prefetch={false} className="underline underline-offset-4" href={`/database/items/${id}`}>{items[id]?.name ?? `Item ${id}`}</Link></span>)}</span>
    : <span>Check your spellbook. The learning source is unrecorded.</span>;
}

function GuideDetails({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="w-fit cursor-pointer py-1 text-cell text-fg-2">{label}</summary>
    {open && <div className="mt-2 space-y-2">{children}</div>}
  </details>;
}

type StepProps = { step: GuideStep; recipe?: ProfessionGuideRecipe; items: Items; exclude: () => void };

function StepDetails({ step, recipe, items, exclude }: StepProps) {
  return <div className="space-y-2 text-meta text-fg-2">
      {step.probabilistic && <p className="text-meta text-fg-2">Average {count(step.expectedCrafts)} crafts. Actual skill gains vary.</p>}
      {step.evidence === "modeled" && <p className="text-meta text-fg-2">Estimated skill-up chance.</p>}
      {recipe && <p className="text-meta text-fg-2"><StepSource recipe={recipe} items={items} />
        {step.trainingCopper !== undefined && ` · Training ${step.trainingCopper === null ? "price unrecorded" : money(step.trainingCopper)}`}
      </p>}
      {recipe?.focusId && <p className="text-meta text-fg-2">Requires a crafting station. Check the recipe before traveling.</p>}
      {Boolean(recipe?.toolIds?.length || recipe?.toolCategoryIds?.length) && <p className="text-meta text-fg-2">Requires a crafting tool. {recipe?.toolIds?.map(id => <Link key={id} prefetch={false} className="mr-2 underline" href={`/database/items/${id}`}>{items[id]?.name ?? `Tool ${id}`}</Link>)}</p>}
      {Boolean(recipe?.unlockReagents?.length) && <p className="text-meta text-fg-2">One-time unlock materials: {recipe?.unlockReagents?.map(({ itemId, count }, index) =>
        <span key={itemId}>{index > 0 && ", "}{count} × <Link prefetch={false} className="underline" href={`/database/items/${itemId}`}>{items[itemId]?.name ?? `Item ${itemId}`}</Link></span>)}</p>}
      {step.alternatives.length > 0 && <>
        <p>Other recipes for this range</p>
        <ul className="ml-4 list-disc">
          {step.alternatives.map(option => <li key={option.recipeId}>
            {option.plannedCrafts} × {option.recipeName}
            {option.expectedCopper !== null && ` · ${money(option.expectedCopper)}`}
            {option.probabilistic && " · estimated crafts"}
          </li>)}
        </ul>
        <button type="button" className="btn mt-2" onClick={exclude}>Skip {step.recipeName} and replan</button>
      </>}
  </div>;
}

function StepRow({ stops, ...props }: StepProps & { stops: readonly ProfessionRankStop[] }) {
  const { step } = props;
  return <li className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 border-b border-line py-3 last:border-b-0 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]">
    <span className="font-mono text-cell tabular-nums text-fg-2">{step.fromSkill}–{step.toSkill}</span>
    <div className="min-w-0 break-words">
      <p className="font-medium text-fg"><span className="font-mono tabular-nums">{step.plannedCrafts} ×</span> <Link className="underline decoration-edge underline-offset-4 hover:decoration-fg" href={`/database/spells/${step.recipeId}`}>{step.recipeName}</Link></p>
      {stops.map(stop => <RankStop key={stop.cap} stop={stop} items={props.items} during />)}
      <GuideDetails label="Recipe details"><StepDetails {...props} /></GuideDetails>
    </div>
    {step.expectedCopper !== null && <span className="col-start-2 font-mono text-cell tabular-nums text-fg-2 sm:col-start-auto sm:text-right">{money(step.expectedCopper)}</span>}
  </li>;
}

export default function LevelingGuide({
  profession, recipes, items, from, to, initialMode = "materials", initialRealm = "", initialHouse = "", initialModeled = true,
  vendor = EMPTY_VENDOR, vendorNpcs = {}, disenchants = EMPTY_DISENCHANTS, rankStops = NO_RANK_STOPS, contextFields,
}: Props) {
  const [inputs, setInputs] = useState({ from: String(from), to: String(to) });
  const [validRange, setValidRange] = useState({ fromSkill: from, toSkill: to });
  const range = useDeferredValue(validRange);
  const [mode, setMode] = useState<GuideMode>(initialMode);
  const [modeled, setModeled] = useState(initialModeled);
  const [makeIfCheaper, setMakeIfCheaper] = useState(false);
  const [excluded, setExcluded] = useState<number[]>([]);
  const validInput = (start: number, end: number) => Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end <= 300 && start < end;
  const rankRequirements = useMemo(() => rankStops.flatMap(stop =>
    stop.cap >= range.fromSkill && stop.cap < range.toSkill && stop.source?.kind === "quest"
      ? [{ beforeSkill: stop.cap, reagents: stop.source.requirements }] : []), [rankStops, range]);
  const ids = useMemo(() => [...new Set([
    ...requestedGuideItems(recipes, disenchants),
    ...rankStops.flatMap(stop => stop.source?.kind === "quest" ? stop.source.requirements.map(row => row.itemId) : []),
  ])].sort((a, b) => a - b), [recipes, disenchants, rankStops]);
  const market = useGuideMarket(ids, { realm: initialRealm, house: initialHouse });
  const marketValues = useMemo(() => market.market
    ? new Map([...market.market.quotes].map(([id, row]) => [id, row[2]]))
    : EMPTY_MAP, [market.market]);
  const resaleValues = useMemo(() => market.market
    ? new Map([...market.market.quotes].flatMap(([id, row]) => typeof row[1] === "number" && Number.isFinite(row[1]) && row[1] >= 0 ? [[id, row[1]] as const] : []))
    : EMPTY_MAP, [market.market]);
  const byId = useMemo(() => new Map(recipes.map(recipe => [recipe.id, recipe])), [recipes]);
  const pricedRecipes = useMemo(() => recipes.map(recipe => ({
    ...recipe,
    windows: modeled ? recipe.windows : recipe.windows.filter(window => window.evidence !== "modeled"),
    prices: priceGuideRecipe(recipe, { buy: marketValues, resale: resaleValues }, vendor, market.house, recipe.output ? disenchants[recipe.output.itemId] : undefined),
  })), [recipes, modeled, marketValues, resaleValues, market.house, vendor, disenchants]);
  const plan = useMemo(() => planProfessionGuide(pricedRecipes, { ...range, mode, excludedRecipeIds: excluded }),
    [pricedRecipes, range, mode, excluded]);
  const shopping = useMemo(() => planGuideShopping(plan.steps, recipes, id => guideBuyPrice(id, marketValues, vendor), { makeIfCheaper, rankRequirements }),
    [plan.steps, recipes, marketValues, vendor, makeIfCheaper, rankRequirements]);
  const materials = shopping.purchases.map(row => {
    const quote = market.market?.quotes.get(row.itemId);
    const unit = row.unitCopper;
    const source = unit === null ? null : vendor[row.itemId] === unit ? "vendor" : quote ? `${quote[5]}${quote[8] > 2 ? ", stale" : ""}` : null;
    return { ...row, name: items[row.itemId]?.name ?? `Item ${row.itemId}`, unit, source };
  });
  const shoppingLine = (row: typeof materials[number]) => `${row.count} × ${row.name}${row.unit === null ? "" : ` · ${money(row.count * row.unit)} (${row.source})`}`;
  const shoppingText = [
    `${profession}, skill ${range.fromSkill}–${range.toSkill}`,
    ...(market.market ? [`${market.realm}, ${market.house} · Everloot listing estimates`] : []),
    ...(plan.probabilistic ? ["Estimated crafts based on average skill gains. Update your skill and recalculate as you go."] : []),
    ...plan.gaps.map(gap => `Recipe evidence missing for ${gap.fromSkill}–${gap.toSkill}`),
    ...materials.map(shoppingLine),
    ...shopping.crafts.map(craft => `Make ${craft.crafts} × ${craft.recipeName} before skill ${craft.beforeSkill}`),
  ].join("\n");
  function changeSkill(field: "from" | "to", value: string) {
    const next = { ...inputs, [field]: value };
    setInputs(next);
    const fromSkill = Number(next.from);
    const toSkill = Number(next.to);
    if (validInput(fromSkill, toSkill)) setValidRange({ fromSkill, toSkill });
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    if (range.fromSkill !== from || range.toSkill !== to || url.searchParams.has("from") || url.searchParams.has("to")) {
      url.searchParams.set("from", String(range.fromSkill));
      url.searchParams.set("to", String(range.toSkill));
    }
    if (mode !== "materials") url.searchParams.set("mode", mode);
    else url.searchParams.delete("mode");
    if (market.markets) {
      if (market.realm) url.searchParams.set("realm", market.realm);
      else url.searchParams.delete("realm");
      if (market.house) url.searchParams.set("house", market.house);
      else url.searchParams.delete("house");
    }
    if (modeled) url.searchParams.delete("estimate");
    else url.searchParams.set("estimate", "0");
    if (url.href !== window.location.href) window.history.replaceState(null, "", url.href);
  }, [range, from, to, mode, market.markets, market.realm, market.house, modeled]);

  const pricedSteps = plan.steps.filter(step => step.expectedCopper !== null).length;
  const trainingStops = rankStops.filter(stop => stop.cap >= range.fromSkill && stop.cap < range.toSkill);
  const rows = [...plan.steps.map(step => ({ ...step, kind: "step" as const })), ...plan.gaps.map(gap => ({ ...gap, kind: "gap" as const }))]
    .sort((a, b) => a.fromSkill - b.fromSkill);
  return <section aria-labelledby="prof-path" className="space-y-4">
    <h2 id="prof-path" className="sr-only">{profession} leveling guide</h2>
    <Card className="space-y-3">
      <form method="get" onSubmit={event => event.preventDefault()} className="flex flex-wrap items-end gap-3">
        {contextFields?.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="grid gap-1 text-cell text-fg-2">Current skill
          <Input className="w-24" name="from" type="number" min={1} max={299} step={1} inputMode="numeric" value={inputs.from} onChange={event => changeSkill("from", event.target.value)} />
        </label>
        <label className="grid gap-1 text-cell text-fg-2">Target skill
          <Input className="w-24" name="to" type="number" min={2} max={300} step={1} inputMode="numeric" value={inputs.to} onChange={event => changeSkill("to", event.target.value)} />
        </label>
        {plan.steps.length > 0 && <a className="btn btn-primary xl:hidden" href="#shopping-list">Shopping list</a>}
        {!validInput(Number(inputs.from), Number(inputs.to)) && <p role="status" className="w-full text-meta text-fg-2">Enter whole skills from 1 to 300, with the target above your current skill.</p>}
      </form>
      <div className="flex flex-wrap items-start gap-3">
        <GuideMarketControls state={market} />
        <label className="text-cell text-fg-2">Pricing mode
          <select className={SELECT_CLASS} value={mode} onChange={event => setMode(event.target.value as GuideMode)}>
            {Object.entries(MODES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <GuideDetails label="Planning options">
        {recipes.some(recipe => recipe.windows.some(window => window.evidence === "modeled")) && <div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-cell text-fg">
            <input type="checkbox" checked={modeled} onChange={event => setModeled(event.target.checked)} aria-describedby="guide-estimate-note" />
            Include estimated yellow and green skill-ups
          </label>
          <p id="guide-estimate-note" className="text-meta text-fg-2">Chance falls from 100% at yellow to 0% at grey in the Classic model. This is an estimate for Forever.</p>
        </div>}
        {market.market && <label className="flex cursor-pointer items-center gap-2 text-cell text-fg">
          <input type="checkbox" checked={makeIfCheaper} onChange={event => setMakeIfCheaper(event.target.checked)} />
          Make cheaper intermediate materials
        </label>}
        {mode !== "materials" && <p className="text-meta text-fg-2">Net costs assume direct reagent purchases and resale or disenchanting of all output. The shopping list accounts for materials you keep. Recovery modes skip modeled chances under 10%.</p>}
      </GuideDetails>
    </Card>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="space-y-2">
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-2">
          <h3 className="text-lg font-semibold text-fg">Skill {range.fromSkill}–{range.toSkill}</h3>
          {excluded.length > 0 && <button type="button" className="btn" onClick={() => setExcluded([])}>Restore skipped recipes ({excluded.length})</button>}
          <span className="text-cell text-fg-2" role="status">{plan.expectedCopper === null
            ? pricedSteps ? `Known crafting subtotal ${money(plan.knownExpectedCopper)} · incomplete` : "Price estimate unavailable"
            : `Expected crafting cost ${money(plan.expectedCopper)}`}</span>
        </div>
        {plan.probabilistic && <p className="text-meta text-fg-2">Craft counts are estimates. Update your current skill as you go.</p>}
        {plan.knownTrainingCopper > 0 && <p className="text-meta text-fg-2">
          Known training fees {money(plan.knownTrainingCopper)}
          {plan.unknownTrainingCount > 0 && ` · ${plan.unknownTrainingCount} fees unrecorded`}
        </p>}
        {plan.gaps.length > 0 && <p className="text-meta text-fg-2">This is a partial route. Check the skill gaps before buying materials for later steps.
          {!modeled && recipes.some(recipe => recipe.windows.some(window => window.evidence === "modeled")) &&
            <> <button type="button" className="underline underline-offset-4" onClick={() => setModeled(true)}>Try the estimated route</button></>}
        </p>}
        <ol>
          {rows.map(step => {
            const stops = trainingStops.filter(stop => stop.cap >= step.fromSkill && stop.cap < step.toSkill);
            if (step.kind === "gap") return <li key={step.fromSkill} className="space-y-1 border-b border-line py-3 text-fg-2 last:border-b-0">
              <p><span className="mr-3 font-mono tabular-nums">{step.fromSkill}–{step.toSkill}</span> Recipe evidence missing</p>
              {stops.map(stop => <RankStop key={stop.cap} stop={stop} items={items} />)}
            </li>;
            return <Fragment key={step.fromSkill}>
              {stops.filter(stop => stop.cap === step.fromSkill).map(stop => <li key={stop.cap} className="border-b border-line py-3"><RankStop stop={stop} items={items} /></li>)}
              <StepRow step={step} recipe={byId.get(step.recipeId)} items={items} stops={stops.filter(stop => stop.cap > step.fromSkill)} exclude={() => setExcluded(previous => [...previous, step.recipeId])} />
            </Fragment>;
          })}
        </ol>
      </Card>
      {plan.steps.length > 0 && <Card id="shopping-list" className="space-y-3 scroll-mt-24">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-fg">Shopping list</h3>
          <CopyButton text={shoppingText} label="Copy shopping list" />
        </div>
        {materials.length === 0 && <p className="text-cell text-fg-2">No materials to buy for this route.</p>}
        {materials.length > 0 && <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {materials.map(row => <li key={row.itemId} className="break-words text-cell">
            <Link prefetch={false} className="underline decoration-edge underline-offset-4 hover:decoration-fg" href={`/database/items/${row.itemId}`}>{row.count} × {row.name}</Link>
            <span className="text-meta text-fg-2"> · {row.unit === null ? "price unknown" : `${money(row.count * row.unit)} (${row.source})`}</span>
            {row.source === "vendor" && vendorNpcs[row.itemId]?.[0] && <Link prefetch={false} className="ml-2 text-meta underline underline-offset-4"
              href={`/database/npcs/${vendorNpcs[row.itemId]![0]}`}>Vendor location</Link>}
          </li>)}
        </ul>}
        {shopping.copper !== null && materials.length > 0 && <p className="text-cell text-fg-2">Estimated purchases {money(shopping.copper)}</p>}
        {shopping.copper === null && materials.some(row => row.unit !== null) && <p className="text-cell text-fg-2">Known purchase subtotal {money(shopping.knownCopper)} · incomplete</p>}
        {shopping.crafts.length > 0 && <div className="space-y-1">
          <h4 className="font-medium">Make before continuing</h4>
          <ol className="ml-4 list-decimal text-cell text-fg-2">
            {shopping.crafts.map((craft, index) => <li key={`${craft.recipeId}-${craft.beforeSkill}-${index}`}>{craft.crafts} × {craft.recipeName} before the step at skill {craft.beforeSkill}</li>)}
          </ol>
          <p className="text-meta text-fg-2">Update your skill if these extra crafts grant skill points.</p>
        </div>}
      </Card>}
    </div>
  </section>;
}
