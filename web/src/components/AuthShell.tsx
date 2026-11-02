import type { ReactNode } from "react";
import { BannerArt } from "@/components/game/PageBanner";
import Glint from "@/components/glint/Glint";
import { BANNER_CAPTION } from "@/components/ui/Banner";
import type { LoadingArt } from "@/lib/game-assets";

// The home hero's crop of Onyxia's Lair, so the panel shows the same picture as the front page.
const ART_POSITION = "61% 30%";

/** The pill every sign-in button shares: Battle.net's link, the social providers and the email submit. */
export const AUTH_BUTTON = "btn w-full gap-3 px-5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The frame of /sign-in and /sign-up: the home hero's art with Glint and the site's line on one side, the page's
 * title and its sign-in methods on the other. On a phone the art is a short strip above the form. Without the
 * art (no asset upload) the panel is the plain panel colour and there is no credit.
 */
export default function AuthShell({ art, title, lede, children }: { art: LoadingArt | null; title: ReactNode; lede?: ReactNode; children: ReactNode }) {
  return (
    <div data-auth-shell className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-card border border-line bg-canvas lg:min-h-[36rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div data-auth-art className="relative flex min-h-44 flex-col justify-end overflow-hidden bg-panel p-4 sm:min-h-56 lg:p-8">
        {art && <BannerArt art={art} eager position={ART_POSITION} sizes="(min-width: 1024px) 512px, 100vw" />}
        <div className="relative flex max-w-sm items-center gap-4 rounded-card border border-line bg-canvas/85 p-4">
          <Glint size={64} className="h-12 w-12 shrink-0 sm:h-16 sm:w-16" />
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight tracking-tight text-fg sm:text-xl">
              Every drop. Every guild. <span className="text-accent">Every reset.</span>
            </p>
            <p className="mt-1 hidden text-sm text-fg-2 sm:block">The open WoW: Forever database, written by the addons of the people who play it.</p>
          </div>
        </div>
        {art && (
          <p data-auth-credit className="absolute right-2 top-2 rounded-control bg-canvas/80 px-1.5 py-0.5 text-[10px] leading-none text-muted">
            {BANNER_CAPTION}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-center p-5 sm:p-10">
        <div className="mx-auto w-full max-w-sm space-y-6">
          <header className="space-y-2">
            <h1 className="text-title-sm text-fg sm:text-title">{title}</h1>
            {lede}
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

/** "or with email" between the provider buttons and the email form. */
export function AuthDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-meta text-muted">
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      <span>{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </div>
  );
}
