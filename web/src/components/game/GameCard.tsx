"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DATA_SIZE, QUALITIES, tokens } from "@/design/tokens";
import TooltipFrame from "@/components/ui/TooltipFrame";
import TooltipLines from "@/components/ui/TooltipLines";
import { QUALITY_TEXT, qualityOf } from "@/components/ui/quality";
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
  /** The players' numbers in one line, each number's installs, date and build behind it (lib/item-tooltip.ts). */
  evidence?: { summary: string; lines: string[] };
  /** What the files lack for the item, in one muted line inside the box (lib/item-tooltip.ts). */
  missing?: string;
  /** A recipe's taught item, drawn inside the box before `lines[at]` (lib/item-tooltip.ts). */
  taught?: { id: number; title: string; quality: number | null; color: string | null; lines: string[]; at: number };
  foot: string | null;
}

const qualityFor = (q: number | null | undefined, color: string | null | undefined) =>
  typeof q === "number" && q >= 0 && q <= 5 ? qualityOf(q) : QUALITIES.find((x) => tokens.dark[`q-${x}`] === color);

/** The taught item under a recipe, as the game draws it: its name in its quality colour, then its lines. */
function Taught({ item, href }: { item: NonNullable<CardContent["taught"]>; href?: string }) {
  const quality = qualityFor(item.quality, item.color);
  const title = href ? <a href={href} className="hover:underline focus-visible:underline">{item.title}</a> : item.title;
  return (
    <div data-card-taught className="my-2">
      <p className={`text-[14px] font-semibold leading-[18px] [overflow-wrap:anywhere] ${quality ? QUALITY_TEXT[quality] : "text-fg"}`} style={!quality && item.color ? { color: item.color } : undefined}>{title}</p>
      {item.lines.length > 0 && <TooltipLines lines={item.lines} />}
    </div>
  );
}

const ICON = 48;
const GAP = 6;
const MARGIN = 8;

/**
 * The game's tooltip box: the icon beside the name inside it, the reasons for any `[?]` as a footnote under it. The
 * hover card and the item page's box both draw it (lib/item-tooltip.ts gives an item's content to both); the page
 * passes `links` and its region `label`.
 */
export function GameCard({ card, links, label }: { card: CardContent; links?: Readonly<Record<string, string>>; label?: string }) {
  const quality = qualityFor(card.quality, card.color);
  const notes = card.notes?.length && [...card.lines, ...(card.taught?.lines ?? [])].some((line) => line.includes(PLACEHOLDER)) ? card.notes : null;
  const at = card.taught ? Math.min(card.taught.at, card.lines.length) : card.lines.length;
  const before = card.lines.slice(0, at), after = card.lines.slice(at);
  return (
    <div>
      <TooltipFrame
        name={!quality && card.color ? <span style={{ color: card.color }}>{card.title}</span> : card.title}
        quality={quality}
        icon={card.icon ? <GameIcon src={card.icon} size={ICON} quality={quality} /> : undefined}
        foot={card.foot ?? undefined}
        label={label}
      >
        {before.length > 0 ? <TooltipLines lines={before} links={links} /> : null}
        {card.taught && <Taught item={card.taught} href={links?.[card.taught.title]} />}
        {after.length > 0 ? <TooltipLines lines={after} links={links} /> : null}
        {card.evidence && (
          // One line in the box; each number's own line on demand (a click on the page, the title on hover).
          <details data-card-evidence className="text-xs text-muted">
            <summary className="cursor-pointer" title={card.evidence.lines.join("\n")}>{card.evidence.summary}</summary>
            <ul className="mt-0.5 space-y-0.5">{card.evidence.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
          </details>
        )}
        {card.missing && <p data-card-missing className="text-xs text-muted">{card.missing}</p>}
      </TooltipFrame>
      {notes && <div data-card-notes className="mt-1 space-y-0.5 rounded-control border border-line bg-panel px-2 py-1 text-xs text-muted">{notes.map((note, i) => <p key={i}>{note}</p>)}</div>}
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
