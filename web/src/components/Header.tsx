"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics/track";
import AccountControls from "./AccountControls";
import GameVersionLabel from "./GameVersionLabel";
import { SuggestField } from "./ui/SearchBar";
import { TOOL_GROUPS, toolGroups } from "@/data/tools";

type NavLink = { label: string; href: string };

/** The top bar: six items, Tools opening the grouped menu below. */
export const PRIMARY: NavLink[] = [
  { label: "Database", href: "/database" },
  { label: "Map", href: "/map" },
  { label: "Changes", href: "/changes" },
  { label: "Lore", href: "/lore" },
  { label: "Docs", href: "/docs" },
];

// The Tools menu lives in data/tools.ts so the home page lists the same groups.
export { TOOL_GROUPS };

const TOOL_HREFS = [...TOOL_GROUPS.flatMap((g) => g.links.map((l) => l.href)), "/guilds"];

const isCurrent = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

const navItem = "inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-2 transition-colors";
const navState = (on: boolean) => (on ? "border-accent text-fg" : "border-transparent text-fg-2 hover:text-accent");
const menuLink = "flex min-h-11 items-center rounded-control px-3 text-sm text-fg-2 hover:bg-canvas hover:text-accent";

function SearchIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/**
 * The compact bar (docs/design/specs/2026-10-20-account-shell-design.md). From the layout: `savedBuilds` adds Your
 * builds to the avatar menu (EVERLOOT_SAVED_BUILDS); `accountSwitching` is true with Better Auth (EVERLOOT_AUTH_V2),
 * which can hold several accounts on one browser; `profiles` is EVERLOOT_PROFILES, without which the avatar menu
 * never asks for the player's shell. With it, the menu fetches the player from /api/me/shell itself. `guilds` is
 * EVERLOOT_GUILDS: the Tools menu then offers Guilds in place of the guild board.
 */
export default function Header({ savedBuilds = false, profiles = false, accountSwitching = false, guilds = false }: {
  savedBuilds?: boolean;
  profiles?: boolean;
  accountSwitching?: boolean;
  guilds?: boolean;
}) {
  const groups = toolGroups(guilds);
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // Below 1280 px the bar has no room for the field: the search icon opens it full width under the bar.
  const [searchOpen, setSearchOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchRow = useRef<HTMLInputElement>(null);

  useEffect(() => { if (searchOpen) searchRow.current?.focus(); }, [searchOpen]);
  // A new page closes the opened field.
  useEffect(() => setSearchOpen(false), [path]);

  // A click outside the Tools menu closes it.
  useEffect(() => {
    if (!toolsOpen) return;
    const close = (event: PointerEvent) => { if (!tools.current?.contains(event.target as Node)) setToolsOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [toolsOpen]);

  // "/" focuses the search field, as on GitHub, unless the visitor is typing somewhere already.
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const field = search.current;
      if (!field || field.offsetParent === null) return;
      event.preventDefault();
      field.focus();
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  const closeAll = () => { setOpen(false); setToolsOpen(false); };
  const toolsCurrent = TOOL_HREFS.some((href) => isCurrent(path, href));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas" onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      if (toolsOpen) { setToolsOpen(false); toolsButton.current?.focus(); }
      if (open) { setOpen(false); toggle.current?.focus(); }
      if (searchOpen) { setSearchOpen(false); searchButton.current?.focus(); }
    }}>
      {/* The data column's width and gutters (globals.css), so the logo lines up with the data tables. */}
      <div className="mx-auto flex h-header max-w-data items-center gap-3 px-4 lg:gap-4 lg:px-6">
        <Link href="/" className="inline-flex min-h-11 shrink-0 items-center gap-2 text-lg font-bold tracking-tight text-fg" onClick={closeAll}>
          {/* The favicon's diamond, outlined in the accent green. */}
          <svg aria-hidden="true" viewBox="8 8 48 48" width="16" height="16" className="text-accent">
            <path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
          </svg>
          everloot
        </Link>

        <nav aria-label="Primary" className="hidden shrink-0 items-center text-sm font-medium lg:flex">
          <Link href={PRIMARY[0].href} aria-current={isCurrent(path, PRIMARY[0].href) ? "page" : undefined} className={`${navItem} ${navState(isCurrent(path, PRIMARY[0].href))}`}>{PRIMARY[0].label}</Link>
          <div ref={tools} className="relative">
            <button
              ref={toolsButton}
              type="button"
              aria-expanded={toolsOpen}
              aria-controls="tools-menu"
              onClick={() => setToolsOpen(!toolsOpen)}
              className={`${navItem} gap-1.5 ${navState(toolsCurrent || toolsOpen)}`}
            >
              Tools
              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className={toolsOpen ? "rotate-180" : undefined}><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
            {/* Always in the page, so the tools are in the HTML for crawlers; hidden until opened. */}
            <div id="tools-menu" hidden={!toolsOpen} className={`pop absolute left-0 top-full mt-2 w-[36rem] grid-cols-3 gap-6 rounded-card border border-edge bg-panel p-6 ${toolsOpen ? "grid" : "hidden"}`}>
              {groups.map((group) => (
                <div key={group.title}>
                  <p className="mb-2 px-3 font-mono text-xs text-muted">{group.title}</p>
                  <ul>
                    {group.links.map((link) => (
                      <li key={link.href}>
                        <Link href={link.href} onClick={closeAll} aria-current={isCurrent(path, link.href) ? "page" : undefined} className={menuLink}>{link.label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          {PRIMARY.slice(1).map((link) => {
            const on = isCurrent(path, link.href);
            return <Link key={link.href} href={link.href} aria-current={on ? "page" : undefined} className={`${navItem} ${navState(on)}`}>{link.label}</Link>;
          })}
        </nav>

        {/* The site's one search, in the middle of the bar: items, NPCs, quests, zones, lore and tools, with instant
            suggestions for database pages. A GET form, so it works without JavaScript. */}
        <div className="hidden min-w-0 flex-1 justify-center xl:flex">
          <form action="/search" method="get" role="search" onSubmit={() => track("search", { surface: "lore" })} className="flex h-8 w-full min-w-0 max-w-[360px] items-center gap-2 rounded-full border border-edge bg-panel px-3 text-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            <SearchIcon />
            <SuggestField
              id="site-search"
              inputRef={search}
              label="Search Everloot"
              placeholder="Search Everloot"
              listClassName="-left-9 -right-3 mt-2"
              className="h-7 w-full min-w-0 bg-transparent text-sm text-fg placeholder:text-muted focus:outline-none"
            />
            <kbd aria-hidden="true" className="rounded-[4px] border border-line px-1.5 font-mono text-xs text-muted">/</kbd>
          </form>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            ref={searchButton}
            type="button"
            aria-label="Search"
            aria-expanded={searchOpen}
            aria-controls="header-search"
            onClick={() => setSearchOpen(!searchOpen)}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-fg-2 hover:text-accent xl:hidden"
          ><SearchIcon /></button>
          <GameVersionLabel className="hidden shrink-0 sm:block" />
          <AccountControls savedBuilds={savedBuilds} profiles={profiles} accountSwitching={accountSwitching} />
          <button ref={toggle} type="button" aria-label={open ? "Close menu" : "Menu"} aria-expanded={open} aria-controls="site-navigation" onClick={() => setOpen(!open)} className="btn min-h-8 shrink-0 px-3 text-sm lg:hidden">
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      <div id="header-search" hidden={!searchOpen} className="border-t border-line bg-canvas xl:hidden">
        <form action="/search" method="get" role="search" onSubmit={() => track("search", { surface: "lore" })} className="mx-auto flex max-w-wide items-center gap-2 px-4 py-2">
          <SuggestField
            id="header-search-field"
            inputRef={searchRow}
            label="Search Everloot"
            placeholder="Search Everloot"
            className="h-10 w-full min-w-0 rounded-control border border-edge bg-panel px-3 text-base text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button type="submit" className="btn btn-primary h-10 shrink-0 px-4 text-sm">Search</button>
        </form>
      </div>

      {open && (
        <nav id="site-navigation" aria-label="Site menu" className="pop absolute inset-x-0 top-full max-h-[75vh] overflow-y-auto border-b border-edge bg-panel lg:hidden">
          <div className="mx-auto max-w-data space-y-6 px-4 py-6 lg:px-6">
            <form action="/search" method="get" role="search" onSubmit={() => track("search", { surface: "lore" })} className="flex items-center gap-2 rounded-full border border-edge bg-canvas px-3 text-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
              <SearchIcon />
              <label htmlFor="menu-search" className="sr-only">Search Everloot</label>
              <input id="menu-search" name="q" type="search" maxLength={200} placeholder="Search Everloot" className="w-full min-w-0 bg-transparent text-fg placeholder:text-muted focus:outline-none" />
            </form>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6">
              <div>
                <p className="mb-1 px-3 font-mono text-xs text-muted">Browse</p>
                <ul>
                  {PRIMARY.map((link) => (
                    <li key={link.href}><Link href={link.href} onClick={closeAll} aria-current={isCurrent(path, link.href) ? "page" : undefined} className={menuLink}>{link.label}</Link></li>
                  ))}
                  <li><Link href="/about" onClick={closeAll} className={menuLink}>About</Link></li>
                </ul>
              </div>
              {groups.map((group) => (
                <div key={group.title}>
                  <p className="mb-1 px-3 font-mono text-xs text-muted">{group.title}</p>
                  <ul>
                    {group.links.map((link) => (
                      <li key={link.href}><Link href={link.href} onClick={closeAll} aria-current={isCurrent(path, link.href) ? "page" : undefined} className={menuLink}>{link.label}</Link></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <AccountControls place="menu" />
          </div>
        </nav>
      )}
    </header>
  );
}
