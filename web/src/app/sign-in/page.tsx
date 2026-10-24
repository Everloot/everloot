import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import EmailAuthForm from "@/components/EmailAuthForm";
import { authV2Enabled, signInMethods } from "@/lib/auth/auth";
import { addAccountState, MAX_DEVICE_ACCOUNTS, profilesOn } from "@/lib/auth/device-accounts";
import { safeReturnTo } from "@/lib/auth/return-to";
import { pageMetadata } from "@/lib/seo";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Sign in", description: "Sign in to your Everloot account with Battle.net or email.", path: "/sign-in" }),
  robots: { index: false, follow: true },
};

const battlenetButton = "inline-flex items-center justify-center min-h-11 px-4 rounded-lg border border-line text-sm text-fg hover:text-accent";

// `?error=<reason>` comes from the Battle.net callback when a sign-in did not finish. The reason is mapped to a
// sentence here and never shown as-is.
function signInError(error: string | string[] | undefined): string | null {
  if (typeof error !== "string" || !error) return null;
  switch (error) {
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
export default async function SignInPage({ searchParams }: { searchParams?: Promise<{ returnTo?: string | string[]; add?: string | string[]; ready?: string | string[]; error?: string | string[] }> }) {
  const params = await searchParams;
  let add = params?.add === "1" && authV2Enabled() && profilesOn();
  if (add) {
    const state = await addAccountState(await headers()).catch(() => "unavailable" as const);
    if (state === "needs-cookie" && params?.ready !== "1") redirect("/api/me/accounts/add");
    if (state === "full" || state === "needs-cookie" || state === "unavailable") {
      return (
        <article className="max-w-3xl space-y-6">
          <h1 className="text-3xl font-bold text-fg">Add another account</h1>
          <p role="status" className="text-fg-2">
            {state === "full"
              ? `You are signed in to ${MAX_DEVICE_ACCOUNTS} accounts on this browser, the most it holds. Sign out of one to add another.`
              : "Adding an account is unavailable right now. Try again in a minute."}
          </p>
        </article>
      );
    }
    add = state === "ready";
  }
  const returnTo = safeReturnTo(params?.returnTo) ?? (add ? "/" : null);
  if (!add && await getUser().catch(() => null)) redirect(returnTo ?? "/account");
  // After an add through Battle.net the landing page checks whether the same account came back (home page notice).
  const bnetReturn = add && returnTo ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}added=bnet` : returnTo;
  const methods = signInMethods();
  const errorMessage = signInError(params?.error);
  return (
    <article className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold text-fg">{add ? "Add another account" : "Sign in"}</h1>
      {add && <p className="text-sm text-fg-2">Sign in with the account you want to add.</p>}
      {errorMessage && <p role="alert" className="text-sm text-fg">{errorMessage}</p>}
      {methods.battlenet && (
        <p><a href={bnetReturn ? `/api/auth/bnet?returnTo=${encodeURIComponent(bnetReturn)}` : "/api/auth/bnet"} className={battlenetButton}>Sign in with Battle.net</a></p>
      )}
      {methods.email ? (
        <>
          {methods.battlenet && <p className="text-sm text-muted">Or with your email:</p>}
          <EmailAuthForm mode="sign-in" returnTo={returnTo ?? undefined} />
          <p className="text-sm text-fg-2">
            New here? <Link href={returnTo ? `/sign-up?returnTo=${encodeURIComponent(returnTo)}` : "/sign-up"} className="text-accent hover:underline underline-offset-4">Make an account</Link>
            {" · "}
            <Link href="/reset-password" className="text-accent hover:underline underline-offset-4">Forgot your password?</Link>
          </p>
        </>
      ) : !methods.battlenet && <p className="text-fg-2">Sign-in is not available right now.</p>}
    </article>
  );
}
