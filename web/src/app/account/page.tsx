import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The account page is a section of /settings now (#1278). Old links keep working: the query (a social link's
 * linkError) comes along, and the browser keeps the #fragment across the redirect, so /account#keys lands on
 * /settings#keys. Every old anchor (overview, profile, characters, integrations, sign-in-methods, keys, chat-keys,
 * data) is still on /settings.
 */
export default async function AccountPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries((await searchParams) ?? {})) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(name, one);
  }
  const query = params.toString();
  redirect(query ? `/settings?${query}` : "/settings");
}
