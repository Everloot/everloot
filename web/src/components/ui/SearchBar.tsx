"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import GameIcon from "@/components/game/GameIcon";
import type { PeopleSearch } from "@/lib/people-search";
import { QUALITY_TEXT, qualityOf } from "./quality";

/**
 * One row under the field: a database page from GET /search/suggest, or (unscoped only) a character or guild from
 * GET /search/people. Characters and guilds have no id; their `note` says who and where.
 */
export interface Suggestion { type: "item" | "npc" | "quest" | "object" | "instance" | "character" | "guild"; id?: number; label: string; href: string; quality?: number | null; icon?: string; note?: string }

const TYPE_LABEL: Record<Suggestion["type"], string> = { item: "Item", npc: "NPC", quest: "Quest", object: "Object", instance: "Instance", character: "Character", guild: "Guild" };
/** The row's right-hand note: a dungeon or raid says which and its level, a character or guild who and where; the rest their type and id. */
const typeNote = (row: Suggestion) => row.note ?? `${TYPE_LABEL[row.type]}${row.id === undefined || row.label.endsWith(String(row.id)) ? "" : ` ${row.id}`}`;
export const SEARCH_SCOPES = [
  { value: "", label: "All" }, { value: "item", label: "Items" }, { value: "npc", label: "NPCs" }, { value: "quest", label: "Quests" }, { value: "object", label: "Objects" },
] as const;

/** Database pages answered for a text, kept for the page's life. Characters and guilds are never kept, so a hide shows at once. */
const cache = new Map<string, Suggestion[]>();

const LIMIT = 8;
/** At most this many character and guild rows; database pages come first and fill the rest of the 8. */
export const PEOPLE_ROWS = 3;

/** The rows /search/people adds: characters, then guilds, an exact name first. */
export function peopleRows(body: Partial<PeopleSearch> | null): Suggestion[] {
  const rows = [...(body?.characters?.results ?? []), ...(body?.guilds?.results ?? [])];
  return rows.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, PEOPLE_ROWS)
    .map((r) => ({ type: r.type, label: r.label, href: r.href, note: r.type === "guild" ? `Guild · ${r.meta}` : r.meta }));
}

/** Database pages first, cut so up to 3 character and guild rows fit under them in the 8. */
export function withPeople(database: Suggestion[], people: Suggestion[]): Suggestion[] {
  const kept = people.slice(0, PEOPLE_ROWS);
  return [...database.slice(0, LIMIT - kept.length), ...kept];
}

/**
 * Whether the text could start a character name (2 to 12 letters) or a guild name (2 to 24 letters, digits, spaces,
 * apostrophes and hyphens, starting with a letter or digit): the same rules as validPlayerName and validGuildName in
 * the protocol package, copied so the browser bundle does not load it. Text with no letter at all is an id ("6948"),
 * the box's most common lookup, so it never asks either. Only otherwise is /search/people asked.
 */
export function couldBeName(text: string): boolean {
  if (!/\p{L}/u.test(text)) return false;
  return /^\p{L}{2,12}$/u.test(text) || (text.length >= 2 && text.length <= 24 && /^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u.test(text));
}

/** Database rows wait 120 ms after the last key; characters and guilds wait longer, as they reach storage. */
const PEOPLE_PAUSE_MS = 280;
/** A character and guild answer slower than this is dropped: the database rows never wait for it. */
export const PEOPLE_TIMEOUT_MS = 800;

/**
 * The suggestions for what is typed, 120 ms after the last key; the answer to an older text is dropped. An unscoped
 * box also asks /search/people (uncached) when the text could start a name; its rows are added under the database
 * rows when they arrive, and nothing waits for them.
 */
function useSuggestions(text: string, scope: string): Suggestion[] {
  const [rows, setRows] = useState<Suggestion[]>([]);
  useEffect(() => {
    const q = text.trim();
    const key = `${scope}|${q.toLowerCase()}`;
    if (!q) { setRows([]); return; }
    const hit = cache.get(key);
    const ctrl = new AbortController();
    // What this text has so far; the list shows the older text's rows until its database rows arrive.
    let database: Suggestion[] | null = hit ?? null;
    let people: Suggestion[] = [];
    const show = () => { if (database && !ctrl.signal.aborted) setRows(withPeople(database, people)); };
    show();
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!hit) {
      timers.push(setTimeout(() => {
        // The site's own route, matched on the names the pages show (/api/suggest keeps the agreed names only).
        fetch(`/search/suggest?q=${encodeURIComponent(q)}${scope ? `&in=${scope}` : ""}`, { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : { results: [] }))
          .then((body: { results?: Suggestion[] }) => { database = body.results ?? []; cache.set(key, database); show(); })
          .catch(() => {});
      }, 120));
    }
    if (!scope && couldBeName(q)) {
      timers.push(setTimeout(() => {
        // A slow, failed or switched-off lookup adds no rows.
        const slow = new AbortController();
        ctrl.signal.addEventListener("abort", () => slow.abort());
        timers.push(setTimeout(() => slow.abort(), PEOPLE_TIMEOUT_MS));
        fetch(`/search/people?q=${encodeURIComponent(q)}`, { signal: slow.signal, cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((body) => { people = peopleRows(body); show(); })
          .catch(() => {});
      }, PEOPLE_PAUSE_MS));
    }
    return () => { timers.forEach(clearTimeout); ctrl.abort(); };
  }, [text, scope]);
  return rows;
}

/**
 * A search field with instant suggestions (items, NPCs, quests, objects, dungeons and raids, characters and guilds), as a combobox:
 * arrow keys move through the list, Enter opens the one picked, or searches when none is, Escape closes. Inside
 * a GET form, so without JavaScript it is a plain search.
 */
export function SuggestField({ id, name = "q", label, placeholder, defaultValue = "", scope = "", className, listClassName = "", inputRef, describedBy, after }: {
  id: string; name?: string; label: string; placeholder?: string; defaultValue?: string; scope?: string; className: string; listClassName?: string;
  inputRef?: RefObject<HTMLInputElement | null>; describedBy?: string; after?: ReactNode;
}) {
  const [text, setText] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  // The picked row is held by its link, so rows added under it (characters, guilds) leave the pick where it is.
  const [picked, setPicked] = useState<string | null>(null);
  const rows = useSuggestions(text, scope);
  const active = picked === null ? -1 : rows.findIndex((r) => r.href === picked);
  const list = useRef<HTMLUListElement>(null);
  const listId = `${id}-suggestions`;
  const shown = open && rows.length > 0;
  useEffect(() => setPicked(null), [scope]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && rows.length) { event.preventDefault(); setOpen(true); setPicked(rows[(active + 1) % rows.length].href); }
    else if (event.key === "ArrowUp" && rows.length) { event.preventDefault(); setOpen(true); setPicked(rows[active <= 0 ? rows.length - 1 : active - 1].href); }
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
        onChange={(event) => { setText(event.target.value); setOpen(true); setPicked(null); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={className}
      />
      {after}
      <ul ref={list} id={listId} role="listbox" aria-label={`Suggestions for ${label.toLowerCase()}`} hidden={!shown}
        className={`absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-control border border-edge bg-panel py-1 ${listClassName}`}>
        {rows.map((row, i) => (
          <li key={`${row.type}-${row.href}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
            <Link
              href={row.href}
              tabIndex={-1}
              // Pressing a row must not take focus from the field first, or the list closes before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setPicked(row.href)}
              onClick={() => setOpen(false)}
              className={`flex h-9 items-center gap-3 px-3 text-cell ${i === active ? "bg-canvas" : ""}`}
            >
              {row.icon && <GameIcon src={row.icon} size={18} />}
              <span className={`min-w-0 flex-1 truncate ${row.type === "item" && typeof row.quality === "number" && row.quality <= 5 ? QUALITY_TEXT[qualityOf(row.quality)] : "text-fg"}`}>{row.label}</span>
              <span className="shrink-0 text-cell-2 text-muted">{typeNote(row)}</span>
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
