"use client";

import { useEffect, useState } from "react";
import type { SiteCard } from "@/lib/site-card";
import { CardPopup, GameCard } from "./GameCard";

// The in-game card on every link to an item, NPC, quest or object page, mounted once in the root layout. It
// listens on the document, so a list, a search result, the type-ahead or a link inside a page needs nothing of
// its own: any <a href="/database/items/123"> gets the card. A pointer resting on the link for 150 ms or keyboard
// focus opens it; leaving, blurring or Escape closes it. Touch gets none: a tap goes to the page. The card is the
// link's description while open. Links that already carry their own card (ItemTip, SpellTip) are left alone.

const PATH = /^\/database\/(items|npcs|quests|objects)\/([1-9]\d{0,9})\/?$/;
const TYPE = { items: "item", npcs: "npc", quests: "quest", objects: "object" } as const;
/** How long the pointer rests on a link before its card is asked for, so a pointer crossing a list asks nothing. */
export const SHOW_DELAY = 150;
export const CARD_ID = "hover-card";
/** Links inside these keep their own card, or are the card. */
const OWN_CARD = "[data-item-tip], [data-spell-tip], [data-hover-card], [data-no-hover-card]";

/** The card a link points at ("item/123"), or null: same-site links to one of the four page types, not this page. */
export function cardKey(link: HTMLAnchorElement): string | null {
  let url: URL;
  try { url = new URL(link.href, window.location.href); } catch { return null; }
  if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return null;
  const m = PATH.exec(url.pathname);
  return m ? `${TYPE[m[1] as keyof typeof TYPE]}/${m[2]}` : null;
}

// A card per page for the visit; null is a 404 (unreported or unreleased: never a card). A failure is not kept.
const cards = new Map<string, SiteCard | null>();
/** For tests. */
export const forgetCards = () => cards.clear();

async function cardFor(key: string, signal: AbortSignal): Promise<SiteCard | null> {
  if (cards.has(key)) return cards.get(key)!;
  const res = await fetch(`/database/card/${key}`, { signal });
  if (res.status === 404) { cards.set(key, null); return null; }
  if (!res.ok) return null;
  const body = (await res.json()) as { card?: SiteCard };
  const card = body.card ?? null;
  cards.set(key, card);
  return card;
}

const linkIn = (target: EventTarget | null): HTMLAnchorElement | null => {
  const el = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
  return el && !el.closest(OWN_CARD) ? el : null;
};

export default function HoverCards() {
  const [open, setOpen] = useState<{ anchor: HTMLAnchorElement; x: number | null; card: SiteCard } | null>(null);

  useEffect(() => {
    let current: { anchor: HTMLAnchorElement; timer: ReturnType<typeof setTimeout>; ctrl: AbortController; described: string | null; keyboard: boolean } | null = null;
    let touchedAt = -Infinity;

    const close = () => {
      if (!current) return;
      clearTimeout(current.timer);
      current.ctrl.abort();
      const { anchor, described } = current;
      if (described === null) anchor.removeAttribute("aria-describedby");
      else anchor.setAttribute("aria-describedby", described);
      current = null;
      setOpen(null);
    };

    const start = (anchor: HTMLAnchorElement, x: number | null) => {
      if (current?.anchor === anchor) return;
      close();
      const key = cardKey(anchor);
      if (!key) return;
      const ctrl = new AbortController();
      const described = anchor.getAttribute("aria-describedby");
      const timer = setTimeout(async () => {
        const card = await cardFor(key, ctrl.signal).catch(() => null);
        if (!card || ctrl.signal.aborted || !anchor.isConnected) return;
        anchor.setAttribute("aria-describedby", described ? `${described} ${CARD_ID}` : CARD_ID);
        setOpen({ anchor, x, card });
      }, SHOW_DELAY);
      current = { anchor, timer, ctrl, described, keyboard: x === null };
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const link = linkIn(e.target);
      if (link) start(link, e.clientX);
    };
    const onOut = (e: PointerEvent) => {
      if (current && !(e.relatedTarget instanceof Node && current.anchor.contains(e.relatedTarget))) close();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") touchedAt = Date.now();
      close();
    };
    const onFocus = (e: FocusEvent) => {
      // A tap focuses the link on some phones: that is not keyboard focus.
      if (Date.now() - touchedAt < 1000) return;
      const link = linkIn(e.target);
      if (link) start(link, null);
    };
    const onBlur = (e: FocusEvent) => { if (current && e.target === current.anchor) close(); };
    // Escape closes the card wherever focus is; Enter follows the link, so the card goes with the page.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") close(); };

    // Scrolling closes a card opened by the pointer, which is no longer over its link. Focus scrolls the link into
    // view, so a scroll then is how the card was reached: it stays and follows the link.
    const onScroll = () => {
      if (current?.keyboard) setOpen((o) => (o ? { ...o } : o));
      else close();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("popstate", close);
    return () => {
      close();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("popstate", close);
    };
  }, []);

  if (!open) return null;
  return (
    <CardPopup anchor={open.anchor} x={open.x} id={CARD_ID}>
      <GameCard card={open.card} />
    </CardPopup>
  );
}
