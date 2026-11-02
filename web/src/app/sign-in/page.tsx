import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AuthShell, { AUTH_BUTTON, AuthDivider } from "@/components/AuthShell";
import EmailAuthForm from "@/components/EmailAuthForm";
import SocialSignIn from "@/components/SocialSignIn";
import { configuredSocialProviders } from "@/lib/auth/social";
import { authV2Enabled, signInMethods } from "@/lib/auth/auth";
import { addAccountState, MAX_DEVICE_ACCOUNTS, profilesOn } from "@/lib/auth/device-accounts";
import { safeReturnTo } from "@/lib/auth/return-to";
import { launchArt, loadSiteAssets } from "@/lib/game-assets";
import { pageMetadata } from "@/lib/seo";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Sign in", description: "Sign in to your Everloot account.", path: "/sign-in" }),
  robots: { index: false, follow: true },
};

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
// The panel's picture is decoration: the page loads it only when it renders, after the session check and the
// add-account redirect, so a visitor who is sent on never waits for the asset manifest.
const shellArt = async () => launchArt(await loadSiteAssets())?.background ?? null;
const alertBox = "rounded-card border border-danger bg-panel px-4 py-3";

// `?error=<reason>` comes from the Battle.net callback when a sign-in did not finish. The reason is mapped to a
// sentence here and never shown as-is.
function signInError(error: string | string[] | undefined): string | null {
  if (typeof error !== "string" || !error) return null;
  switch (error) {
    case "social": return "That sign-in did not finish. Try again, or use an existing login and link this provider from your account.";
    case "access_denied": return "Battle.net sign-in was cancelled. Try again when you are ready.";
    case "invalid_state": return "That sign-in link is stale. Start again from here.";
    case "server_config": return "Battle.net sign-in is not set up on this site yet.";
    default: return "Battle.net did not finish the sign-in. Try again in a minute.";
  }
}

// `?returnTo=/path` brings the visitor back to the page that sent them here (Save in the talent calculator, /me).
// `?add=1` (Add another account, in the avatar menu) keeps the signed-in account: with Better Auth's multi-session
// plugin a second sign-in adds an account to this browser instead of replacing the first.
// Before an add, GET /api/me/accounts/add gives a session from before the plugin its `_multi-` cookie (else the new
// sign-in would orphan it) and notes the accounts already here; it comes back with `ready=1`. At 5 accounts the
// plugin would replace the current one, so the page refuses instead.
export default async function SignInPage({ searchParams }: { searchParams?: Promise<{ returnTo?: string | string[]; add?: string | string[]; ready?: string | string[]; error?: string | string[]; flow?: string | string[] }> }) {
  const params = await searchParams;
  let add = params?.add === "1" && authV2Enabled() && profilesOn();
  if (add) {
    const state = await addAccountState(await headers()).catch(() => "unavailable" as const);
    if (state === "needs-cookie" && params?.ready !== "1") redirect("/api/me/accounts/add");
    if (state === "full" || state === "needs-cookie" || state === "unavailable") {
      return (
        <AuthShell art={await shellArt()} title="Add another account">
          <p role="status" className="text-fg-2">
            {state === "full"
              ? `You are signed in to ${MAX_DEVICE_ACCOUNTS} accounts on this browser, the most it holds. Sign out of one to add another.`
              : "Adding an account is unavailable right now. Try again in a minute."}
          </p>
        </AuthShell>
      );
    }
    add = state === "ready";
  }
  const returnTo = safeReturnTo(params?.returnTo) ?? (add ? "/" : null);
  if (!add && await getUser().catch(() => null)) redirect(returnTo ?? "/account");
  // After an add through Battle.net the landing page checks whether the same account came back (home page notice).
  const bnetReturn = add && returnTo ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}added=bnet` : returnTo;
  const methods = signInMethods();
  const social = configuredSocialProviders();
  const errorMessage = signInError(params?.flow === "social" && params.error ? "social" : params?.error);
  const providers = methods.battlenet || social.length > 0;
  return (
    <AuthShell
      art={await shellArt()}
      title={add ? "Add another account" : "Sign in"}
      lede={<p className="text-sm text-fg-2">{add ? "Sign in with the account you want to add." : "Pick up where you left off with your saved builds."}</p>}
    >
      {errorMessage && <div className={alertBox}><p role="alert" className="text-sm text-fg">{errorMessage}</p></div>}
      {providers && (
        <div className="space-y-2">
          {methods.battlenet && (
            <a href={bnetReturn ? `/api/auth/bnet?returnTo=${encodeURIComponent(bnetReturn)}` : "/api/auth/bnet"} className={AUTH_BUTTON}>Sign in with Battle.net</a>
          )}
          <SocialSignIn providers={social} returnTo={returnTo ?? undefined} addAccount={add} />
        </div>
      )}
      {methods.email ? (
        <>
          {providers && <AuthDivider>or with your email</AuthDivider>}
          <EmailAuthForm mode="sign-in" returnTo={returnTo ?? undefined} />
          <p className="text-sm text-fg-2">
            New here? <Link href={returnTo ? `/sign-up?returnTo=${encodeURIComponent(returnTo)}` : "/sign-up"} className={link}>Make an account</Link>
            {" · "}
            <Link href="/reset-password" className={link}>Forgot your password?</Link>
          </p>
        </>
      ) : !providers && <p className="text-fg-2">Sign-in is not available right now.</p>}
    </AuthShell>
  );
}
