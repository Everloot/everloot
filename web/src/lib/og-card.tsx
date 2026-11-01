import { ImageResponse } from "next/og";
import { tokens, type CLASSES } from "@/design/tokens";
import type { Showcase } from "@/lib/character-showcase";
// The cards are drawn on each request on the Worker, which has no node_modules to read, so the bundler inlines
// the fonts' bytes (`?inline`, next.config.js). The package's exports hide its font files, hence the path.
import boldUrl from "../../node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf?inline";
import regularUrl from "../../node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf?inline";

/** Size every per-route social card shares with the site-wide one. */
export const CARD_SIZE = { width: 1200, height: 630 };

const fromDataUrl = (url: string) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
const FONTS = [
  { name: "Geist", data: fromDataUrl(boldUrl), weight: 700, style: "normal" },
  { name: "Geist", data: fromDataUrl(regularUrl), weight: 400, style: "normal" },
] as const;

export interface CardBar { name: string; value: string; fraction: number; /** The bar's own colour; the card's by default. */ color?: string }

/**
 * A shared build's card: the label, the build named in its class colour, a line under it, and up to
 * two groups of bars (one per talent set, or the raid's roles). Text and shapes only, like the card
 * below: no game art.
 */
export async function renderBuildCard(card: { label: string; title: string; color: string; subtitle: string; groups: { heading: string; bars: CardBar[] }[] }): Promise<ImageResponse> {
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
    { ...CARD_SIZE, fonts: [...FONTS] },
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
    { ...CARD_SIZE, fonts: [...FONTS] },
  );
}

/** The two share card sizes: the link preview, and the square one for Discord and social posts. */
export const CHARACTER_CARD_SIZES = { wide: { width: 1200, height: 630 }, square: { width: 1080, height: 1080 } } as const;
export type CharacterCardSize = keyof typeof CHARACTER_CARD_SIZES;

/** One line, cut with an ellipsis: a realm or guild name the card does not choose. */
const oneLine = { display: "block", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" } as const;

/**
 * A showcase character's card: the name in its class colour, the level, race, class and realm, the guild when the
 * owner shows it, up to three stat blocks from the shown sections, and the upload date. Text and shapes only: no
 * game art, no Blizzard marks (docs/ASSETS.md).
 *
 * Unlike the cards above it reads no font file: the Worker that draws it on request has no filesystem, so it uses
 * the font next/og carries, which the Cloudflare build bundles as a module.
 */
export async function renderCharacterCard(view: Showcase, size: CharacterCardSize): Promise<ImageResponse> {
  const c = tokens.dark;
  const ch = view.input;
  const square = size === "square";
  const color = view.classSlug ? c[`class-${view.classSlug}` as `class-${(typeof CLASSES)[number]}`] : c.fg;
  const blocks = view.blocks.map((b) => (
    <div key={b.label} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "18px 24px", borderRadius: 12, background: c.panel, border: `1px solid ${c.line}` }}>
      <div style={{ fontSize: 24, color: c.muted }}>{b.label}</div>
      <div style={{ display: "block", lineClamp: 2, fontSize: square ? 36 : 32, color: c.fg }}>{b.value}</div>
    </div>
  ));
  const identity = (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ ...oneLine, fontSize: 72, letterSpacing: -2, lineHeight: 1.25, color }}>{ch.name}</div>
      <div style={{ ...oneLine, fontSize: 32, marginTop: 8, color: c["fg-2"] }}>{`${view.line} · ${ch.realm}`}</div>
      {ch.guild && <div style={{ ...oneLine, fontSize: 30, marginTop: 10, color: c.muted }}>{`<${ch.guild.name}>`}</div>}
    </div>
  );
  const footer = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto", paddingTop: 24, fontSize: 24, color: c.muted }}>
      <div style={{ display: "block", lineClamp: 2 }}>{view.freshness}</div>
      <div style={oneLine}>{`everloot.app${ch.path}`}</div>
    </div>
  );
  // Wide: the name and the date on the left, the blocks down the right. Square: everything stacked.
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: square ? "column" : "row", gap: 48, padding: square ? "80px" : "56px 72px", background: c.canvas, color: c.fg }}>
        <div style={{ display: "flex", flexDirection: "column", ...(square ? {} : { flex: 1 }), minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: square ? 72 : 40 }}>
            <svg width="40" height="40" viewBox="8 8 48 48">
              <path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke={c.accent} strokeWidth="5" strokeLinejoin="round" />
            </svg>
            <div style={{ fontSize: 30, color: c.accent }}>{ch.sample ? "Everloot · Sample character" : "Everloot · Character"}</div>
          </div>
          {identity}
          {!square && footer}
        </div>
        {blocks.length > 0 && <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, width: square ? "100%" : 440, marginTop: square ? "auto" : 0 }}>{blocks}</div>}
        {square && footer}
      </div>
    ),
    { ...CHARACTER_CARD_SIZES[size] },
  );
}
