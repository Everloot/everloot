import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import EmailAuthForm from "@/components/EmailAuthForm";
import SocialSignIn from "@/components/SocialSignIn";
import { configuredSocialProviders } from "@/lib/auth/social";
import { signInMethods } from "@/lib/auth/auth";
import { safeReturnTo } from "@/lib/auth/return-to";
import { pageMetadata } from "@/lib/seo";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Make an account", description: "Make a free Everloot account.", path: "/sign-up" }),
  robots: { index: false, follow: true },
};

// `?returnTo=/path` (from the sign-in page) is where the confirmation link brings a new player back to.
export default async function SignUpPage({ searchParams }: { searchParams?: Promise<{ returnTo?: string | string[] }> }) {
  const returnTo = safeReturnTo((await searchParams)?.returnTo);
  if (await getUser().catch(() => null)) redirect(returnTo ?? "/account");
  const methods = signInMethods();
  return (
    <article className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold text-fg">Make an account</h1>
      {methods.battlenet && (
        <p className="text-fg-2">
          Play on Battle.net? <a href={returnTo ? `/api/auth/bnet?returnTo=${encodeURIComponent(returnTo)}` : "/api/auth/bnet"} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Sign in with Battle.net</a>; your
          first sign-in makes the account.
        </p>
      )}
      <SocialSignIn providers={configuredSocialProviders()} returnTo={returnTo ?? undefined} />
      {methods.email
        ? <EmailAuthForm mode="sign-up" returnTo={returnTo ?? undefined} />
        : <p className="text-fg-2">Email sign-up is not open yet.</p>}
      <p className="text-sm text-fg-2">
        Already have one? <Link href={returnTo ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}` : "/sign-in"} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Sign in</Link>.
        {" "}By making an account you agree to the <Link href="/terms" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Terms</Link> and
        the <Link href="/privacy" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Privacy Policy</Link>.
      </p>
    </article>
  );
}
