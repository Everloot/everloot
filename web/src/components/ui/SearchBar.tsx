"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import GameIcon from "@/components/game/GameIcon";
import { QUALITY_TEXT, qualityOf } from "./quality";

/** One row the suggestion route answers (GET /search/suggest). */
export interface Suggestion { type: "item" | "npc" | "quest" | "object"; id: number; label: string; href: string; quality?: number | null; icon?: string }

const TYPE_LABEL: Record<Suggestion["type"], string> = { item: "Item", npc: "NPC", quest: "Quest", object: "Object" };
export const SEARCH_SCOPES = [
  { value: "", label: "All" }, { value: "item", label: "Items" }, { value: "npc", label: "NPCs" }, { value: "quest", label: "Quests" }, { value: "object", label: "Objects" },
] as const;

const cache = new Map<string, Suggestion[]>();

/** The suggestions for what is typed, 120 ms after the last key; the answer to an older text is dropped. */
function useSuggestions(text: string, scope: string): Suggestion[] {
  const [rows, setRows] = useState<Suggestion[]>([]);
  useEffect(() => {
    const q = text.trim();
    const key = `${scope}|${q.toLowerCase()}`;
    if (!q) { setRows([]); return; }
    const hit = cache.get(key);
    if (hit) { setRows(hit); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      // The site's own route, matched on the names the pages show (/api/suggest keeps the agreed names only).
      fetch(`/search/suggest?q=${encodeURIComponent(q)}${scope ? `&in=${scope}` : ""}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((body: { results?: Suggestion[] }) => { const list = body.results ?? []; cache.set(key, list); setRows(list); })
        .catch(() => {});
    }, 120);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [text, scope]);
  return rows;
}

/**
 * A search field with instant suggestions (items, NPCs, quests, objects), as a combobox: arrow keys move
 * through the list, Enter opens the one picked, or searches when none is, Escape closes. Inside a GET form,
 * so without JavaScript it is a plain search.
 */
export function SuggestField({ id, name = "q", label, placeholder, defaultValue = "", scope = "", className, listClassName = "", inputRef, describedBy, after }: {
  id: string; name?: string; label: string; placeholder?: string; defaultValue?: string; scope?: string; className: string; listClassName?: string;
  inputRef?: RefObject<HTMLInputElement | null>; describedBy?: string; after?: ReactNode;
}) {
  const [text, setText] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rows = useSuggestions(text, scope);
  const list = useRef<HTMLUListElement>(null);
  const listId = `${id}-suggestions`;
  const shown = open && rows.length > 0;
  useEffect(() => setActive(-1), [rows]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && rows.length) { event.preventDefault(); setOpen(true); setActive((a) => (a + 1) % rows.length); }
    else if (event.key === "ArrowUp" && rows.length) { event.preventDefault(); setOpen(true); setActive((a) => (a <= 0 ? rows.length - 1 : a - 1)); }
    // Each row is a link, so Enter follows the picked one the way a click does (client-side navigation).
    else if (event.key === "Enter" && shown && active >= 0) { event.preventDefault(); list.current?.querySelectorAll("a")[active]?.click(); setOpen(false); }
    else if (event.key === "Escape" && shown) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="search"
        value={text}
        maxLength={200}
        autoComplete="off"
        placeholder={placeholder}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        // The rows on screen answer the old text until the next ones arrive, so a pick made in them ends here.
        onChange={(event) => { setText(event.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={className}
      />
      {after}
      <ul ref={list} id={listId} role="listbox" aria-label={`Suggestions for ${label.toLowerCase()}`} hidden={!shown}
        className={`absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-control border border-edge bg-panel py-1 ${listClassName}`}>
        {rows.map((row, i) => (
          <li key={`${row.type}-${row.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
            <Link
              href={row.href}
              tabIndex={-1}
              // Pressing a row must not take focus from the field first, or the list closes before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => setOpen(false)}
              className={`flex h-9 items-center gap-3 px-3 text-cell ${i === active ? "bg-canvas" : ""}`}
            >
              {row.icon && <GameIcon src={row.icon} size={18} />}
              <span className={`min-w-0 flex-1 truncate ${row.type === "item" && typeof row.quality === "number" && row.quality <= 5 ? QUALITY_TEXT[qualityOf(row.quality)] : "text-fg"}`}>{row.label}</span>
              <span className="shrink-0 text-cell-2 text-muted">{TYPE_LABEL[row.type]}{row.label.endsWith(String(row.id)) ? "" : ` ${row.id}`}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface SearchBarProps {
  /** Where the form goes, with the query as `?q=`. */
  action: string;
  /** What the field searches, for screen readers: "Search the database". */
  label: string;
  placeholder?: string;
  defaultValue?: string;
  /** Unique on the page. */
  id?: string;
  /** One short line under the field: what can be typed. */
  hint?: string;
  /** Scope chips under the field (All · Items · NPCs · Quests · Objects), sent as `?in=`. */
  scopes?: boolean;
  defaultScope?: string;
  /** 40 px instead of 48, for a field that shares its row (the search page). */
  compact?: boolean;
}

/**
 * The large search field a page leads with (48 px, full width), with instant suggestions and, on the database
 * hub, scope chips. A plain GET form underneath, so it works without JavaScript.
 */
export default function SearchBar({ action, label, placeholder, defaultValue = "", id: given, hint, scopes = false, defaultScope = "", compact = false }: SearchBarProps) {
  const auto = useId();
  const id = given ?? `search-${auto.replace(/:/g, "")}`;
  const [scope, setScope] = useState(defaultScope);
  const height = compact ? "h-10" : "h-12";
  return (
    <form action={action} method="get" role="search" data-search-bar className="min-w-0">
      <div className="flex min-w-0 gap-2">
        <SuggestField
          id={id}
          label={label}
          placeholder={placeholder}
          defaultValue={defaultValue}
          scope={scope}
          describedBy={hint ? `${id}-hint` : undefined}
          className={`${height} w-full min-w-0 rounded-control border border-edge bg-panel px-4 text-base text-fg placeholder:text-muted focus:border-accent focus:outline-none`}
        />
        {/* A scoped search keeps its scope when there are no chips to show it. */}
        {!scopes && defaultScope && <input type="hidden" name="in" value={defaultScope} />}
        <button type="submit" className={`btn btn-primary ${height} shrink-0`}>Search</button>
      </div>
      {scopes && (
        <fieldset className="mt-2 flex flex-wrap gap-2">
          <legend className="sr-only">Search in</legend>
          {SEARCH_SCOPES.map((s) => (
            <label key={s.value} className="cursor-pointer">
              <input type="radio" name="in" value={s.value} checked={scope === s.value} onChange={() => setScope(s.value)} className="peer sr-only" />
              <span className="ctl inline-flex items-center border border-edge px-3 text-fg-2 hover:text-fg peer-checked:border-accent peer-checked:text-fg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">{s.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      {hint && <p id={`${id}-hint`} className="mt-2 text-meta text-muted">{hint}</p>}
    </form>
  );
}
