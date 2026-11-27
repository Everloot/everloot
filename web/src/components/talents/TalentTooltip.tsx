"use client";

import { useLayoutEffect, useRef, useState } from "react";

// The tooltip of a talent, in the look of the game's own: dark panel, gold name. It is placed from the
// node's on-screen box and kept inside the window, so it also works at 390 px wide. Shown on hover,
// keyboard focus and long press; Escape closes it (WCAG 1.4.13). The same text sits visually hidden
// beside every node, so a screen reader reads it without needing the tooltip.

export interface TipContent {
  title: string;
  rank: string | null;
  text: string | null;
  partial: boolean;
  /** A note under the text, such as an amount the text leaves out (the armory's trees); absent: none. */
  note?: string | null;
  /** What the next point gives, for a talent between its first and last rank; absent: no line. */
  next?: string | null;
  /** Why a point cannot be added now, from the point rules; null when it can. */
  lock: string | null;
  label: string;
}

const WIDTH = 288; // px; the game's tooltip is about this wide
const MARGIN = 8;

/** `titleColor`: the name's colour; gold for talents, the quality colour for items (components/game/ItemTip.tsx). */
export default function TalentTooltip({ anchorId, id, content, titleColor = "#ffd100" }: { anchorId: string; id: string; content: TipContent; titleColor?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = document.getElementById(anchorId);
    const tip = ref.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const h = tip.getBoundingClientRect().height;
    const w = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(a.left + a.width / 2 - w / 2, window.innerWidth - w - MARGIN));
    // Below the node unless it does not fit, then above; never off the top of the window.
    const below = a.bottom + 6;
    const top = below + h <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, a.top - 6 - h);
    setPos({ left, top });
  }, [anchorId, content]);

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      data-talent-tooltip
      className="pointer-events-none fixed z-50 rounded-md border border-[#3d3a2e] bg-[#0a0a0f]/95 px-3 py-2 text-sm leading-snug text-[#e8e4d0]"
      style={{ width: Math.min(WIDTH, typeof window === "undefined" ? WIDTH : window.innerWidth - 2 * MARGIN), left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      <p className="font-semibold" style={{ color: titleColor }}>{content.title}</p>
      {content.rank && <p className="font-mono text-xs tabular-nums text-[#c8c8c8]">{content.rank}</p>}
      {content.text ? (
        <p className="mt-1 whitespace-pre-line text-[#f0e6b4]">{content.text}</p>
      ) : (
        <p className="mt-1 text-[#9a9a9a]">No description in the game files.</p>
      )}
      {content.next && <p className="mt-1 whitespace-pre-line text-[#f0e6b4]"><span className="text-[#c8c8c8]">Next rank: </span>{content.next}</p>}
      {content.partial && <p className="mt-1 text-xs text-[#9a9a9a]">[?] marks a value the game files do not give us yet.</p>}
      {content.note && <p className="mt-1 text-xs text-[#9a9a9a]">{content.note}</p>}
      {content.lock && <p className="mt-1 text-[#ff6b5a]">{content.lock}</p>}
      <p className="mt-2 font-mono text-[10px] text-[#8a8a8a]">{content.label}</p>
    </div>
  );
}
