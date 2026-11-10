"use client";

import { useEffect, useState } from "react";
import { QUALITIES } from "@/design/tokens";
import type { SiteCard } from "@/lib/site-card";
import { CardPopup, GameCard, type CardContent } from "./GameCard";

// The in-game card on every link to an item, NPC, quest or object page, mounted once in the root layout. It
// listens on the document, so a list, a search result, the type-ahead or a link inside a page needs nothing of
// its own: any <a href="/database/items/123"> gets the card. A pointer resting on the link for SHOW_DELAY or
// keyboard focus opens it: the card's frame at once with the name and quality colour the link already shows, filled
// in when the card arrives, and the whole card at once when it was asked for before. Leaving, blurring or Escape
// closes it. Touch gets none and asks for none: a tap goes to the page. The card is the link's description while
// open. It appears without motion, so there is nothing for reduced motion to turn off, and it sits in a fixed layer
// over the page, so it moves nothing on it. Links that already carry their own card (ItemTip, SpellTip) are left alone.

const PATH = /^\/database\/(items|npcs|quests|objects)\/([1-9]\d{0,9})\/?$/;
const TYPE = { items: "item", npcs: "npc", quests: "quest", objects: "object" } as const;
/**
 * How long the pointer rests on a link before its card is asked for and shown, so a pointer crossing a list asks
 * nothing. Short: the frame shows at once, and a card asked for before needs no request.
 */
export const SHOW_DELAY = 80;
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

/** A map that keeps at most `limit` entries: reading or writing one makes it the newest, and the oldest goes first. */
export class Lru<K, V> {
  private readonly entries = new Map<K, V>();
  constructor(readonly limit: number) {}
  get size() { return this.entries.size; }
  has(key: K) { return this.entries.has(key); }
  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }
  set(key: K, value: V) {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as K);
  }
  clear() { this.entries.clear(); }
}

/** How many cards a visit keeps: a few long lists' worth, a few hundred kilobytes at most. */
export const CARD_LIMIT = 300;
// The cards asked for this visit; null is a 404 (unreported or unreleased: never a card). A failure is not kept.
const cards = new Lru<string, SiteCard | null>(CARD_LIMIT);
// A card on its way: a second hover meanwhile waits for the same answer instead of asking again.
const asking = new Map<string, Promise<SiteCard | null>>();
/** For tests. */
export const forgetCards = () => { cards.clear(); asking.clear(); };

/**
 * The card, from this visit's cards or asked for once. A request is not cancelled when the pointer leaves: the
 * pointer rested on the link, so the answer is kept for the next hover.
 */
export function cardFor(key: string): Promise<SiteCard | null> {
  if (cards.has(key)) return Promise.resolve(cards.get(key) ?? null);
  let asked = asking.get(key);
  if (!asked) {
    asked = fetch(`/database/card/${key}`)
      .then(async (res) => {
        if (res.status === 404) { cards.set(key, null); return null; }
        if (!res.ok) return null;
        const card = ((await res.json()) as { card?: SiteCard }).card ?? null;
        cards.set(key, card);
        return card;
      })
      .catch(() => null)
      .finally(() => asking.delete(key));
    asking.set(key, asked);
  }
  return asked;
}

const QUALITY_CLASS = new RegExp(`(?:^|\\s)text-q-(${QUALITIES.join("|")})(?:\\s|$)`);

const textOf = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * The card's frame from what the link shows, for the moment before the card arrives: the name in its quality colour
 * (the coloured part of the link, so a search row's "Item 123" beside the name stays out), else the link's text.
 * Null for a link with no text to show.
 */
export function linkFrame(link: HTMLAnchorElement): CardContent | null {
  const coloured = [link, ...link.querySelectorAll("[class]")].find((el) => QUALITY_CLASS.test(el.getAttribute("class") ?? ""));
  const title = textOf(coloured ?? null) || textOf(link) || link.getAttribute("aria-label")?.trim();
  if (!title) return null;
  const quality = coloured ? QUALITIES.indexOf(QUALITY_CLASS.exec(coloured.getAttribute("class")!)![1] as (typeof QUALITIES)[number]) : null;
  return { title, quality, icon: null, lines: [], foot: null };
}

const linkIn = (target: EventTarget | null): HTMLAnchorElement | null => {
  const el = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
  return el && !el.closest(OWN_CARD) ? el : null;
};

export default function HoverCards() {
  const [open, setOpen] = useState<{ anchor: HTMLAnchorElement; x: number | null; card: CardContent } | null>(null);

  useEffect(() => {
    let current: { anchor: HTMLAnchorElement; timer?: ReturnType<typeof setTimeout>; described: string | null; keyboard: boolean } | null = null;
    let pressedAt = -Infinity;

    const close = () => {
      if (!current) return;
      clearTimeout(current.timer);
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
      const described = anchor.getAttribute("aria-describedby");
      const mine: NonNullable<typeof current> = { anchor, described, keyboard: x === null };
      const show = (card: CardContent) => {
        if (current !== mine || !anchor.isConnected) return;
        anchor.setAttribute("aria-describedby", described ? `${described} ${CARD_ID}` : CARD_ID);
        setOpen({ anchor, x, card });
      };
      mine.timer = setTimeout(() => {
        // A card this visit already has shows whole, and a 404 shows nothing; otherwise the frame, then the card.
        if (cards.has(key)) {
          const card = cards.get(key);
          if (card) show(card);
          return;
        }
        const frame = linkFrame(anchor);
        if (frame) show(frame);
        void cardFor(key).then((card) => {
          if (current !== mine) return;
          if (card) show(card);
          else close();
        });
      }, SHOW_DELAY);
      current = mine;
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const link = linkIn(e.target);
      if (link) start(link, e.clientX);
    };
    const onOut = (e: PointerEvent) => {
      if (current && !(e.relatedTarget instanceof Node && current.anchor.contains(e.relatedTarget))) close();
    };
    const onDown = () => {
      pressedAt = Date.now();
      close();
    };
    const onFocus = (e: FocusEvent) => {
      // A click or a tap focuses the link too: that is not keyboard focus (a hover already shows the card).
      if (Date.now() - pressedAt < 1000) return;
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
