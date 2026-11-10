import { QUALITIES } from "@/design/tokens";

export type Quality = (typeof QUALITIES)[number];

// Written out in full so Tailwind finds every class in the source.
export const QUALITY_TEXT: Record<Quality, string> = {
  poor: "text-q-poor",
  common: "text-q-common",
  uncommon: "text-q-uncommon",
  rare: "text-q-rare",
  epic: "text-q-epic",
  legendary: "text-q-legendary",
};

export const QUALITY_BORDER: Record<Quality, string> = {
  poor: "border-q-poor",
  common: "border-q-common",
  uncommon: "border-q-uncommon",
  rare: "border-q-rare",
  epic: "border-q-epic",
  legendary: "border-q-legendary",
};

export const QUALITY_LABEL: Record<Quality, string> = {
  poor: "Poor",
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

/** The game's quality number (0 poor to 5 legendary) as a token name; anything else reads as common. */
export function qualityOf(id: number): Quality {
  return QUALITIES[id] ?? "common";
}
