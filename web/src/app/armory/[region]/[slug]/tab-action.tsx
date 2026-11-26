"use server";

import type { ReactNode } from "react";
import { armoryOn } from "@/lib/armory";
import { characterPanel, isCharacterTab } from "../../character-tabs";
import { loadCharacter, tabParts } from "./character-data";

/**
 * One character-sheet tab's content, for a tab opened after the page loaded. The character is read again, so a
 * character hidden since the page loaded shows nothing more.
 */
export async function characterTab(region: string, slug: string, tab: string): Promise<ReactNode> {
  if (!armoryOn() || typeof tab !== "string" || !isCharacterTab(tab)) return null;
  const c = await loadCharacter(String(region), String(slug));
  if (c === null) return <p className="py-3 text-sm text-fg-2">This character is no longer on Everloot.</p>;
  if (c === "unreachable") return <p className="py-3 text-sm text-fg-2">Armory storage did not answer. Try again in a moment.</p>;
  return characterPanel(c, tab, await tabParts(c, tab));
}
