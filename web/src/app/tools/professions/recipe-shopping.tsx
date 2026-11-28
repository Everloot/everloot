"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AuctionHouse } from "@everloot/protocol";
import { Badge, Card, CopyButton, Input, Segmented } from "@/components/ui";
import type { SearchRecipe } from "@/lib/profession-planner";
import { formatCopper } from "@kb/profession-path";
import type { FullPriceRow } from "@kb/market";
import {
  DEFAULT_SHARE, SHARE_LIMITS, evaluateCraft, planSale, quotesFromPriceRows, realmSlugOf, resolveCraftPlan, routeBlock, shareEntries, shareSearch, staleQuote, unitQuote, utcToday,
  type CatalogRecipe, type CraftShareState, type Destination, type Strategy,
} from "@/lib/crafting-profit";
import { SELECT_CLASS } from "./controls";
import { auctionActivityHref } from "@/lib/auction-activity-link";

/** A catalog recipe the plan may make, as the page sends it: hypothetical, never checked against any character. */
export interface PlanCatalogEntry {
  recipeId: number;
  name: string;
  profession: string;
  itemId: number;
  minimum: number | null;
  maximum: number | null;
  reagents: [number, number][];
  cooldownMs: number | null;
}

/** At most this many items are priced in one request (the price API's item limit). */
const PRICE_ITEMS = 100;
const OWNED_TEXT = /^\d{1,7}$/;

/**
 * One recipe's plan: the materials for a craft count, a source-aware estimate for the chosen realm and house, the
 * sale destination, Buy or the cheapest of the catalog makes the reader allows, typed owned counts used once, ordered
 * steps, leftovers, and a copyable plan and link. Prices are one request for the plan's items; every other change
 * re-evaluates in place. Catalog routes are never checked against any character.
 */
export default function RecipeShopping({
  recipe, initial: given, initialCrafts, outputItem = recipe.output?.itemId, issues = [], market = null, catalog = [], itemNames = {}, vendorOffers = [], training = null, rankingShown = false, catalogTruncated = false, rootCooldownMs = null,
}: {
  recipe: SearchRecipe;
  /** The link's validated plan state. */
  initial?: CraftShareState;
  /** Older callers: the craft count alone. */
  initialCrafts?: number;
  /** Known product identity for its activity link, even when the output quantity is unknown. */
  outputItem?: number;
  /** Why fields of the link were ignored. */
  issues?: string[];
  /** The link's realm when it names a market, and its house when one was given (ranking needs both). */
  market?: { realm: string; realmName: string; house: AuctionHouse | null } | null;
  catalog?: PlanCatalogEntry[];
  itemNames?: Record<number, string>;
  /** Items with an agreed community vendor offer: shown as offers, never priced as units. */
  vendorOffers?: number[];
  /** Training cost players recorded for exactly this recipe's spell ID, or null. */
  training?: number | null;
  /** Whether the page shows the whole-profession ranking for `market`. */
  rankingShown?: boolean;
  catalogTruncated?: boolean;
  /** A cooldown the game files record for this recipe; null is not proof of none. */
  rootCooldownMs?: number | null;
}) {
  const initial = given ?? { ...DEFAULT_SHARE, recipe: recipe.spellId, crafts: initialCrafts ?? 1 };
  const byId = useMemo(() => new Map(catalog.map((r) => [r.recipeId, r])), [catalog]);
  const treeItems = useMemo(() => new Set([...recipe.reagents.map((r) => r.itemId), ...catalog.flatMap((r) => [r.itemId, ...r.reagents.map(([i]) => i)])]), [recipe, catalog]);
  // Link values this plan cannot use are dropped once, and said.
  const [dropped] = useState(() => [
    ...initial.make.filter((id) => !byId.has(id)).map((id) => `Recipe ${id} is not a catalog recipe for this plan's materials, so it was left out.`),
    ...initial.have.filter(([id]) => !treeItems.has(id)).map(([id]) => `Item ${id} is not in this plan, so its count was left out.`),
  ]);
  const [count, setCount] = useState(String(initial.crafts));
  const [destination, setDestination] = useState<Destination>(initial.destination);
  const [strategy, setStrategy] = useState<Strategy>(initial.strategy);
  const [make, setMake] = useState(() => new Set(initial.make.filter((id) => byId.has(id))));
  const [owned, setOwned] = useState(() => new Map(initial.have.filter(([id]) => treeItems.has(id)).map(([id, n]) => [id, String(n)])));
  const [houses, setHouses] = useState<Record<string, string[]> | null>(null);
  const [realm, setRealm] = useState(market?.realmName ?? "");
  const [house, setHouse] = useState<string>(market?.house ?? "");
  const [discovering, setDiscovering] = useState(false);
  const [marketError, setMarketError] = useState(false);
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: FullPriceRow[] | null }>();
  const [ownedFull, setOwnedFull] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => setPath(window.location.pathname), []);

  const trades = Number(count);
  const valid = /^[1-9]\d{0,3}$/.test(count) && trades <= SHARE_LIMITS.crafts;
  const product = recipe.output?.itemId ?? null;
  const names = (id: number) => recipe.reagents.find((r) => r.itemId === id)?.name ?? itemNames[id] ?? (id === product ? recipe.itemName : null) ?? `Item ${id}`;
  // The items the plan can need, in priority order: the materials and the product, then what the allowed makes take,
  // breadth-first through allowed makes only. One request prices the first PRICE_ITEMS; a change of allowed makes asks
  // once again for the changed set. Items past the cap are named as such, never shown as an ordinary missing quote.
  const { priceIds, overCap } = useMemo(() => {
    const order = [...new Set([...recipe.reagents.map((r) => r.itemId), ...(product ? [product] : [])])];
    const seen = new Set(order);
    const routes = catalog.filter((r) => make.has(r.recipeId) && routeBlock(toCatalog(r)) === null);
    for (let i = 0; i < order.length; i++) {
      for (const r of routes) if (r.itemId === order[i]) for (const [id] of r.reagents) if (!seen.has(id)) { seen.add(id); order.push(id); }
    }
    return { priceIds: order.slice(0, PRICE_ITEMS).sort((a, b) => a - b), overCap: new Set(order.slice(PRICE_ITEMS)) };
  }, [recipe, catalog, product, make]);
  const ids = priceIds.join(",");
  const key = JSON.stringify([realm, house, ids, request]);

  async function loadMarkets() {
    setDiscovering(true);
    setMarketError(false);
    try {
      const response = await fetch("/api/market/prices");
      if (!response.ok) throw new Error();
      const data: { houses: Record<string, string[]> } = await response.json();
      if (!data.houses || typeof data.houses !== "object") throw new Error();
      setHouses(data.houses);
    } catch {
      setMarketError(true);
    } finally {
      setDiscovering(false);
    }
  }

  useEffect(() => {
    if (!realm || !house) return;
    const abort = new AbortController();
    const query = new URLSearchParams({ realm, house, items: ids, fields: "full" });
    void fetch(`/api/market/prices?${query}`, { signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data: { ok: boolean; items: FullPriceRow[] } = await response.json();
        if (!data.ok || !Array.isArray(data.items)) throw new Error();
        if (!abort.signal.aborted) setResult({ key, rows: data.items });
      }).catch(() => { if (!abort.signal.aborted) setResult({ key, rows: null }); });
    return () => abort.abort();
  }, [realm, house, ids, key]);

  // Typed owned counts: whole numbers 0..1,000,000; anything else is refused and left out of the plan and the link.
  const ownedBad = [...owned].filter(([, v]) => v !== "" && !(OWNED_TEXT.test(v) && Number(v) <= SHARE_LIMITS.owned)).map(([id]) => id);
  const ownedMap = new Map([...owned].filter(([id, v]) => !ownedBad.includes(id) && v !== "" && Number(v) > 0).map(([id, v]) => [id, Number(v)]));
  const state: CraftShareState = {
    recipe: recipe.spellId, crafts: valid ? trades : initial.crafts, realm: realm ? realmSlugOf(realm) : null,
    house: (house || null) as AuctionHouse | null, destination, strategy, make: [...make].sort((a, b) => a - b),
    have: [...ownedMap].sort((a, b) => a[0] - b[0]),
  };

  // The address follows every valid edit, canonical, keeping the recipe list's own parameters.
  function rewrite(next: CraftShareState) {
    const search = shareSearch(new URL(window.location.href).searchParams, next);
    if (search === null) return;
    const url = new URL(window.location.href);
    url.search = search;
    window.history.replaceState(window.history.state, "", url);
  }
  const edit = (patch: Partial<CraftShareState>) => rewrite({ ...state, ...patch });

  function changeCount(value: string) {
    setCount(value);
    if (/^[1-9]\d{0,3}$/.test(value)) edit({ crafts: Number(value) });
  }
  function changeOwned(id: number, value: string) {
    const next = new Map(owned).set(id, value);
    setOwned(next);
    if (value !== "" && !(OWNED_TEXT.test(value) && Number(value) <= SHARE_LIMITS.owned)) return;
    const have = new Map(ownedMap);
    if (value === "" || Number(value) === 0) have.delete(id); else have.set(id, Number(value));
    // A plan keeps at most 128 typed counts: one more is refused and said, never truncated or written into a link the
    // parser would reject. Existing counts stay editable and removable.
    if (have.size > SHARE_LIMITS.have) { setOwned(owned); setOwnedFull(true); return; }
    setOwnedFull(false);
    edit({ have: [...have].sort((a, b) => a[0] - b[0]) });
  }
  function toggleMake(id: number) {
    const next = new Set(make);
    if (next.has(id)) next.delete(id); else if (next.size < SHARE_LIMITS.make) next.add(id);
    setMake(next);
    edit({ make: [...next].sort((a, b) => a - b) });
  }

  const current = result?.key === key ? result : undefined;
  const today = utcToday();
  const quotes = useMemo(() => quotesFromPriceRows(current?.rows ?? []), [current]);
  const loaded = Boolean(current?.rows);
  const crafts = valid ? trades : null;

  const estimate = evaluateCraft(
    { id: recipe.spellId, name: recipe.name, product, output: recipe.output ? { minimum: recipe.output.minimum, maximum: recipe.output.maximum } : null, reagents: recipe.reagents },
    quotes, { house: (house || "Alliance") as AuctionHouse, destination, crafts: crafts ?? 1, today },
  );
  const plan = crafts === null ? null : resolveCraftPlan(
    [{ recipeId: recipe.spellId, crafts, recipe: { itemId: product, minimum: recipe.output?.minimum ?? null, maximum: recipe.output?.maximum ?? null, reagents: recipe.reagents } }],
    { quote: (id) => unitQuote(quotes.get(id)) }, new Map(catalog.map((r) => [r.recipeId, toCatalog(r)])), make, ownedMap, { strategy },
  );
  const batch = plan && loaded ? planSale(estimate, crafts!, plan.cost) : null;
  const marketText = realm && house ? `${realm}, ${house} auction house` : null;
  const stale = (id: number) => staleQuote(quotes.get(id)?.market ?? null, today);
  // Economic valuation still counts owned materials; inspect its decisions, not only the cash purchases.
  const routeStale = Boolean(plan?.decisions.some(d => d.bought > 0 && !unitQuote(quotes.get(d.itemId))?.vendor && stale(d.itemId))
    || (destination === "ah" && product !== null && stale(product)));
  const offer = new Set(vendorOffers);
  const stepName = (id: number) => (id === recipe.spellId ? recipe.name : byId.get(id)?.name ?? `Recipe ${id}`);
  const makeSteps = plan?.steps.filter((s) => s.recipeId !== recipe.spellId) ?? [];
  const leftovers = Object.entries(plan?.leftovers ?? {});
  const possible = Object.entries(plan?.possibleLeftovers ?? {}).filter(([id, n]) => n !== (plan?.leftovers[Number(id)] ?? 0));
  const decisions = plan?.decisions ?? [];
  const reasonText: Record<string, string> = { output: "output count unknown", cooldown: "cooldown recorded in the game files", cycle: "its materials lead back to its own product", reagents: "materials unknown", unknown: "unknown recipe" };
  // Payback keeps the addon's trainer basis: one craft, every material bought.
  const payback = training === null ? null
    : estimate.profit !== null && estimate.profit > 0 && destination === "ah" ? { crafts: Math.ceil(training / estimate.profit) } : { why: estimate.profit === null ? "the profit per craft is unavailable" : "the craft does not make a profit" };
  // The headline is the selected route at the selected count, rounded once for the batch; per craft it is an average.
  // Buying everything for one craft (the ranking's and the addon's row basis) stays as a labelled, secondary baseline.
  const routeProfit = batch && batch.profit !== null ? batch.profit : null;
  const average = routeProfit !== null ? Math.round(routeProfit / crafts!) : null;
  const routeMargin = routeProfit !== null && plan && plan.cost ? routeProfit / plan.cost : null;
  const why = estimate.yield === null ? "output count unknown" : !batch ? (destination === "vendor" ? "no verified vendor sell price" : "no market value for the finished item") : "a material has no price";
  const pct = (m: number | null) => (m !== null ? ` (${Math.round(m * 100)}% margin)` : "");
  const buyAll = estimate.profit !== null ? `Buy-all, one craft: ${formatCopper(estimate.profit)}${pct(estimate.margin)}` : null;
  const cooldown = rootCooldownMs ? duration(rootCooldownMs) : null;
  // The whole-profession ranking is computed on the server: a link reloads the page for the chosen market. The path
  // is read after hydration, so the server's markup and the first client render agree.
  const rankHref = path && realm && house && !(rankingShown && market && realmSlugOf(realm) === market.realm && house === market.house)
    ? `${path}?${new URLSearchParams(shareEntries(state))}#profit-ranking` : null;

  // The copied plan: everything the page shows that a player needs at the auction house, and no local data.
  const buyLines = (plan?.purchases ?? []).map((p) => {
    const q = quotes.get(p.itemId);
    const price = p.unit !== null ? ` — ${formatCopper(p.unit * p.count)} (${p.vendor ? "verified vendor" : q?.market?.day ?? ""}${!p.vendor && stale(p.itemId) ? ", stale" : ""})`
      : loaded ? ` — no quote${offer.has(p.itemId) ? " (vendor offer seen, not a unit price)" : ""}` : "";
    return `${p.count} × ${names(p.itemId)}${price}`;
  });
  const copy = () => [
    recipe.name, `${crafts ?? initial.crafts} crafts`,
    marketText ? `${marketText} · Everloot listed-price estimates` : "No auction house selected",
    `Sell: ${destination === "ah" ? "auction house" : "vendor"} · Route: ${strategy === "buy" ? "buy all materials" : "cheapest allowed"}`,
    ...(plan ? plan.steps.map((s, i) => `${i + 1}. Craft ${s.crafts} × ${stepName(s.recipeId)}`) : []),
    ...(makeSteps.length ? ["Make steps are from the game-file catalog, not checked against any character."] : []),
    "Buy:", ...buyLines,
    leftovers.length ? `Leftovers: ${leftovers.map(([id, n]) => `${n} × ${names(Number(id))}`).join(", ")}` : "Leftovers: none",
    ...(ownedMap.size ? [`Counts you typed: ${[...ownedMap].map(([id, n]) => `${n} × ${names(id)}`).join(", ")}`] : []),
    ...(loaded && plan ? [plan.cost !== null ? `Material value: ${formatCopper(plan.cost)}` : `Known subtotal (incomplete): ${formatCopper((plan.purchases).reduce((s, p) => s + (p.unit ?? 0) * p.count, 0))}`] : []),
    ...(loaded ? (routeProfit !== null
      ? [`Profit for ${crafts} crafts: ${formatCopper(routeProfit)}${routeStale ? " (includes stale prices)" : ""}`, `Average per craft: ${formatCopper(average!)}${pct(routeMargin)}`]
      : [`Profit unavailable: ${why}`]) : []),
    ...(loaded && buyAll ? [buyAll] : []),
    ...(cooldown ? [`The game files record a ${cooldown} cooldown for this recipe; not checked against any character.`] : []),
  ].join("\n");
  const link = () => {
    const search = shareSearch(new URL(window.location.href).searchParams, state);
    if (search === null) return null;
    const url = new URL(window.location.href);
    url.search = search;
    url.hash = "recipe-shopping";
    return url.toString();
  };
  // Kept for the older shopping-list wording: the materials of the requested crafts at their quotes.
  const known = (plan?.purchases ?? []).reduce((sum, p) => sum + (p.unit ?? 0) * p.count, 0);
  const pricedCount = (plan?.purchases ?? []).filter((p) => p.unit !== null).length;
  const complete = plan !== null && plan.unpriced.length === 0;
  const producers = [...new Set(decisions.map((d) => d.itemId))].flatMap((id) => catalog.filter((r) => r.itemId === id));
  const tooBig = shareSearch(new URLSearchParams(), state) === null;

  return (
    <section id="recipe-shopping" aria-labelledby="recipe-shopping-heading" className="scroll-mt-24">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 id="recipe-shopping-heading" className="break-words text-xl font-semibold text-fg">{recipe.name}</h3>
            <p className="mt-1 flex items-center gap-2 text-meta text-muted"><Badge tone="files" /> Materials from game files</p>
            {outputItem && <a href={auctionActivityHref(outputItem, recipe.itemName)} className="lnk text-sm">Auction activity for the finished item</a>}
          </div>
          <label className="grid gap-1 text-cell text-fg-2">Crafts
            <Input className="w-24" type="number" min={1} max={SHARE_LIMITS.crafts} step={1} value={count} onChange={e => changeCount(e.target.value)} />
          </label>
        </div>
        {[...issues, ...dropped].length > 0 && <ul role="status" className="space-y-1 text-meta text-fg-2">
          {[...issues, ...dropped].map((text) => <li key={text}>{text}</li>)}
        </ul>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-cell">
          <span className="flex flex-wrap items-center gap-2">Sell to
            <Segmented label="Sell to" value={destination} onChange={(v) => { setDestination(v); edit({ destination: v }); }}
              options={[{ value: "ah", label: "Auction house" }, { value: "vendor", label: "Vendor" }]} />
          </span>
          <span className="flex flex-wrap items-center gap-2">Route
            <Segmented label="Route" value={strategy} onChange={(v) => { setStrategy(v); edit({ strategy: v }); }}
              options={[{ value: "buy", label: "Buy all" }, { value: "cheapest", label: "Cheapest allowed" }]} />
          </span>
        </div>
        {cooldown && <p className="text-meta text-fg-2">The game files record a {cooldown} cooldown for this recipe, so a character may manage fewer crafts than asked; not checked against any character. The materials below are for every craft asked.</p>}
        {!houses ? <div className="flex flex-wrap items-center gap-3">
          {marketText && <span className="text-cell">{marketText}</span>}
          {realm && !house && <span className="text-cell">{realm}: pick an auction house</span>}
          <button type="button" className="btn" disabled={discovering} onClick={() => void loadMarkets()}>
            {discovering ? "Loading auction houses…" : realm ? "Change realm or house" : "Load auction prices"}
          </button>
        </div> : <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-wrap items-center gap-y-1 text-cell">Realm
            <select aria-label="Realm" className={SELECT_CLASS} value={realm} onChange={e => { setRealm(e.target.value); setHouse(""); setResult(undefined); edit({ realm: e.target.value ? realmSlugOf(e.target.value) : null, house: null }); }}>
              <option value="">Select realm</option>
              {Object.keys(houses).sort().map(name => <option key={name}>{name}</option>)}
            </select>
          </label>
          {realm && <label className="text-cell">Auction house
            <select aria-label="Auction house" className={SELECT_CLASS} value={house} onChange={e => { setHouse(e.target.value); setResult(undefined); edit({ house: (e.target.value || null) as AuctionHouse | null }); }}>
              <option value="">Select house</option>
              {(houses[realm] ?? []).map(name => <option key={name}>{name}</option>)}
            </select>
          </label>}
          {Object.keys(houses).length === 0 && <p className="text-muted">No auction houses have public quotes yet.</p>}
        </div>}
        {(marketError || current?.rows === null) && <div className="flex flex-wrap items-center gap-2" role="status">
          <span>Market prices unavailable. Material quantities are ready to copy.</span>
          {current?.rows === null && <button type="button" className="btn" onClick={() => setRequest(n => n + 1)}>Retry prices</button>}
        </div>}
        {house && realm && !current && <p className="text-muted" role="status">Loading prices…</p>}
        {loaded && <p className="text-meta text-muted">{marketText} · Everloot listed-price estimates, {estimate.cutPercent}% auction cut. These are recent observations, not guaranteed live offers. Separate from AH Ledger&apos;s margins; no sales per day.</p>}
        {!valid && <p role="status">Enter a whole number from 1 to {SHARE_LIMITS.crafts.toLocaleString("en-US")} crafts.</p>}
        {ownedBad.length > 0 && <p role="status">Owned counts must be a whole number from 0 to 1,000,000; {ownedBad.map(names).join(", ")} left out.</p>}
        {ownedFull && <p role="status">At most {SHARE_LIMITS.have} owned counts fit in a plan: clear one before adding another.</p>}
        {catalogTruncated && <p className="text-meta text-muted">Only part of the catalog is listed: the list stops at the planner&apos;s bounds or the page&apos;s size limit, so a cheaper make may be missing.</p>}

        {loaded && <div role="status" className="space-y-1" data-estimate>
          <p className="flex flex-wrap items-center gap-2 text-meta text-muted"><span className="font-semibold text-fg">Everloot estimate</span>
            {routeStale && <span>includes stale prices</span>}</p>
          {routeProfit !== null && batch
            ? <>
              <p className="font-semibold">Profit for {crafts} crafts: {formatCopper(routeProfit)} (sale {formatCopper(batch.gross)}, cut {formatCopper(batch.cut)})</p>
              <p>Average per craft: {formatCopper(average!)}{pct(routeMargin)}</p>
            </>
            : <p>Profit unavailable: {why}</p>}
          {plan && (plan.cost !== null ? <p>Material value: {formatCopper(plan.cost)}</p> : pricedCount > 0 && <p>Known subtotal: {formatCopper(known)}</p>)}
          {plan && ownedMap.size > 0 && plan.cashCost !== null && <p>To buy after your counts: {formatCopper(plan.cashCost)}</p>}
          {plan && (complete ? <p className="text-meta text-muted">Materials per craft (average): {formatCopper(Math.round((plan.cost ?? known) / crafts!))}</p> : <p>Batch total incomplete. One or more reagents have no quote.</p>)}
          {buyAll && <p className="text-meta text-muted">{buyAll}, for comparison with buying every material.</p>}
          {payback && ("crafts" in payback
            ? <p className="text-meta text-muted">Training {formatCopper(training!)} (trainer cost players recorded for this exact recipe spell ID) pays back after {payback.crafts} crafts at the buy-all one-craft estimate.</p>
            : <p className="text-meta text-muted">Training payback unavailable: {payback.why}.</p>)}
        </div>}

        {plan && makeSteps.length > 0 && <div className="space-y-1">
          <p className="text-meta text-muted">Make steps use recipes from the game-file catalog, not checked against any character.</p>
          <ol data-plan-steps className="list-decimal space-y-1 pl-5">
            {plan.steps.map((s) => <li key={s.recipeId} className="break-words">
              {s.crafts} × {stepName(s.recipeId)}{s.recipeId !== recipe.spellId ? ` (${byId.get(s.recipeId)?.profession ?? "catalog"})` : ""}
            </li>)}
          </ol>
        </div>}

        <ul data-plan-buy className="divide-y divide-line border-y border-line">
          {(plan?.purchases ?? recipe.reagents.map((r) => ({ itemId: r.itemId, count: r.count, unit: null, vendor: false }))).map((p) => {
            const q = quotes.get(p.itemId)?.market;
            return <li key={p.itemId} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="break-words">{plan ? `${p.count} × ` : ""}<Link href={`/database/items/${p.itemId}`} className="underline decoration-edge underline-offset-4 hover:decoration-fg">{names(p.itemId)}</Link></span>
                <a className="lnk text-sm" aria-label={`Auction activity for ${names(p.itemId)}`} href={auctionActivityHref(p.itemId, names(p.itemId))}>Activity</a>
              </span>
              {loaded && <span className="text-right text-meta text-muted">{p.unit !== null
                ? `${formatCopper(p.unit * p.count)} · ${formatCopper(p.unit)} each · ${p.vendor ? "verified vendor" : `${q?.day ?? ""}${stale(p.itemId) ? " (stale)" : ""}`}`
                : overCap.has(p.itemId) ? `Not priced: over the ${PRICE_ITEMS}-item price request`
                : `No quote${offer.has(p.itemId) ? " · Vendor offer seen, not a unit price (no purchase quantity)" : ""}`}</span>}
            </li>;
          })}
        </ul>
        {plan && plan.omitted.length > 0 && <p role="status">{plan.omitted.length} more items are not listed: the plan is incomplete.</p>}

        {plan && <div className="space-y-2">
          <p className="text-meta text-muted">Leftovers: {leftovers.length ? leftovers.map(([id, n]) => `${n} × ${names(Number(id))}`).join(", ") : "none"}
            {possible.length > 0 && ` · a variable yield could leave up to ${possible.map(([id, n]) => `${n} × ${names(Number(id))}`).join(", ")}`}</p>
          <details>
            <summary className="cursor-pointer text-cell">Counts you have</summary>
            <p className="mt-1 text-meta text-muted">Typed here only; nothing is read from the game. Each count is used once across the plan.</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {decisions.map((d) => <li key={d.itemId}>
                <label className="grid gap-1 text-cell"><span className="break-words">{names(d.itemId)} <span className="text-muted">(needs {d.need})</span></span>
                  <Input aria-label={`Have ${names(d.itemId)}`} inputMode="numeric" className="w-32" value={owned.get(d.itemId) ?? ""} onChange={e => changeOwned(d.itemId, e.target.value)} />
                </label>
              </li>)}
            </ul>
          </details>
        </div>}

        {producers.length > 0 && <div data-make className="space-y-2">
          <p className="text-cell font-semibold">Catalog recipes this plan may make</p>
          <p className="text-meta text-muted">Hypothetical: allowing a recipe compares making with buying under Cheapest allowed; it is not checked against any character and does not force a dearer route.</p>
          <ul className="space-y-1">
            {producers.map((r) => {
              const block = routeBlock(toCatalog(r));
              const on = make.has(r.recipeId);
              const excluded = plan?.exclusions.find((x) => x.recipeId === r.recipeId);
              return <li key={r.recipeId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">{r.name} <span className="text-muted">({r.profession}) makes {names(r.itemId)}</span>
                  {block && <span className="text-meta text-muted"> · not a route: {reasonText[block]}</span>}
                  {!block && excluded && <span className="text-meta text-muted"> · excluded: {reasonText[excluded.reason]}</span>}</span>
                <button type="button" className="btn" aria-pressed={on} aria-disabled={Boolean(block)} onClick={() => { if (!block) toggleMake(r.recipeId); }}>
                  {on ? "Make allowed" : "Allow make"}
                </button>
              </li>;
            })}
          </ul>
          {strategy === "buy" && make.size > 0 && <p className="text-meta text-muted">Buy all ignores make choices; pick Cheapest allowed to compare them.</p>}
        </div>}

        {rankHref && <p className="text-cell"><a href={rankHref} className="underline decoration-edge underline-offset-4 hover:decoration-fg">Rank every {recipe.profession} recipe for {realm}, {house}</a></p>}
        {valid && <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={copy} label="Copy recipe shopping list" />
          {!tooBig ? <CopyButton text={link} label="Copy link" /> : <p role="status">This plan is too large to share as a link.</p>}
        </div>}
      </Card>
    </section>
  );
}

/** "3 d 23 h", "6 h", "10 min": a recorded cooldown, rounded down to its two largest units. */
function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  if (days > 0) return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
  if (hours > 0) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return `${Math.max(1, minutes)} min`;
}

function toCatalog(r: PlanCatalogEntry): CatalogRecipe {
  return { recipeId: r.recipeId, itemId: r.itemId, minimum: r.minimum, maximum: r.maximum, reagents: r.reagents.map(([itemId, count]) => ({ itemId, count })), cooldownMs: r.cooldownMs };
}
