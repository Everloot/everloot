"use client";

import { createContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import ScrollRow from "./ScrollRow";
import { TAB_SCROLL, TabCount, filledTabs, tabClass } from "./tab-style";

export interface TabItem {
  /** Also the URL hash that opens this tab: `#dropped-by`. Lowercase letters, digits and dashes. */
  id: string;
  label: ReactNode;
  /** Rows behind the tab. A tab with none (0) is left out while another tab has rows; no count is never empty. */
  count?: number;
  panel: ReactNode;
}

/** The id of the tab open in the nearest Tabs, so a panel can wait to load its content until it is opened. */
export const OpenTab = createContext<string | null>(null);

/** The tab a hash names, or null when it names none of them. */
export function tabFromHash(hash: string, ids: string[]): string | null {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  return ids.includes(id) ? id : null;
}

/**
 * Tabs whose state is in the URL hash, so `/database/items/7960#sold-by` opens on that tab and the
 * address can be shared. Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern, automatic
 * activation). Only the tabs with rows are drawn, so the strip starts with one and it is open on the server and
 * without JavaScript. When no tab has rows there is no strip: `empty`, or else the first tab's panel (its one line).
 * `wrap`: a long strip wraps onto a second line on a narrow screen instead of scrolling, so no tab hides past the edge.
 */
export default function Tabs({ label, tabs: all, empty, inFrame = false, wrap = false, className = "" }: { label: string; tabs: TabItem[]; empty?: ReactNode; inFrame?: boolean; wrap?: boolean; className?: string }) {
  const uid = useId();
  const tabs = filledTabs(all);
  const ids = tabs.map((t) => t.id);
  const [selected, setSelected] = useState(() => ids[0]);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const idsKey = ids.join(" ");

  useEffect(() => {
    const sync = () => {
      const fromHash = tabFromHash(window.location.hash, idsKey.split(" "));
      if (fromHash) setSelected(fromHash);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [idsKey]);

  function choose(id: string, focus = false) {
    setSelected(id);
    // replaceState, not location.hash: no jump to an element and no history entry per click.
    window.history.replaceState(window.history.state, "", `#${id}`);
    if (focus) refs.current[id]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const at = ids.indexOf(selected);
    const to = event.key === "ArrowRight" ? (at + 1) % ids.length
      : event.key === "ArrowLeft" ? (at - 1 + ids.length) % ids.length
      : event.key === "Home" ? 0
      : event.key === "End" ? ids.length - 1
      : -1;
    if (to < 0) return;
    event.preventDefault();
    choose(ids[to], true);
  }

  if (!tabs.length) {
    return all.length ? <div data-tabs-empty className={`${inFrame ? "" : "min-w-0"} ${className}`.trim() || undefined}>{empty ?? all[0].panel}</div> : null;
  }

  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = (id: string) => `${uid}-panel-${id}`;

  return (
    <OpenTab.Provider value={selected}>
    <div data-tabs className={`${inFrame ? "" : "min-w-0"} ${className}`.trim() || undefined}>
      {/* The hairline sits outside the scrolling list, so a narrow screen scrolls the tabs and not the page. */}
      <div className="border-b border-line">
      {/* On a narrow screen the open tab is kept in view and an arrow marks a cut edge (ScrollRow). */}
      <ScrollRow role="tablist" aria-label={label} watch={selected} surface={inFrame ? "bg-panel" : "bg-canvas"} className={`flex ${wrap ? "flex-wrap" : TAB_SCROLL} ${inFrame ? "px-2" : ""}`}>
        {tabs.map((tab) => {
          const on = tab.id === selected;
          return (
            <button
              key={tab.id}
              ref={(el) => { refs.current[tab.id] = el; }}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={panelId(tab.id)}
              tabIndex={on ? 0 : -1}
              onClick={() => choose(tab.id)}
              onKeyDown={onKeyDown}
              className={tabClass(on, tab.count === 0)}
            >
              {tab.label}
              {tab.count !== undefined && <TabCount count={tab.count} />}
            </button>
          );
        })}
      </ScrollRow>
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} id={panelId(tab.id)} role="tabpanel" aria-labelledby={tabId(tab.id)} tabIndex={0} hidden={tab.id !== selected} data-tab-panel={tab.id} className={inFrame ? undefined : "pt-2"}>
          {tab.panel}
        </div>
      ))}
    </div>
    </OpenTab.Provider>
  );
}
