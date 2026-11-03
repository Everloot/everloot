"use client";

import { useState } from "react";
import { PROVIDER_NAMES, type SocialProvider } from "@/lib/auth/social";
import { safeReturnTo } from "@/lib/auth/return-to";
import { AUTH_BUTTON } from "./AuthShell";
import ProviderLogo from "./ProviderLogo";

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Google and Microsoft set how their sign-in buttons look, so theirs are not Everloot's pill. Google's is the dark
 * theme of the Sign in with Google guidelines: #131314 fill, 1 px #8E918F stroke, #E3E3E3 Google Sans Medium 14/20,
 * 12 px before the logo and after the text, 10 px between, the "G" at 20 px; wider than the bundled asset with the
 * logo kept at the start and the text centred, as Google's own button does. Microsoft's follows its dark-theme
 * asset: #2F2F2F, white Segoe UI Semibold 15 px, the 21 px logo 12 px in, 41 px tall, square corners. Each keeps
 * one of its approved labels whatever the page, so "Opening …" shows below the buttons instead of in them.
 */
const BRANDED: Partial<Record<string, { button: string; logo: number; label: string }>> = {
  google: {
    button: `grid h-10 w-full grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-[10px] rounded-full border border-[#8E918F] bg-[#131314] px-3 text-[14px] font-medium leading-5 text-[#E3E3E3] [font-family:Google_Sans,Roboto,Arial,sans-serif] disabled:cursor-wait ${FOCUS}`,
    logo: 20,
    label: "Continue with Google",
  },
  microsoft: {
    button: `grid h-[41px] w-full grid-cols-[21px_minmax(0,1fr)_21px] items-center gap-3 bg-[#2F2F2F] px-3 text-[15px] font-semibold text-[#FFFFFF] [font-family:Segoe_UI,system-ui,sans-serif] disabled:cursor-wait ${FOCUS}`,
    logo: 21,
    label: "Sign in with Microsoft",
  },
};

/**
 * The tile layout of /sign-in and /sign-up: one square per provider with its mark alone, named for assistive
 * technology and the tooltip. Google's tile is the icon mode of its dark button (#131314 fill, 1 px #8E918F, the
 * G at 20 px, a shape its pre-approved set includes); the others are Everloot's control. Microsoft has no icon mode:
 * its guidelines tie the logo to the words "Sign in with Microsoft", so it keeps its full-width button under the row.
 */
const TILE = `grid h-12 w-full place-items-center rounded-control border border-line bg-canvas transition-colors hover:border-accent disabled:cursor-wait ${FOCUS}`;
const GOOGLE_TILE = `grid h-12 w-full place-items-center rounded-control border border-[#8E918F] bg-[#131314] disabled:cursor-wait ${FOCUS}`;
const NO_TILE = new Set<string>(["microsoft"]);

/** The same OAuth controls for sign-in, sign-up and linking from an existing account. */
export default function SocialSignIn({ providers, returnTo, mode = "sign-in", addAccount = false, layout = "list" }: {
  providers: readonly (SocialProvider | "battlenet")[];
  returnTo?: string;
  mode?: "sign-in" | "link";
  addAccount?: boolean;
  /** `tiles` on the sign-in pages (marks only, in a row); `list` is one full-width text button per provider. */
  layout?: "list" | "tiles";
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(provider: string) {
    if (busy) return;
    setBusy(provider); setError(null);
    const callbackURL = mode === "link" ? "/account#sign-in-methods" : safeReturnTo(returnTo) ?? "/account";
    // Better Auth appends its own `error` parameter, so the flow marker has a different name.
    const errorCallbackURL = mode === "link" ? "/account?linkError=1#sign-in-methods"
      : `/sign-in?flow=social${safeReturnTo(returnTo) ? `&returnTo=${encodeURIComponent(returnTo!)}` : ""}${addAccount ? "&add=1&ready=1" : ""}`;
    try {
      const response = await fetch(mode === "link" ? "/api/auth/link-social" : "/api/auth/sign-in/social", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, callbackURL, errorCallbackURL }),
      });
      if (response.status === 401) throw new Error("Sign in again before linking another login.");
      if (response.status === 429) throw new Error("Too many tries. Wait a minute and try again.");
      const result = await response.json() as { url?: string };
      if (!response.ok || !result.url) throw new Error("That sign-in could not start. Try again in a minute.");
      window.location.assign(result.url);
    } catch (err) {
      setError(err instanceof Error && /^(Sign in again|Too many tries)/.test(err.message)
        ? err.message : "That sign-in could not start. Try again in a minute.");
      setBusy(null);
    }
  }

  if (!providers.length) return null;
  const label = (provider: string) => BRANDED[provider]?.label ?? `${mode === "link" ? "Link" : "Continue with"} ${PROVIDER_NAMES[provider]}`;
  const tiles = layout === "tiles" ? providers.filter((provider) => !NO_TILE.has(provider)) : [];
  const rows = layout === "tiles" ? providers.filter((provider) => NO_TILE.has(provider)) : providers;
  return (
    <div className="w-full space-y-3">
      <div className="grid gap-2" aria-label={mode === "link" ? "Link a sign-in method" : "Other ways to sign in"}>
        {tiles.length > 0 && (
          <div className="grid auto-cols-fr grid-flow-col gap-2">
            {tiles.map((provider) => (
              <button key={provider} type="button" data-provider-tile={provider} className={provider === "google" ? GOOGLE_TILE : TILE}
                aria-label={label(provider)} title={label(provider)} disabled={busy !== null} aria-busy={busy === provider} onClick={() => start(provider)}>
                <ProviderLogo provider={provider} size={provider === "google" ? 20 : 24} />
              </button>
            ))}
          </div>
        )}
        {rows.map((provider) => {
          const brand = BRANDED[provider];
          return (
            <button key={provider} type="button" className={brand?.button ?? `${AUTH_BUTTON} disabled:cursor-wait`} disabled={busy !== null}
              aria-busy={busy === provider} onClick={() => start(provider)}>
              <ProviderLogo provider={provider} size={brand?.logo} />
              <span className={brand ? "truncate text-center" : undefined}>{label(provider)}</span>
              {brand && <span aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {busy && <p role="status" className="text-sm text-fg-2">Opening {PROVIDER_NAMES[busy]}…</p>}
      {error && <p role="alert" className="text-sm text-fg">{error}</p>}
    </div>
  );
}
