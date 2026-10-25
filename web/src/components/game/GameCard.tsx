"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DATA_SIZE } from "@/design/tokens";
import TooltipFrame from "@/components/ui/TooltipFrame";
import { qualityOf } from "@/components/ui/quality";
import { PLACEHOLDER } from "@/lib/placeholder";
import GameIcon from "./GameIcon";

/** What a hover card shows: the page's own box, as lib/site-card.ts or an item's game file tooltip gives it. */
export interface CardContent {
  title: string;
  /** The game's quality number (0 poor to 5 legendary), coloured with the site's quality tokens. */
  quality?: number | null;
  /** A colour for the title where no quality number is known (an item tooltip's own). */
  color?: string | null;
  icon: string | null;
  lines: string[];
  /** Why the lines hold `[?]`, one sentence per kind; drawn under the card, and only while a line holds one. */
  notes?: string[];
  foot: string | null;
}

const ICON = 48;
const GAP = 6;
const MARGIN = 8;

/** The game's tooltip box: the icon beside the name inside it, the reasons for any `[?]` as a footnote under it. */
export function GameCard({ card }: { card: CardContent }) {
  const quality = typeof card.quality === "number" && card.quality >= 0 && card.quality <= 5 ? qualityOf(card.quality) : undefined;
  const notes = card.notes?.length && card.lines.some((line) => line.includes(PLACEHOLDER)) ? card.notes : null;
  return (
    <div>
      <TooltipFrame
        name={!quality && card.color ? <span style={{ color: card.color }}>{card.title}</span> : card.title}
        quality={quality}
        icon={card.icon ? <GameIcon src={card.icon} size={ICON} /> : undefined}
        foot={card.foot ?? undefined}
      >
        {card.lines.length > 0 ? card.lines.map((line, i) => <p key={i}>{line}</p>) : null}
      </TooltipFrame>
      {notes && <div data-card-notes className="mt-1 space-y-0.5 rounded-[4px] border border-line bg-panel px-2 py-1 text-xs text-muted">{notes.map((note, i) => <p key={i}>{note}</p>)}</div>}
    </div>
  );
}

/**
 * A card beside a link, in the body so no table cell or menu paints over it. Below the link from the pointer
 * (or from the link's left edge when it came by keyboard); above it when it does not fit below, and moved in
 * from the right edge. It takes no pointer events, so it never sits between the pointer and the next link.
 */
export function CardPopup({ anchor, x, id, children }: { anchor: HTMLElement; x: number | null; id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    const start = x === null ? a.left : x + 12;
    const left = start + width <= window.innerWidth - MARGIN ? start : Math.max(MARGIN, (x === null ? a.right : x - 12) - width);
    const below = a.bottom + GAP;
    const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, a.top - GAP - height);
    setPos({ left, top });
  }, [anchor, x, children]);

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      data-hover-card
      className="pointer-events-none fixed z-[60] w-max"
      style={{
        left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden",
        maxWidth: `min(${DATA_SIZE.tip}px, calc(100vw - ${2 * MARGIN}px))`,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
