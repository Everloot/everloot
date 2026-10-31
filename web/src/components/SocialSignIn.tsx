"use client";

import { useState } from "react";
import { PROVIDER_NAMES, type SocialProvider } from "@/lib/auth/social";
import { safeReturnTo } from "@/lib/auth/return-to";

const button = "inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line bg-canvas px-4 py-2 text-sm font-medium text-fg hover:border-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60";

/** The same OAuth controls for sign-in, sign-up and linking from an existing account. */
export default function SocialSignIn({ providers, returnTo, mode = "sign-in", addAccount = false }: {
  providers: readonly (SocialProvider | "battlenet")[];
  returnTo?: string;
  mode?: "sign-in" | "link";
  addAccount?: boolean;
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
  return (
    <div className="max-w-sm space-y-3">
      <div className="grid gap-2" aria-label={mode === "link" ? "Link a sign-in method" : "Other ways to sign in"}>
        {providers.map((provider) => (
          <button key={provider} type="button" className={button} disabled={busy !== null}
            aria-busy={busy === provider} onClick={() => start(provider)}>
            {busy === provider ? `Opening ${PROVIDER_NAMES[provider]}…`
              : `${mode === "link" ? "Link" : "Continue with"} ${PROVIDER_NAMES[provider]}`}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-fg">{error}</p>}
    </div>
  );
}
