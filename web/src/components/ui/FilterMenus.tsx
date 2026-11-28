"use client";

import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";

/**
 * The root of a FilterBar. The dropdowns are native <details>, which open and close without JavaScript; this adds
 * what a <details> lacks and the header menus have: Escape closes the dropdown you are in and returns focus to its
 * button, a press outside closes the open ones, and focus leaving a dropdown (Tab past its last choice) closes it,
 * so an open list never covers what focus moved to. The phone's outer "Filters" sheet is not a dropdown
 * (no `data-filter`), so neither touches it.
 */
export default function FilterMenus({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      for (const menu of bar.current?.querySelectorAll<HTMLDetailsElement>("details[data-filter][open]") ?? [])
        if (!menu.contains(event.target as Node)) menu.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  // relatedTarget is null when the window itself loses focus: the dropdown stays as it was.
  const onBlur = (event: FocusEvent) => {
    const menu = (event.target as Element).closest<HTMLDetailsElement>("details[data-filter]");
    const next = event.relatedTarget;
    if (menu?.open && next instanceof Node && !menu.contains(next)) menu.open = false;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const menu = (event.target as Element).closest<HTMLDetailsElement>("details[data-filter]");
    if (!menu?.open) return;
    event.stopPropagation();
    menu.open = false;
    menu.querySelector("summary")?.focus();
  };
  return (
    <div ref={bar} role="group" aria-label={label} data-filter-bar className={className} onKeyDown={onKeyDown} onBlur={onBlur}>
      {children}
    </div>
  );
}
