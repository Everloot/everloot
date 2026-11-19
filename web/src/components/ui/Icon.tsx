import type { ReactNode, SVGProps } from "react";

export type IconName = "chevron" | "diamond" | "search" | "copy";

// Our own line glyphs that more than one component draws. Decorative: the control or link beside it names the thing.
// Each keeps its own grid and stroke; `size` is the drawn width and height in px. Stroke follows the text colour.
const GLYPHS: Record<IconName, { size: number; svg: SVGProps<SVGSVGElement>; body: ReactNode }> = {
  /** Points down; a menu's button turns it with `rotate-180` while the menu is open. */
  chevron: { size: 10, svg: { viewBox: "0 0 10 10" }, body: <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /> },
  /** The favicon's diamond, outlined. */
  diamond: { size: 16, svg: { viewBox: "8 8 48 48" }, body: <path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" /> },
  search: {
    size: 16,
    svg: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" },
    body: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  },
  copy: {
    size: 14,
    svg: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: <path d="M8 8h11v12H8zM5 16V4h11" />,
  },
};

export default function Icon({ name, size, className }: { name: IconName; size?: number; className?: string }) {
  const glyph = GLYPHS[name];
  const px = size ?? glyph.size;
  return <svg aria-hidden="true" width={px} height={px} {...glyph.svg} className={className || undefined}>{glyph.body}</svg>;
}
