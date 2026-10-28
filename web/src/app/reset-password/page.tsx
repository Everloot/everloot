import type { Metadata } from "next";
import Link from "next/link";
import EmailAuthForm from "@/components/EmailAuthForm";
import { signInMethods } from "@/lib/auth/auth";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Reset your password", description: "Reset the password on your Everloot account.", path: "/reset-password" }),
  robots: { index: false, follow: false },
};

// Without a token: ask for the email. With one (the link in the email lands here): choose the new password.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
  return (
    <article className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold text-fg">Reset your password</h1>
      {!signInMethods().email ? <p className="text-fg-2">Email accounts are not open yet.</p>
        : error ? <p className="text-fg-2">That link has expired or was already used. <Link href="/reset-password" className={link}>Ask for a new one</Link>.</p>
        : token ? <EmailAuthForm mode="reset" token={token} />
        : <EmailAuthForm mode="request-reset" />}
      <p className="text-sm text-fg-2"><Link href="/sign-in" className={link}>Back to sign in</Link></p>
    </article>
  );
}
