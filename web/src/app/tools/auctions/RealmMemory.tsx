"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The realm and house this browser last chose in any realm and house picker, as JSON:
 * `{"realm":"<slug>","name":"<realm name>","house":"alliance"|"horde"|"neutral"|null}`. It stays in this browser;
 * nothing is sent anywhere.
 */
export const REALM_MEMORY_KEY = "everloot.market.realm.v1";

interface Remembered { realm: string; name: string; house: string | null }

/** The remembered choice, when it is one this page lists. Its house is kept only where the page offers it. */
export function rememberedChoice(raw: string | null, known: readonly string[], houses: readonly string[]): Remembered | null {
  let value: Partial<Remembered> | null;
  try { value = JSON.parse(raw ?? "null") as Partial<Remembered> | null; } catch { return null; }
  if (!value || typeof value.realm !== "string" || typeof value.name !== "string" || !known.includes(value.realm)) return null;
  return { realm: value.realm, name: value.name, house: typeof value.house === "string" && houses.includes(value.house) ? value.house : null };
}

/** The page's own address with the remembered realm, and its house unless the address names one. */
export function rememberedHref(href: string, choice: Remembered): string {
  const url = new URL(href);
  url.searchParams.set("realm", choice.realm);
  if (choice.house && !url.searchParams.has("house")) url.searchParams.set("house", choice.house);
  return url.toString();
}

function read(): string | null {
  try { return window.localStorage.getItem(REALM_MEMORY_KEY); } catch { return null; }
}

/**
 * Remembers the page's realm and house. A page opened with no realm instead offers the remembered one: `redirect`
 * reloads it with `?realm=` (and `?house=` when the page names none), keeping its other parameters and its anchor;
 * `link` shows a link to that realm's Auction House page, for the all-realms list, which is a page of its own;
 * `save` only remembers, for a page whose link already names what to show another way.
 * Only a realm the page lists and a house it offers are used, so a realm that went quiet is not forced on anyone.
 */
export default function RealmMemory({ realm, name, house, known, houses, mode, linkBase }: {
  /** The page's realm slug, null when the page has none; a page with a realm never offers another. */
  realm: string | null;
  /** That realm's name, when the page lists it: only a listed realm is remembered. */
  name: string | null;
  house: string | null;
  known: readonly string[];
  houses: readonly string[];
  mode: "redirect" | "link" | "save";
  /** For `link`: the realm pages' base path; the slug follows it. */
  linkBase?: string;
}) {
  const [offer, setOffer] = useState<Remembered | null>(null);
  // Strings, not the arrays and object, so a re-render with the same choice does not run the effect again.
  const knownKey = known.join(" ");
  const housesKey = houses.join(" ");
  useEffect(() => {
    if (realm !== null) {
      if (name !== null) try { window.localStorage.setItem(REALM_MEMORY_KEY, JSON.stringify({ realm, name, house })); } catch {}
      setOffer(null);
      return;
    }
    if (mode === "save") return;
    const saved = rememberedChoice(read(), knownKey.split(" "), housesKey.split(" "));
    if (!saved) return;
    if (mode === "link") setOffer(saved);
    else window.location.replace(rememberedHref(window.location.href, saved));
  }, [realm, name, house, knownKey, housesKey, mode]);
  if (!offer || !linkBase) return null;
  const href = `${linkBase}/${encodeURIComponent(offer.realm)}${offer.house ? `?house=${offer.house}` : ""}`;
  return (
    <p data-realm-memory className="text-meta text-fg-2">
      Your last realm: <Link href={href} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{offer.name}</Link>
    </p>
  );
}
