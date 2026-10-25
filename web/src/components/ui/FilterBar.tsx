import FilterMenus from "./FilterMenus";
import Link from "./PendingLink";
import type { CSSProperties, ReactNode } from "react";

/** One choice in a filter menu: a link to the list with that choice toggled, so a filtered view is a URL. */
export interface FilterOption {
  label: ReactNode; href: string; on: boolean; count?: number; className?: string; style?: CSSProperties;
  /** "Any zone", "All classes": the no-filter choice, which never lights the button. */
  reset?: boolean;
}

export type FilterControl =
  /** A dropdown button. `multi` draws a box before each option (several can be on at once). */
  | { type: "menu"; key: string; label: string; options: FilterOption[]; multi?: boolean }
  /** A yes-only filter: on or off ("Crafted"). */
  | { type: "toggle"; key: string; label: string; href: string; on: boolean };

export interface FilterBarProps {
  /** What the bar filters, for screen readers: "Item filters". */
  label: string;
  /** A name box: a GET form that keeps the other filters as hidden fields. */
  search?: { action: string; value?: string; placeholder: string; label: string; keep: Record<string, string> };
  controls: FilterControl[];
  /** How many filters are on; above 0 the bar offers `clearHref`. */
  active: number;
  clearHref: string;
  /** Right of the filters: the result strip. */
  aside?: ReactNode;
}

const control = "ctl inline-flex items-center gap-1.5 whitespace-nowrap border px-3";
const idle = "border-edge text-fg-2 hover:border-fg-2 hover:text-fg";
const lit = "border-accent text-fg";

// Points up while its own <details> is open (a menu inside the phone sheet does not follow the sheet).
function Chevron() {
  return <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className="text-muted [[open]>summary>&]:rotate-180"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

function Menu({ c, phone }: { c: Extract<FilterControl, { type: "menu" }>; phone: boolean }) {
  if (c.options.length === 0) return null;
  const on = c.options.filter((o) => o.on && !o.reset);
  const summary = on.length === 0 ? c.label : on.length === 1 ? <>{c.label}: <span className="text-fg">{on[0].label}</span></> : <>{c.label} ({on.length})</>;
  return (
    // `name` makes the menus one group: opening one closes the other.
    <details name={phone ? "filters-phone" : "filters"} className="relative" data-filter={c.key}>
      <summary className={`${control} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${on.length ? lit : idle}`}>
        {summary}<Chevron />
      </summary>
      <ul className="pop z-30 mt-1 max-h-80 min-w-52 overflow-y-auto rounded-control border border-edge bg-panel p-1 sm:absolute sm:left-0 sm:top-full">
        {c.options.map((o, i) => (
          <li key={i}>
            <Link href={o.href} aria-current={o.on ? "true" : undefined} className="flex min-h-8 items-center gap-2 rounded-control px-2 text-control text-fg-2 hover:bg-canvas hover:text-fg">
              {c.multi && <span aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 rounded-[3px] border ${o.on ? "border-accent bg-accent" : "border-edge"}`} />}
              <span className={`min-w-0 flex-1 truncate ${o.on && !c.multi ? "text-fg" : ""} ${o.className ?? ""}`} style={o.style}>{o.label}</span>
              {o.count !== undefined && <span className="tabular-nums text-muted">{o.count.toLocaleString("en-US")}</span>}
              {o.on && <span className="sr-only">(selected)</span>}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Controls({ search, controls, active, clearHref, phone }: FilterBarProps & { phone: boolean }) {
  return (
    <>
      {search && (
        <form action={search.action} method="get" role="search" className={`flex ${phone ? "w-full" : ""}`}>
          {Object.entries(search.keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label htmlFor={phone ? "filter-q-phone" : "filter-q"} className="sr-only">{search.label}</label>
          <input
            id={phone ? "filter-q-phone" : "filter-q"}
            name="q"
            type="search"
            defaultValue={search.value ?? ""}
            maxLength={60}
            placeholder={search.placeholder}
            className={`ctl w-full min-w-0 border bg-panel px-3 text-fg placeholder:text-muted focus:border-accent focus:outline-none sm:w-44 ${search.value ? "border-accent" : "border-edge"}`}
          />
          {/* Enter in the field submits; out of the tab order, so focus never lands on a ring around nothing. */}
          <button type="submit" tabIndex={-1} className="sr-only">Filter</button>
        </form>
      )}
      {controls.map((c) => c.type === "menu"
        // Keyed on its choices, so after a client-side navigation the menu comes back closed.
        ? <Menu key={`${c.key}-${c.options.map((o) => Number(o.on)).join("")}`} c={c} phone={phone} />
        : <Link key={c.key} href={c.href} aria-current={c.on ? "true" : undefined} className={`${control} ${c.on ? lit : idle}`}>
            <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-[3px] border ${c.on ? "border-accent bg-accent" : "border-edge"}`} />{c.label}
          </Link>)}
      {active > 0 && <Link href={clearHref} className="ctl inline-flex items-center px-2 text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Clear filters</Link>}
    </>
  );
}

/**
 * The filter row above a database list: one wrapping row of 32 px dropdown buttons and toggles, every choice a
 * link (the filters live in the URL, so a view can be shared and works without JavaScript). Below 640 px the
 * controls fold into one "Filters (n)" button that opens them as a sheet; the aside stays in view.
 */
export default function FilterBar(props: FilterBarProps) {
  const { label, active, aside } = props;
  return (
    <FilterMenus label={label} className="flex flex-wrap items-center gap-2">
      <details className="w-full sm:hidden">
        <summary className={`${control} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${active ? lit : idle}`}>
          Filters{active > 0 && <span className="tabular-nums"> ({active})</span>}<Chevron />
        </summary>
        <div className="pop mt-2 flex flex-wrap gap-2 rounded-control border border-line bg-panel p-2">
          <Controls {...props} phone />
        </div>
      </details>
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        <Controls {...props} phone={false} />
      </div>
      {aside && <div className="ml-auto min-w-0 max-sm:w-full">{aside}</div>}
    </FilterMenus>
  );
}
