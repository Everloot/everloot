import Link from "next/link";
import type { ReactNode } from "react";
import GameIcon from "@/components/game/GameIcon";
import { DataTable, FilterBar, ResultStrip, type Column, type SortDirection } from "@/components/ui";
import { ahledgerMarketLabel, isAhledgerProfession, salesText, type AhledgerCraft, type AhledgerCredit } from "@/lib/ahledger";
import { SKILL_BRACKETS } from "@/lib/professions";
import { clampPageSize, DEFAULT_RECIPE_PAGE_SIZE, RECIPE_PAGE_SIZES, recipePage } from "@/lib/recipe-list";
import { AhledgerPanel } from "./AhledgerPanel";
import Coins from "./ClientCoins";

/**
 * The profession page's AH Ledger crafting margins, read, filtered, sorted and paged on the server, with all of it in
 * the URL so a view can be shared: `?sort=-profit&skill_min=76&skill_max=150&min_sales=5&priced=1&craft_size=50&craft_page=2`.
 * The names differ from the game-file recipe table's own (`page`, `size`, `min`, `max`), which shares the page.
 */

type Search = Record<string, string | string[] | undefined>;

// The sortable columns: the column key (also the `?sort=` value, `-` first for high to low) and the field it orders by.
const CRAFT_SORTS = { cost: "cost", net: "netValue", margin: "margin", sales: "salesPerDay", profit: "profitPerDay" } as const;
type CraftSort = keyof typeof CRAFT_SORTS;
type CraftOrder = { key: CraftSort; desc: boolean };
const DEFAULT_CRAFT_SORT: CraftOrder = { key: "profit", desc: true };
const MIN_SALES = [1, 5, 10, 25];
/** The parameters this table owns; every other one on the page is kept as it is. */
const CRAFT_PARAMS = ["sort", "skill_min", "skill_max", "min_sales", "priced", "craft_size", "craft_page"];

export interface CraftingQuery { sort: CraftOrder; skillMin: number | null; skillMax: number | null; minSales: number | null; priced: boolean; size: number; page: number }

const one = (search: Search, k: string) => { const v = search[k]; return ((Array.isArray(v) ? v[0] : v) ?? "").trim(); };
const whole = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);

/** `?sort=-profit` (high to low) or `?sort=cost` (low to high); anything else is the default, profit per day high to low. */
function parseCraftSort(raw: string): CraftOrder {
  const m = /^(-?)([a-z]+)$/.exec(raw);
  return m && m[2] in CRAFT_SORTS ? { key: m[2] as CraftSort, desc: m[1] === "-" } : DEFAULT_CRAFT_SORT;
}

/** The table's state from the URL; an unreadable value is left out rather than refused. */
export function craftingQuery(search: Search): CraftingQuery {
  const bound = (k: string) => { const n = whole(one(search, k)); return n === null || n < 1 ? null : Math.min(n, 999); };
  let skillMin = bound("skill_min"), skillMax = bound("skill_max");
  if (skillMin !== null && skillMax !== null && skillMin > skillMax) [skillMin, skillMax] = [skillMax, skillMin];
  const sales = one(search, "min_sales");
  const minSales = /^\d{1,6}(\.\d{1,2})?$/.test(sales) && Number(sales) > 0 ? Number(sales) : null;
  const page = whole(one(search, "craft_page"));
  return {
    sort: parseCraftSort(one(search, "sort")), skillMin, skillMax, minSales, priced: one(search, "priced") === "1",
    size: clampPageSize(one(search, "craft_size")), page: page !== null && page >= 1 ? page : 1,
  };
}

/** The rows the query keeps, in its order: unknown values last, then by spell id. A range or a sales floor drops rows that lack the value. */
export function craftingRows(rows: readonly AhledgerCraft[], q: CraftingQuery): AhledgerCraft[] {
  const field = CRAFT_SORTS[q.sort.key];
  return rows.filter((r) => (q.skillMin === null || (r.skill !== null && r.skill >= q.skillMin))
    && (q.skillMax === null || (r.skill !== null && r.skill <= q.skillMax))
    && (q.minSales === null || (r.salesPerDay !== null && r.salesPerDay >= q.minSales))
    && (!q.priced || (r.cost !== null && r.netValue !== null)))
    .sort((a, b) => {
      const left = a[field], right = b[field];
      if (left === null) return right === null ? a.spellId - b.spellId : 1;
      if (right === null) return -1;
      return (q.sort.desc ? right - left : left - right) || a.spellId - b.spellId;
    });
}

/**
 * The table's URL with some of its state changed: the page's other parameters kept in their order, the table's own
 * after them and left out at their defaults. A change that is not a page move starts again at page 1. Lands on the table.
 */
export function craftingHref(path: string, search: Search, query: CraftingQuery, change: Partial<CraftingQuery>): string {
  const next = { ...query, ...("page" in change ? {} : { page: 1 }), ...change };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (CRAFT_PARAMS.includes(k) || v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) params.append(k, x);
  }
  if (next.sort.key !== DEFAULT_CRAFT_SORT.key || next.sort.desc !== DEFAULT_CRAFT_SORT.desc) params.set("sort", `${next.sort.desc ? "-" : ""}${next.sort.key}`);
  if (next.skillMin !== null) params.set("skill_min", String(next.skillMin));
  if (next.skillMax !== null) params.set("skill_max", String(next.skillMax));
  if (next.minSales !== null) params.set("min_sales", String(next.minSales));
  if (next.priced) params.set("priced", "1");
  if (next.size !== DEFAULT_RECIPE_PAGE_SIZE) params.set("craft_size", String(next.size));
  if (next.page > 1) params.set("craft_page", String(next.page));
  const s = params.toString();
  return `${path}${s ? `?${s}` : ""}#ahledger-margins`;
}

/** "2026-11-24 05:45 UTC", as the page's other data times read. */
const utc = (iso: string) => { const d = new Date(iso).toISOString(); return `${d.slice(0, 10)} ${d.slice(11, 16)} UTC`; };

/** What the page read from AH Ledger for this market and profession. */
export type CraftingRead = { ok: true; recipes: AhledgerCraft[]; asOf: string | null; credit: AhledgerCredit } | { ok: false };

interface CraftingProps {
  profession: string;
  /** The AH Ledger market the page chose from its realm and house; null where AH Ledger has none. */
  market: string | null;
  /** The page's read of that market; null when there is no market. */
  read: CraftingRead | null;
  path: string;
  search: Search;
  spellIcon?: (spellId: number) => string | undefined;
  /** The page's realm and house picker (RealmHousePicker). */
  picker?: ReactNode;
  /** What to say when `market` is null. */
  none?: string;
}

const dash = <span className="text-muted">—</span>;
const coins = (n: number | null) => (n === null ? dash : <Coins copper={n} />);

export default function AhledgerCrafting({ profession, market, read, path, search, spellIcon, picker, none }: CraftingProps) {
  if (!isAhledgerProfession(profession)) return null;
  const controls = <>{picker}<p data-ahledger-market className="text-meta text-fg-2">{market ? `AH Ledger market: ${ahledgerMarketLabel(market)}` : none}</p></>;
  if (!market || !read) return <section data-ahledger="none" className="space-y-3"><h2 className="text-control font-medium text-fg">AH Ledger crafting margins</h2>{controls}</section>;
  if (!read.ok) return <AhledgerPanel title="AH Ledger crafting margins" state="failed" controls={controls}>{null}</AhledgerPanel>;

  const q = craftingQuery(search);
  const here = (change: Partial<CraftingQuery>) => craftingHref(path, search, q, change);
  const listed = recipePage(craftingRows(read.recipes, q), q);
  const columns: Column<AhledgerCraft>[] = [
    {
      // No prefetch: /database sits behind Cloudflare's bot challenge, so a prefetch before the visitor has passed it is
      // refused (403) and logs an error for every recipe in view. The link itself works.
      key: "recipe", header: "Recipe", cell: (r) => {
        const icon = spellIcon?.(r.spellId);
        return (
          <span className="inline-flex min-w-0 items-center gap-2">
            {icon ? <GameIcon src={icon} size={24} /> : <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-sm border border-line" />}
            <Link href={`/database/spells/${r.spellId}`} prefetch={false}>{r.name}</Link>
          </span>
        );
      },
    },
    { key: "skill", header: "Skill", numeric: true, cell: (r) => r.skill ?? dash },
    { key: "cost", header: "Cost", numeric: true, sortable: true, cell: (r) => r.cost === null ? "unpriced" : <Coins copper={r.cost} /> },
    { key: "net", header: "Net value", numeric: true, sortable: true, cell: (r) => coins(r.netValue) },
    { key: "margin", header: "Margin", numeric: true, sortable: true, cell: (r) => coins(r.margin) },
    { key: "sales", header: "Sales per day", numeric: true, sortable: true, cell: (r) => salesText(r.salesPerDay) },
    { key: "profit", header: "Profit per day", numeric: true, sortable: true, cell: (r) => coins(r.profitPerDay) },
  ];
  const active = Number(q.skillMin !== null || q.skillMax !== null) + Number(q.minSales !== null) + Number(q.priced);
  const strip = <ResultStrip total={listed.total} noun={listed.total === 1 ? "recipe" : "recipes"} page={listed.page} perPage={q.size} href={(page) => here({ page })} label={`${profession} crafting margin pages`} nofollow />;

  return <AhledgerPanel title="AH Ledger crafting margins" state="ready" credit={read.credit} controls={controls}>
    {read.asOf && <p data-prices-as-of className="text-meta text-fg-2">Prices as of <time dateTime={read.asOf}>{utc(read.asOf)}</time> · AH Ledger</p>}
    <p className="text-meta text-fg-2">AH Ledger reagent and result prices, separate from player uploads. Net value uses average yield less the 5% auction house cut. A missing reagent price makes the cost unpriced. Estimated profit per day is an upper bound assuming you supply the whole market, not guaranteed earnings. Estimated sales lean low and are unrecorded when too few scans support them.</p>
    {read.recipes.length === 0 ? <p className="text-meta text-fg-2">No crafting margins on this market yet.</p> : <>
      <FilterBar
        label={`${profession} crafting margin filters`}
        active={active}
        clearHref={here({ skillMin: null, skillMax: null, minSales: null, priced: false })}
        controls={[
          {
            type: "menu", key: "craft-skill", label: "Skill",
            options: [
              { label: "Any skill", href: here({ skillMin: null, skillMax: null }), on: q.skillMin === null && q.skillMax === null, reset: true },
              ...SKILL_BRACKETS.map((b) => {
                const max = b.max >= 999 ? null : b.max;
                return { label: max === null ? `${b.min}+` : `${b.min}–${b.max}`, href: here({ skillMin: b.min, skillMax: max }), on: q.skillMin === b.min && q.skillMax === max };
              }),
            ],
          },
          {
            type: "menu", key: "min-sales", label: "Sales per day",
            options: [
              { label: "Any", href: here({ minSales: null }), on: q.minSales === null, reset: true },
              ...MIN_SALES.map((n) => ({ label: `${n}+`, href: here({ minSales: n }), on: q.minSales === n })),
            ],
          },
          { type: "toggle", key: "priced", label: "Priced only", href: here({ priced: !q.priced }), on: q.priced },
          { type: "menu", key: "craft-size", label: "Rows", options: RECIPE_PAGE_SIZES.map((size) => ({ label: String(size), href: here({ size }), on: q.size === size })) },
        ]}
        aside={strip}
        nofollow
      />
      <DataTable
        dense
        caption={`${profession} crafting margins from AH Ledger`}
        columns={columns}
        rows={listed.rows}
        rowKey={(r) => String(r.spellId)}
        sort={{ key: q.sort.key, direction: q.sort.desc ? "desc" : "asc" }}
        sortHref={(key, direction: SortDirection) => here({ sort: { key: key as CraftSort, desc: direction === "desc" } })}
        empty={<p className="py-3 text-meta text-fg-2">No recipes match these filters.</p>}
        nofollow
      />
      {listed.pages > 1 && strip}
    </>}
  </AhledgerPanel>;
}
