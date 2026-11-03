import type { ReactNode } from "react";
import Link from "next/link";
import { BannerArt } from "@/components/game/PageBanner";
import Glint from "@/components/glint/Glint";
import { BANNER_CAPTION } from "@/components/ui/Banner";
import type { LoadingArt } from "@/lib/game-assets";

// The home hero's crop of Onyxia's Lair, so the page shows the same picture as the front page.
const ART_POSITION = "61% 30%";

/** The pill every sign-in button shares: Battle.net's link, the social providers and the email submit. */
export const AUTH_BUTTON = "btn w-full gap-3 px-5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const footLink = "underline decoration-edge underline-offset-4 hover:text-fg hover:decoration-fg";

/**
 * The frame of /sign-in and /sign-up: a panel with Glint and the site's line over the home hero's art (under a
 * solid canvas veil, never a gradient or a dimmed picture), then one centred card with the page's title and its
 * sign-in methods, then the page's own links and the legal links under it. On a phone the card is the width of
 * the screen. Without the art (no asset upload) the panel is the plain panel colour and there is no credit.
 */
export default function AuthShell({ art, title, lede, children, footer }: {
  art: LoadingArt | null;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  /** Lines under the card: the other page, a forgotten password, the terms a new account accepts. */
  footer?: ReactNode;
}) {
  return (
    <div data-auth-shell className="mx-auto w-full max-w-md space-y-4 py-4">
      <div data-auth-art className="relative overflow-hidden rounded-card border border-line bg-panel">
        {art && (
          <>
            <BannerArt art={art} eager position={ART_POSITION} sizes="(min-width: 640px) 448px, 100vw" />
            <div aria-hidden="true" className="absolute inset-0 bg-canvas/70" />
            <p data-auth-credit className="absolute right-2 top-2 rounded-control bg-canvas/80 px-1.5 py-0.5 text-[10px] leading-none text-muted">
              {BANNER_CAPTION}
            </p>
          </>
        )}
        <div className="relative flex flex-col items-center gap-3 px-4 py-6 text-center">
          <Glint size={72} className="h-16 w-16 sm:h-18 sm:w-18" />
          <p className="text-sm font-semibold tracking-tight text-fg">
            Every drop. Every guild. <span className="text-accent">Every reset.</span>
          </p>
        </div>
      </div>
      <div className="rounded-card border border-line bg-panel p-5 sm:p-8">
        <div className="space-y-6">
          <header className="space-y-1 text-center">
            <h1 className="text-title-sm text-fg sm:text-title">{title}</h1>
            {lede}
          </header>
          {children}
        </div>
      </div>
      <div className="space-y-4 px-4 pt-2 text-center">
        {footer}
        <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-muted">
          <Link href="/terms" className={footLink}>Terms of Service</Link>
          <Link href="/privacy" className={footLink}>Privacy Policy</Link>
          <Link href="/security" className={footLink}>Security</Link>
        </nav>
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
