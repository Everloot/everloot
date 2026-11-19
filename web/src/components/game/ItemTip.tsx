"use client";

import { cloneElement, isValidElement, useEffect, useId, useState, type ReactElement, type ReactNode } from "react";
import type { ItemTip as Tip } from "@/lib/game-assets";
import { CardPopup, GameCard } from "./GameCard";
import { splitWhy } from "@/lib/placeholder";
import { QUALITIES } from "@/design/tokens";
import GameIcon from "./GameIcon";

// An item link with the item's icon in front and the game's tooltip on hover and keyboard focus
// (Escape closes it), in the same card as every other database link (HoverCards), from the tooltip the
// page already has. The link keeps its own text. The tooltip text is also the link's description, so a
// screen reader gets it without hovering. Touch gets no card: a tap goes to the page.
// Without a tip (no asset URL, or no record for the item) the link is returned exactly as it was.

// `icon` replaces the icon drawn in front (a caller that draws its own frame or fallback); the card keeps the tip's icon.
export default function ItemTip({ tip, size = 20, icon, children }: { tip: Tip | null | undefined; size?: number; icon?: ReactNode; children: ReactElement }) {
  return tip ? <Tipped tip={tip} size={size} icon={icon}>{children}</Tipped> : children;
}

function Tipped({ tip, size, icon, children }: { tip: Tip; size: number; icon?: ReactNode; children: ReactElement }) {
  const id = useId();
  const anchorId = `item${id}`;
  const descId = `${anchorId}-desc`;
  const [open, setOpen] = useState<{ anchor: HTMLElement; x: number | null } | null>(null);
  // Escape closes it however it opened: a tooltip opened by hovering has no focus inside it to catch the key.
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  const link = isValidElement<{ "aria-describedby"?: string }>(children) ? cloneElement(children, { "aria-describedby": descId }) : children;
  const { reasons, evidence } = splitWhy(tip.why);
  const lines = [...tip.lines, ...evidence];
  return (
    <span
      id={anchorId}
      className="inline-flex items-center gap-1.5 align-middle"
      data-item-tip
      onPointerEnter={(e) => { if (e.pointerType !== "touch") setOpen({ anchor: e.currentTarget, x: e.clientX }); }}
      onPointerLeave={() => setOpen(null)}
      onFocus={(e) => setOpen({ anchor: e.currentTarget, x: null })}
      onBlur={() => setOpen(null)}
    >
      {icon !== undefined ? icon : tip.icon && <GameIcon src={tip.icon} size={size} quality={QUALITIES.find((q) => q === tip.quality.toLowerCase())} />}
      {link}
      <span id={descId} hidden>{[`${tip.name}, ${tip.quality}`, ...tip.lines, tip.label].join(". ")}</span>
      {open && (
        <CardPopup anchor={open.anchor} x={open.x} id={`${anchorId}-tip`}>
          <GameCard card={{ title: tip.name, color: tip.color, icon: tip.icon, lines, notes: reasons, foot: tip.label }} />
        </CardPopup>
      )}
    </span>
  );
}
