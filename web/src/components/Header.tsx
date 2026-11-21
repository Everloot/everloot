"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics/track";
import AccountControls from "./AccountControls";
import { REPORT_BUG_EVENT } from "./BugReport";
import GameVersionLabel from "./GameVersionLabel";
import { SuggestField } from "./ui/SearchBar";
import Icon from "./ui/Icon";
import { TOOL_GROUPS, toolGroups, type ToolGroup } from "@/data/tools";

type NavLink = { label: string; href: string };
/** A top bar item: a menu of links, or one link (Chat). */
export type NavItem = { label: string; href: string; links?: undefined } | { label: string; href?: undefined; links: NavLink[] };

/** The switches the layout passes in; each one adds the pages it turns on. */
type NavSwitches = { guilds?: boolean; players?: boolean; profiles?: boolean; savedBuilds?: boolean; reviewedGuides?: boolean };

// The catalogue's groups live in data/tools.ts so the home page lists the same tools.
export { TOOL_GROUPS };

/** The community pages the bar links directly, ahead of its menus, so they never sit in Lookup too. */
const COMMUNITY_HREFS = ["/players", "/guilds", "/rankings"];

/**
 * The top bar, in order: the community links (Players and Guilds when their switches are on, then Rankings), Lookup
 * (live data), Database (reference from the game files and uploads), Tools (planners), Guides (static reference),
 * Chat, and Profile (the player's own pages, and the lists kept in this browser). The phone menu shows the same items
 * as groups. Only existing pages are linked; hidden tools are left out.
 */
export function navItems({ guilds = false, players = false, savedBuilds = false, reviewedGuides = false }: NavSwitches = {}): NavItem[] {
  const groups = toolGroups(guilds);
  const catalogue = (title: ToolGroup) => groups.find((g) => g.title === title)?.links ?? [];
  return [
    ...(players ? [{ label: "Players", href: "/players" }] : []),
    ...(guilds ? [{ label: "Guilds", href: "/guilds" }] : []),
    { label: "Rankings", href: "/rankings" },
    { label: "Lookup", links: catalogue("Lookup").filter((link) => !COMMUNITY_HREFS.includes(link.href)) },
    {
      label: "Database",
      links: [
        { label: "Overview", href: "/database" },
        { label: "Items", href: "/database/items" },
        { label: "NPCs", href: "/database/npcs" },
        { label: "Quests", href: "/database/quests" },
        { label: "Zones", href: "/database/zones" },
        { label: "Spells", href: "/database/spells" },
        { label: "World map", href: "/map" },
      ],
    },
    { label: "Tools", links: [...catalogue("Tools"), { label: "All tools", href: "/tools" }] },
    // Guides lists the guides that exist today. The class guides list joins once a guide is reviewed (lib/guides.ts
    // publishedGuides), so the menu never opens on an empty list.
    {
      label: "Guides",
      links: [
        ...(reviewedGuides ? [{ label: "All guides", href: "/guides" }] : []),
        { label: "Dungeons and raids", href: "/database/instances" },
        { label: "Herbalism gathering", href: "/tools/professions/herbalism/gathering" },
        { label: "Addon directory guide", href: "/docs/guides/addon-directory" },
        { label: "Write a wiki page", href: "/docs/guides/wiki" },
        ...catalogue("Guides"),
        { label: "Lore archive", href: "/lore" },
        { label: "Changes", href: "/changes" },
      ],
    },
    { label: "Chat", href: "/chat" },
    {
      label: "Profile",
      links: [
        // One Settings page holds the account, profile, integrations and keys (#1278); /account sends there.
        { label: "Settings", href: "/settings" },
        ...(savedBuilds ? [{ label: "My builds", href: "/me" }] : []),
        ...catalogue("Profile"),
      ],
    },
  ];
}

const isCurrent = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** Where the page sits in the bar: the longest matching link and its item, so /tools/gold-ledger is Profile's Gold
 *  ledger, not the Tools menu's "All tools". Every switch counts as on, so a page behind one still marks its item. */
function currentPlace(path: string): { label: string; href: string } | undefined {
  let best: { label: string; href: string } | undefined;
  for (const item of navItems({ guilds: true, players: true, profiles: true, savedBuilds: true, reviewedGuides: true })) {
    for (const href of item.links ? item.links.map((l) => l.href) : [item.href]) {
      if (isCurrent(path, href) && (!best || href.length > best.href.length)) best = { label: item.label, href };
    }
  }
  return best;
}

/** The top bar item that holds the page. */
export const currentItem = (path: string): string | undefined => currentPlace(path)?.label;

const menuId = (label: string) => `${label.toLowerCase()}-menu`;

// The ring sits inside the box: these items start at the top edge of the window, where a ring offset outward is cut off.
const navItem = "inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-2 transition-colors focus-visible:outline-offset-[-2px]";
const navState = (on: boolean) => (on ? "border-accent text-fg" : "border-transparent text-fg-2 hover:text-accent");
const menuLink = "flex min-h-11 items-center rounded-control px-3 text-sm text-fg-2 hover:bg-canvas hover:text-accent";

/** Below md, how many links a phone menu group shows before its More…. */
const PHONE_LINKS = 3;

/** The phone menu: the community links as Community, each top bar menu as a group, then More with the other single
 *  links (Chat), Docs and About. */
export function phoneGroups(items: NavItem[]): { label: string; links: NavLink[] }[] {
  const singles = items.flatMap((item) => (item.links ? [] : [{ label: item.label, href: item.href }]));
  const community = singles.filter((link) => COMMUNITY_HREFS.includes(link.href));
  return [
    { label: "Community", links: community },
    ...items.flatMap((item) => (item.links ? [{ label: item.label, links: item.links }] : [])),
    { label: "More", links: [...singles.filter((link) => !community.includes(link)), { label: "Docs", href: "/docs" }, { label: "About", href: "/about" }] },
  ];
}

function SearchIcon() {
  return (
    <Icon name="search" />
  );
}

/**
 * The compact bar (docs/design/specs/2026-10-20-account-shell-design.md). From the layout: `savedBuilds` adds Your
 * builds to the avatar menu (EVERLOOT_SAVED_BUILDS); `accountSwitching` is true with Better Auth (EVERLOOT_AUTH_V2),
 * which can hold several accounts on one browser; `profiles` is EVERLOOT_PROFILES, without which the avatar menu
 * never asks for the player's shell. With it, the menu fetches the player from /api/me/shell itself. Profile always lists
 * Settings. `guilds` is EVERLOOT_GUILDS or the armory: the bar then links Guilds and Lookup drops the guild board.
 * `players` is EVERLOOT_PLAYER_PAGES or the armory: the bar then starts with Players, the one character search.
 * `reviewedGuides` is true once kb/guides holds a reviewed guide: Guides then starts with the guides list.
 */
export default function Header({ savedBuilds = false, profiles = false, accountSwitching = false, guilds = false, players = false, reviewedGuides = false }: {
  savedBuilds?: boolean;
  profiles?: boolean;
  accountSwitching?: boolean;
  guilds?: boolean;
  players?: boolean;
  reviewedGuides?: boolean;
}) {
  const items = navItems({ guilds, players, profiles, savedBuilds, reviewedGuides });
  const path = usePathname() ?? "/";
  const place = currentPlace(path);
  const current = place?.label;
  const [open, setOpen] = useState(false);
  // The phone menu groups opened past their first links with More….
  const [moreOpen, setMoreOpen] = useState<string[]>([]);
  // The top bar menu that is open, by its label; one at a time.
  const [menu, setMenu] = useState<string | null>(null);
  // Below 1280 px the bar has no room for the field: the search icon opens it full width under the bar.
  const [searchOpen, setSearchOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchRow = useRef<HTMLInputElement>(null);

  useEffect(() => { if (searchOpen) searchRow.current?.focus(); }, [searchOpen]);
  // A new page closes the opened field and the menu: a suggestion picked in either is a client-side link, and the
  // menu would otherwise stay over the page it opened.
  useEffect(() => { setSearchOpen(false); setOpen(false); }, [path]);

  // A click outside the bar's menus closes the open one.
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!bar.current?.contains(event.target as Node)) setMenu(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

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

  const closeAll = () => { setOpen(false); setMenu(null); };

  // The menu ArrowDown opened from its closed trigger: its first link takes focus once the panel is shown.
  const focusFirst = useRef<string | null>(null);
  useEffect(() => {
    if (!menu || focusFirst.current !== menu) return;
    focusFirst.current = null;
    document.querySelector<HTMLAnchorElement>(`#${menuId(menu)} a[href]`)?.focus();
  }, [menu]);

  // The disclosure pattern inside one top bar menu: ArrowDown/ArrowUp walk its links and wrap, Home/End jump to the
  // ends, ArrowDown on the closed trigger opens it onto the first link, and Tab out of the panel closes it (Escape is
  // handled on the header, which returns focus to the trigger).
  const menuKeys = (event: React.KeyboardEvent<HTMLDivElement>, label: string) => {
    const expanded = menu === label;
    const trigger = event.currentTarget.querySelector<HTMLButtonElement>("button");
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const active = document.activeElement;
    const at = links.findIndex((link) => link === active);
    const go = (i: number) => { event.preventDefault(); links[(i + links.length) % links.length]?.focus(); };
    switch (event.key) {
      case "ArrowDown":
        if (expanded) return go(at + 1);
        event.preventDefault();
        focusFirst.current = label;
        setMenu(label);
        return;
      case "ArrowUp": if (expanded) go(at - 1); return;
      case "Home": if (expanded) go(0); return;
      case "End": if (expanded) go(-1); return;
      case "Tab":
        if (expanded && (event.shiftKey ? active === trigger : at === links.length - 1)) setMenu(null);
        return;
    }
  };

  // ArrowRight/ArrowLeft on a top bar item move to the next or previous one, wrapping, and close any open menu.
  const barKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const nav = event.currentTarget;
    const tops = Array.from(nav.querySelectorAll<HTMLElement>("a, button")).filter((el) => el.parentElement === nav || el.parentElement?.parentElement === nav);
    const at = tops.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    setMenu(null);
    tops[(at + (event.key === "ArrowRight" ? 1 : -1) + tops.length) % tops.length]?.focus();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas" onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      if (menu) { document.getElementById(`${menuId(menu)}-button`)?.focus(); setMenu(null); }
      if (open) { setOpen(false); toggle.current?.focus(); }
      if (searchOpen) { setSearchOpen(false); searchButton.current?.focus(); }
    }}>
      {/* The data column's width and gutters (globals.css), so the logo lines up with the data tables. */}
      <div className="mx-auto flex h-header max-w-data items-center gap-1 px-2 sm:gap-3 sm:px-4 lg:gap-4 lg:px-6">
        <Link href="/" className="inline-flex min-h-11 shrink-0 items-center gap-2 text-lg font-bold tracking-tight text-fg focus-visible:outline-offset-[-2px]" onClick={closeAll}>
          {/* The favicon's diamond, outlined in the accent green. */}
          <Icon name="diamond" className="text-accent" />
          everloot
        </Link>

        {/* With Players, Guilds and Rankings the items need ~1120 px; below 1280 px the Menu button carries them. */}
        <nav ref={bar} aria-label="Primary" onKeyDown={barKeys} className="hidden shrink-0 items-center text-sm font-medium xl:flex">
          {items.map((item) => {
            const on = current === item.label;
            if (!item.links) return <Link key={item.label} href={item.href} aria-current={isCurrent(path, item.href) ? "page" : undefined} className={`${navItem} ${navState(on)}`}>{item.label}</Link>;
            const id = menuId(item.label);
            const expanded = menu === item.label;
            return (
              <div key={item.label} className="relative" onKeyDown={(event) => menuKeys(event, item.label)}>
                <button
                  id={`${id}-button`}
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={id}
                  aria-haspopup="true"
                  onClick={() => setMenu(expanded ? null : item.label)}
                  className={`${navItem} gap-1.5 ${navState(on || expanded)}`}
                >
                  {item.label}
                  <Icon name="chevron" className={expanded ? "rotate-180" : undefined} />
                </button>
                {/* Always in the page, so the links are in the HTML for crawlers; hidden until opened. */}
                <div id={id} hidden={!expanded} className={`pop absolute left-0 top-full mt-2 w-60 rounded-card border border-edge bg-panel p-2 ${expanded ? "block" : "hidden"}`}>
                  <ul>
                    {item.links.map((link) => (
                      <li key={link.href}>
                        <Link href={link.href} onClick={closeAll} aria-current={place?.href === link.href ? "page" : undefined} className={menuLink}>{link.label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </nav>

        {/* The site's one search, in the middle of the bar: items, NPCs, quests, zones, lore and tools, with instant
            suggestions for database pages. A GET form, so it works without JavaScript. */}
        <div className="hidden min-w-0 flex-1 justify-center xl:flex">
          <form action="/search" method="get" role="search" onSubmit={() => track("search", { surface: "header" })} className="flex h-8 w-full min-w-0 max-w-[360px] items-center gap-2 rounded-full border border-edge bg-panel px-3 text-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            <SearchIcon />
            <SuggestField
              id="site-search"
              inputRef={search}
              label="Search Everloot"
              placeholder="Search Everloot"
              listClassName="-left-9 -right-3 mt-2"
              className="h-7 w-full min-w-0 bg-transparent text-sm text-fg placeholder:text-muted focus:outline-none"
            />
            <kbd aria-hidden="true" className="rounded-control border border-line px-1.5 font-mono text-xs text-muted">/</kbd>
          </form>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0 sm:gap-2">
          <button
            ref={searchButton}
            type="button"
            aria-label="Search"
            aria-expanded={searchOpen}
            aria-controls="header-search"
            onClick={() => setSearchOpen(!searchOpen)}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-fg-2 hover:text-accent focus-visible:outline-offset-[-2px] xl:hidden"
          ><SearchIcon /></button>
          {/* Below 1536 px the right group has no room for both builds beside the community links; the menu panel shows them. */}
          <GameVersionLabel className="hidden shrink-0 2xl:block" />
          <AccountControls savedBuilds={savedBuilds} profiles={profiles} accountSwitching={accountSwitching} />
          <button ref={toggle} type="button" aria-label={open ? "Close menu" : "Menu"} aria-expanded={open} aria-controls="site-navigation" onClick={() => setOpen(!open)} className="btn min-h-8 shrink-0 px-3 text-sm 2xl:hidden">
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      <div id="header-search" hidden={!searchOpen} className="border-t border-line bg-canvas xl:hidden">
        <form action="/search" method="get" role="search" onSubmit={() => track("search", { surface: "header-phone" })} className="mx-auto flex max-w-wide items-center gap-2 px-4 py-2">
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
        // Fixed from under the bar to the bottom of the window, so the open menu covers the page instead of showing it beneath.
        <nav id="site-navigation" aria-label="Site menu" className="pop fixed inset-x-0 bottom-0 top-header overflow-y-auto overscroll-contain bg-panel 2xl:hidden">
          <div className="mx-auto max-w-data space-y-6 px-4 py-6 lg:px-6">
            <form action="/search" method="get" role="search" onSubmit={() => track("search", { surface: "menu" })} className="flex items-center gap-2 rounded-full border border-edge bg-canvas px-3 text-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
              <SearchIcon />
              {/* The bar's suggesting field, so the menu's search finds the same pages as you type. */}
              <SuggestField
                id="menu-search"
                label="Search Everloot"
                placeholder="Search Everloot"
                listClassName="-left-9 -right-3 mt-2"
                className="h-9 w-full min-w-0 bg-transparent text-base text-fg placeholder:text-muted focus:outline-none"
              />
            </form>
            {/* Community holds the bar's direct links, then the top bar's menus as groups, in the same order; More holds Chat, the pages outside the bar, and the bug
                report, whose floating pill is hidden below md. Focus moves to Menu first, so closing the dialog returns there. */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-6">
              {phoneGroups(items).map((group) => {
                // Below md a group shows its first PHONE_LINKS links; More… opens the rest, which stay in the HTML. The
                // group holding the page opens by itself.
                const rest = group.links.slice(PHONE_LINKS);
                const expanded = moreOpen.includes(group.label) || rest.some((link) => link.href === place?.href);
                return (
                <div key={group.label}>
                  <p className="mb-1 px-3 font-mono text-xs text-muted">{group.label}</p>
                  <ul id={`${menuId(group.label)}-phone`}>
                    {group.links.map((link, i) => (
                      <li key={link.href} className={i < PHONE_LINKS || expanded ? undefined : "hidden md:block"}><Link href={link.href} onClick={closeAll} aria-current={place?.href === link.href ? "page" : undefined} className={menuLink}>{link.label}</Link></li>
                    ))}
                    {rest.length > 0 && !expanded && (
                      <li className="md:hidden">
                        <button type="button" aria-expanded={false} aria-controls={`${menuId(group.label)}-phone`} className={`${menuLink} w-full text-left`} onClick={() => setMoreOpen([...moreOpen, group.label])}>More…</button>
                      </li>
                    )}
                    {group.label === "More" && (
                      <li>
                        <button type="button" aria-haspopup="dialog" className={`${menuLink} w-full text-left`} onClick={() => {
                          closeAll();
                          toggle.current?.focus();
                          window.dispatchEvent(new Event(REPORT_BUG_EVENT));
                        }}>Report a bug</button>
                      </li>
                    )}
                  </ul>
                </div>
                );
              })}
            </div>
            <GameVersionLabel className="px-3" />
            <AccountControls place="menu" />
          </div>
        </nav>
      )}
    </header>
  );
}
