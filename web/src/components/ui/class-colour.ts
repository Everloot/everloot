import { CLASSES } from "@/design/tokens";

export type ClassName = (typeof CLASSES)[number];

// The class colours of design/tokens.ts for chart series where a class is the series (rankings, census).
// Written out in full so Tailwind finds every class in the source; typed by CLASSES so a class without one fails the build.
export const CLASS_BG: Record<ClassName, string> = {
  warrior: "bg-class-warrior", paladin: "bg-class-paladin", hunter: "bg-class-hunter",
  rogue: "bg-class-rogue", priest: "bg-class-priest", shaman: "bg-class-shaman",
  mage: "bg-class-mage", warlock: "bg-class-warlock", druid: "bg-class-druid",
};
export const CLASS_TEXT: Record<ClassName, string> = {
  warrior: "text-class-warrior", paladin: "text-class-paladin", hunter: "text-class-hunter",
  rogue: "text-class-rogue", priest: "text-class-priest", shaman: "text-class-shaman",
  mage: "text-class-mage", warlock: "text-class-warlock", druid: "text-class-druid",
};
export const CLASS_STROKE: Record<ClassName, string> = {
  warrior: "stroke-class-warrior", paladin: "stroke-class-paladin", hunter: "stroke-class-hunter",
  rogue: "stroke-class-rogue", priest: "stroke-class-priest", shaman: "stroke-class-shaman",
  mage: "stroke-class-mage", warlock: "stroke-class-warlock", druid: "stroke-class-druid",
};
export const CLASS_FILL: Record<ClassName, string> = {
  warrior: "fill-class-warrior", paladin: "fill-class-paladin", hunter: "fill-class-hunter",
  rogue: "fill-class-rogue", priest: "fill-class-priest", shaman: "fill-class-shaman",
  mage: "fill-class-mage", warlock: "fill-class-warlock", druid: "fill-class-druid",
};

/** A class token in any case ("WARRIOR", "warrior") as a token name; undefined for anything else. */
export const classNameOf = (token: string | null | undefined): ClassName | undefined => CLASSES.find((c) => c === token?.toLowerCase());

/** The colour of a class token from one of the maps above; undefined when the token is not a class. */
export const classColour = (map: Record<ClassName, string>, token: string | null | undefined): string | undefined => {
  const c = classNameOf(token);
  return c ? map[c] : undefined;
};
