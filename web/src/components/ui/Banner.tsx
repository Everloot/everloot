import type { CSSProperties, ReactNode } from "react";

// The art stays bright at the top and on the right; the canvas comes in only where the text sits. The
// bottom fade carries the art into the page and sits under the title and caption (on a
// phone they fill the lower half, so its fade rises higher); the corner shade darkens the bottom-left
// behind the title on a wide screen. Text stays at least 4.5:1 over the art at its brightest point.
// The one gradient the design guard allows (Carlos, 10/19), and only in this file.
const FADE_NARROW: CSSProperties = {
  backgroundImage: "linear-gradient(to top, rgb(var(--canvas)) 0%, rgb(var(--canvas) / 0.9) 22%, rgb(var(--canvas) / 0.75) 50%, rgb(var(--canvas) / 0.6) 62%, rgb(var(--canvas) / 0) 100%)",
};
const FADE_WIDE: CSSProperties = {
  backgroundImage: "linear-gradient(to top, rgb(var(--canvas)) 0%, rgb(var(--canvas) / 0.8) 20%, rgb(var(--canvas) / 0.45) 50%, rgb(var(--canvas) / 0) 100%)",
};
const CORNER: CSSProperties = {
  backgroundImage: "radial-gradient(ellipse 55% 75% at 12% 100%, rgb(var(--canvas) / 0.6) 0%, rgb(var(--canvas) / 0.35) 50%, rgb(var(--canvas) / 0) 100%)",
};
// The home hero's text runs from near the top to the bottom, so on a wide screen a left scrim covers its
// column top to bottom in place of the corner shade, and on a phone the art is clear only above the
// first line (the 4.5rem top padding) and the fade holds under all the text below it.
const HERO_FADE_NARROW: CSSProperties = {
  backgroundImage: "linear-gradient(to bottom, rgb(var(--canvas) / 0) 0, rgb(var(--canvas) / 0.65) 4.5rem, rgb(var(--canvas) / 0.7) 60%, rgb(var(--canvas)) 100%)",
};
const HERO_LEFT: CSSProperties = {
  backgroundImage: "linear-gradient(to right, rgb(var(--canvas) / 0.8) 0%, rgb(var(--canvas) / 0.65) 40%, rgb(var(--canvas) / 0.3) 52%, rgb(var(--canvas) / 0) 62%)",
};

/** The banner's caption: one line in its corner. The full credit, with the build, is on /methodology#credits. */
export const BANNER_CAPTION = "Art © Blizzard Entertainment";

/**
 * A wide-screen banner across the top of a section hub: the picture runs edge to edge across the
 * viewport, at least 256 px tall on a phone and 336 px from `lg`, cropped to fill, and fades into the canvas.
 * `children` (the page's title, from PageHeader) sit on its bottom-left in the page's
 * column, over the art at every width. The caption is a tiny, quiet line in the bottom-right corner at
 * every width, never a block. Use it as the first thing in the layout's `<main>`, not inside a Container:
 * it cancels the main's top padding so it meets the site header. The art is 100vw wide, a scrollbar wider than the page; html and body clip that bleed (globals.css).
 *
 * `hero` is the home page's taller version: at least 432 px on a phone and 544 px from `lg`. `aside` sits on
 * the art at the bottom-right on a wide screen, above the caption, and under `children` on a narrow one.
 * With no `image` the band is the plain panel and there is no caption.
 */
export default function Banner({ image, children, aside, hero = false }: { image: ReactNode; children?: ReactNode; aside?: ReactNode; hero?: boolean }) {
  return (
    <div data-banner className={`relative -mt-8 flex flex-col justify-end pb-4 pt-18 lg:pb-8 ${hero ? "min-h-[27rem] lg:min-h-[34rem]" : "min-h-64 lg:min-h-[21rem]"}`}>
      <div data-banner-art className="absolute inset-y-0 left-[calc(50%-50vw)] w-screen overflow-hidden bg-panel">
        {image}
        <div aria-hidden="true" className="absolute inset-0 lg:hidden" style={hero ? HERO_FADE_NARROW : FADE_NARROW} />
        <div aria-hidden="true" className={`absolute inset-x-0 bottom-0 hidden lg:block ${hero ? "h-1/2" : "h-3/4"}`} style={FADE_WIDE} />
        <div aria-hidden="true" className="absolute inset-0 hidden lg:block" style={hero ? HERO_LEFT : CORNER} />
      </div>
      <div className="relative min-w-0 lg:max-w-[calc(100%-26rem)]">{children}</div>
      {aside && <div className="relative mt-4 lg:absolute lg:bottom-16 lg:right-0 lg:mt-0 lg:w-56">{aside}</div>}
      {image && (
        <p data-banner-credit className="absolute bottom-1 right-0 text-[10px] leading-none text-muted lg:bottom-2">
          {BANNER_CAPTION}
        </p>
      )}
    </div>
  );
}
