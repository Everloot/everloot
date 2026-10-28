import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { tokens } from "@/design/tokens";

/** Size every per-route social card shares with the site-wide one. */
export const CARD_SIZE = { width: 1200, height: 630 };

// Read from the geist package when the image is prerendered at build.
const fonts = join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans");

export interface CardBar { name: string; value: string; fraction: number; /** The bar's own colour; the card's by default. */ color?: string }

/**
 * A shared build's card: the label, the build named in its class colour, a line under it, and up to
 * two groups of bars (one per talent set, or the raid's roles). Text and shapes only, like the card
 * below: no game art.
 */
export async function renderBuildCard(card: { label: string; title: string; color: string; subtitle: string; groups: { heading: string; bars: CardBar[] }[] }): Promise<ImageResponse> {
  const [bold, regular] = await Promise.all([readFile(join(fonts, "Geist-Bold.ttf")), readFile(join(fonts, "Geist-Regular.ttf"))]);
  const c = tokens.dark;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "64px 80px", background: c.canvas, color: c.fg, fontFamily: "Geist" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="40" height="40" viewBox="8 8 48 48">
            <path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke={c.accent} strokeWidth="5" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 30, fontWeight: 700, color: c.accent }}>{card.label}</div>
        </div>
        <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2, marginTop: 24, lineHeight: 1.15, color: card.color }}>{card.title}</div>
        <div style={{ fontSize: 32, marginTop: 22, color: c["fg-2"] }}>{card.subtitle}</div>
        <div style={{ display: "flex", gap: 56, marginTop: 32 }}>
          {card.groups.map((g) => (
            <div key={g.heading} style={{ display: "flex", flexDirection: "column", flex: 1, gap: 10 }}>
              <div style={{ fontSize: 24, color: c.muted }}>{g.heading}</div>
              {g.bars.map((b) => (
                <div key={b.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28 }}>
                    <span>{b.name}</span>
                    <span style={{ fontWeight: 700 }}>{b.value}</span>
                  </div>
                  <div style={{ display: "flex", height: 12, borderRadius: 6, background: c.panel, border: `1px solid ${c.line}` }}>
                    <div style={{ width: `${Math.round(Math.max(0, Math.min(1, b.fraction)) * 100)}%`, height: "100%", borderRadius: 6, background: b.color ?? card.color }} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 24, marginTop: "auto", paddingTop: 24, color: c.muted }}>everloot.app</div>
      </div>
    ),
    { ...CARD_SIZE, fonts: [{ name: "Geist", data: bold, weight: 700, style: "normal" }, { name: "Geist", data: regular, weight: 400, style: "normal" }] },
  );
}

/**
 * How the card draws a title whose length the page does not set (a guide's, up to 90 characters): the full size over
 * two lines when it is short, a smaller one over three when it is not, and an ellipsis past those lines. Either way
 * the title stays clear of the line under it.
 */
export function fittedTitle(title: string): { fontSize: number; lines: number } {
  return title.length <= 40 ? { fontSize: 84, lines: 2 } : { fontSize: 64, lines: 3 };
}

/**
 * A text-only social card on the brand canvas: the diamond mark, a small label, the page title and one
 * line under it. Nothing from the game, so no Blizzard art can end up in a shared link. `fit` bounds the title
 * (fittedTitle); without it the title is drawn at full size as it is.
 */
export async function renderCard(card: { label: string; title: string; subtitle: string; fit?: boolean }): Promise<ImageResponse> {
  const [bold, regular] = await Promise.all([readFile(join(fonts, "Geist-Bold.ttf")), readFile(join(fonts, "Geist-Regular.ttf"))]);
  const c = tokens.dark;
  const fit = card.fit ? fittedTitle(card.title) : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px", background: c.canvas, color: c.fg, fontFamily: "Geist" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="56" height="56" viewBox="8 8 48 48">
            <path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke={c.accent} strokeWidth="5" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, color: c.accent }}>{card.label}</div>
        </div>
        <div style={{ fontSize: fit?.fontSize ?? 84, fontWeight: 700, letterSpacing: -2, marginTop: 40, lineHeight: 1.05, ...(fit ? { display: "block", lineClamp: fit.lines } : {}) }}>{card.title}</div>
        <div style={{ fontSize: 36, marginTop: 28, color: c["fg-2"] }}>{card.subtitle}</div>
        <div style={{ fontSize: 28, marginTop: 56, color: c.muted }}>everloot.app</div>
      </div>
    ),
    { ...CARD_SIZE, fonts: [{ name: "Geist", data: bold, weight: 700, style: "normal" }, { name: "Geist", data: regular, weight: 400, style: "normal" }] },
  );
}
