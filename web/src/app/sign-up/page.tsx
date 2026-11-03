import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AuthShell, { AUTH_BUTTON, AuthDivider } from "@/components/AuthShell";
import EmailAuthForm from "@/components/EmailAuthForm";
import SocialSignIn from "@/components/SocialSignIn";
import { configuredSocialProviders } from "@/lib/auth/social";
import { signInMethods } from "@/lib/auth/auth";
import { safeReturnTo } from "@/lib/auth/return-to";
import { launchArt, loadSiteAssets } from "@/lib/game-assets";
import { pageMetadata } from "@/lib/seo";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Make an account", description: "Make a free Everloot account.", path: "/sign-up" }),
  robots: { index: false, follow: true },
};

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

// `?returnTo=/path` (from the sign-in page) is where the confirmation link brings a new player back to.
export default async function SignUpPage({ searchParams }: { searchParams?: Promise<{ returnTo?: string | string[] }> }) {
  const returnTo = safeReturnTo((await searchParams)?.returnTo);
  if (await getUser().catch(() => null)) redirect(returnTo ?? "/account");
  const methods = signInMethods();
  const social = configuredSocialProviders();
  const art = launchArt(await loadSiteAssets())?.background ?? null;
  const providers = methods.battlenet || social.length > 0;
  return (
    <AuthShell
      art={art}
      title="Make an account"
      lede={<p className="text-sm text-fg-2">Free. Save your talent builds and come back to them on any device.</p>}
      footer={(
        <p className="text-sm text-fg-2">
          Already have one? <Link href={returnTo ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}` : "/sign-in"} className={link}>Sign in</Link>.
          {" "}By making an account you agree to the <Link href="/terms" className={link}>Terms</Link> and
          the <Link href="/privacy" className={link}>Privacy Policy</Link>.
        </p>
      )}
    >
      {providers && (
        <div className="space-y-2">
          {methods.battlenet && (
            <>
              <a href={returnTo ? `/api/auth/bnet?returnTo=${encodeURIComponent(returnTo)}` : "/api/auth/bnet"} className={AUTH_BUTTON}>Sign in with Battle.net</a>
              <p className="text-meta text-muted">Play on Battle.net? Your first sign-in makes the account.</p>
            </>
          )}
          <SocialSignIn providers={social} returnTo={returnTo ?? undefined} layout="tiles" />
        </div>
      )}
      {methods.email ? (
        <>
          {providers && <AuthDivider>or with your email</AuthDivider>}
          <EmailAuthForm mode="sign-up" returnTo={returnTo ?? undefined} />
        </>
      ) : <p className="text-fg-2">Email sign-up is not open yet.</p>}
    </AuthShell>
  );
}
