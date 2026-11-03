import type { Metadata } from "next";
import { redirect } from "next/navigation";
import DesktopConnect from "@/components/DesktopConnect";
import { signInPath } from "@/lib/auth/return-to";
import { characterLinksOn } from "@/lib/character-links";
import { connectPath, parseConnectRequest } from "@/lib/desktop-connect";
import { pageMetadata } from "@/lib/seo";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Connect the Desktop App", description: "Sign the Everloot Desktop App in to your account.", path: "/desktop/connect" }),
  robots: { index: false, follow: false },
};

type Query = { port?: string | string[]; state?: string | string[]; pub?: string | string[] };

// The Desktop App opens this page with its port, a state and a one-time public key. Signed out, the visitor
// signs in and comes back here; signed in, they confirm and the page hands the app a sealed key.
export default async function DesktopConnectPage({ searchParams }: { searchParams?: Promise<Query> }) {
  const query = (await searchParams) ?? {};
  const request = parseConnectRequest({ port: query.port, state: query.state, pub: query.pub });
  if (!request) {
    return (
      <article className="max-w-xl space-y-4">
        <h1 className="text-3xl font-bold text-fg">Connect the Desktop App</h1>
        <p className="text-fg-2">Open this page from the Everloot Desktop App: press <b>Sign in</b> there and it opens the right link.</p>
      </article>
    );
  }
  let user;
  try { user = await getUser(); } catch {
    return (
      <article className="max-w-xl space-y-4">
        <h1 className="text-3xl font-bold text-fg">Connect the Desktop App</h1>
        <p role="alert" className="text-fg-2">Your account is unavailable right now. Try again in a minute.</p>
      </article>
    );
  }
  if (!user) redirect(signInPath(connectPath(request)));
  return <DesktopConnect request={request} name={user.name} links={characterLinksOn()} />;
}
