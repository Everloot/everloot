"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";

/** The arrows' width (and the room the open tab keeps from the edge, so no arrow sits over it). */
const ARROW = 40;

/** Scroll the row sideways, as little as needed, so its open tab (or current link) sits clear of the arrows. */
export function reveal(row: HTMLElement) {
  const on = row.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="page"]');
  if (!on || row.scrollWidth <= row.clientWidth) return;
  const t = (on.closest("li") ?? on).getBoundingClientRect();
  const l = row.getBoundingClientRect();
  let to = row.scrollLeft;
  if (t.left < l.left + ARROW) to -= l.left + ARROW - t.left;
  else if (t.right > l.right - ARROW) to += t.right - (l.right - ARROW);
  row.scrollLeft = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, to));
}

/**
 * A tab row that scrolls sideways on a narrow screen (Tabs, LinkTabs). The open tab is kept in view on load, when it
 * changes (`watch`) and whenever the row lays out again (a font arriving, the phone turning). While there is more
 * past an edge, an arrow sits on that edge with a hairline and the page's own fill (no fade, per the design guard);
 * a tap scrolls one view. The arrows are a pointer aid, hidden from screen readers and the tab order: the tabs' own
 * keys and focus already scroll the row. Without JavaScript the row still scrolls by touch.
 */
export default function ScrollRow({ children, className, watch, surface = "bg-canvas", ...aria }: {
  children: ReactNode;
  className: string;
  watch?: string;
  /** The fill behind the arrows: the surface the row sits on. */
  surface?: "bg-canvas" | "bg-panel";
  role?: string;
  "aria-label"?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });

  const measure = () => {
    const el = row.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((was) => (was.start === start && was.end === end ? was : { start, end }));
  };

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const fit = () => { reveal(el); measure(); };
    fit();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", fit);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(el);
    for (const child of Array.from(el.children)) observer?.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", fit);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!row.current) return;
    reveal(row.current);
    measure();
  }, [watch]);

  const step = (way: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + way * (el.clientWidth - ARROW * 2)));
    measure();
  };

  const arrow = (side: "start" | "end") => (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      data-scroll={side}
      onClick={() => step(side === "start" ? -1 : 1)}
      className={`absolute inset-y-0 flex w-10 items-center justify-center text-fg-2 hover:text-fg ${surface} ${side === "start" ? "left-0 border-r border-line" : "right-0 border-l border-line"}`}
    >
      <Icon name="chevron" className={side === "start" ? "rotate-90" : "-rotate-90"} />
    </button>
  );

  return (
    <div className="relative min-w-0">
      <div ref={row} data-scroll-row className={className} {...aria}>
        {children}
      </div>
      {more.start && arrow("start")}
      {more.end && arrow("end")}
    </div>
  );
}
