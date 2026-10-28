"use client";

import { useEffect, useRef, useState } from "react";
import { GAME_VERSIONS, CURRENT_VERSION, versionLabel } from "@/lib/game-version";

/** The version label next to the search ("Build 1.60.1"): a button that opens the list of versions. Only the current one can be chosen. */
export default function GameVersionLabel({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div
      ref={box}
      className={`relative ${className}`}
      onKeyDown={(event) => { if (event.key === "Escape" && open) { setOpen(false); button.current?.focus(); } }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="game-version-menu"
        aria-label={`Game version: ${versionLabel()}`}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-10 items-center whitespace-nowrap rounded-control border border-edge px-2.5 font-mono text-xs text-fg-2 hover:text-fg"
      >{versionLabel()}</button>
      <div id="game-version-menu" hidden={!open} className="absolute right-0 top-full z-50 mt-2 w-64 rounded-control border border-edge bg-panel p-2">
        <p className="px-2 pb-1 font-mono text-xs text-muted">Game version</p>
        <ul>
          {GAME_VERSIONS.map((v) => {
            const current = v.id === CURRENT_VERSION.id;
            return (
              <li
                key={v.id}
                aria-disabled={v.available ? undefined : true}
                aria-current={current ? "true" : undefined}
                className={`flex min-h-11 items-center justify-between gap-3 rounded-control px-2 text-sm ${v.available ? "text-fg" : "text-muted"}`}
              >
                <span>{v.label}</span>
                <span className="text-xs text-muted">{v.build ? (current ? `Current, ${v.build}` : v.build) : v.note}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
