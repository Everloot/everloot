"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { TAB_SCROLL, TabCount, tabClass } from "./tab-style";

export interface TabItem {
  /** Also the URL hash that opens this tab: `#dropped-by`. Lowercase letters, digits and dashes. */
  id: string;
  label: ReactNode;
  /** Rows behind the tab. Zero is drawn quieter, not hidden. */
  count?: number;
  panel: ReactNode;
}

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

/** The tab that opens first: the first one with rows (or no count), else the first one. */
export function firstFilled(tabs: Pick<TabItem, "id" | "count">[]): string | undefined {
  return (tabs.find((t) => t.count !== 0) ?? tabs[0])?.id;
}

/**
 * Tabs whose state is in the URL hash, so `/database/items/7960#sold-by` opens on that tab and the
 * address can be shared. Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern, automatic
 * activation). The first tab with rows is open on the server and without JavaScript.
 */
export default function Tabs({ label, tabs, inFrame = false, className = "" }: { label: string; tabs: TabItem[]; inFrame?: boolean; className?: string }) {
  const uid = useId();
  const ids = tabs.map((t) => t.id);
  const [selected, setSelected] = useState(() => firstFilled(tabs) ?? ids[0]);
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

  // On a narrow screen the open tab can sit past the edge of the scrolling row: bring it into view, sideways only.
  useEffect(() => {
    const tab = refs.current[selected];
    const list = tab?.parentElement;
    if (!tab || !list || list.scrollWidth <= list.clientWidth) return;
    const t = tab.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    if (t.left < l.left || t.right > l.right) list.scrollLeft += t.left - l.left;
  }, [selected]);

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

  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = (id: string) => `${uid}-panel-${id}`;

  return (
    <div data-tabs className={`${inFrame ? "" : "min-w-0"} ${className}`.trim() || undefined}>
      {/* The hairline sits outside the scrolling list, so a narrow screen scrolls the tabs and not the page. */}
      <div className="border-b border-line">
      <div role="tablist" aria-label={label} className={`flex ${TAB_SCROLL} ${inFrame ? "px-2" : ""}`}>
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
      </div>
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} id={panelId(tab.id)} role="tabpanel" aria-labelledby={tabId(tab.id)} tabIndex={0} hidden={tab.id !== selected} data-tab-panel={tab.id} className={inFrame ? undefined : "pt-2"}>
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
