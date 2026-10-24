import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import ApiKeys from "@/components/ApiKeys";
import ChatKeys from "@/components/chat/ChatKeys";
import { Container, DataTitle } from "@/components/ui";
import { loadOverview, type AccountOverview } from "@/lib/account-overview";
import { authV2Enabled, getAuth } from "@/lib/auth/auth";
import { isPlaceholderEmail } from "@/lib/auth/battlenet";
import { signInPath } from "@/lib/auth/return-to";
import { guardOn } from "@/lib/data-guard";
import { playerPagesOn } from "@/lib/player-pages";
import { profilesOn } from "@/lib/profiles";
import { savedBuildsOn } from "@/lib/saved-builds";
import { pageMetadata } from "@/lib/seo";
import { getUser } from "@/lib/supabase/server";
import OverviewRows from "./overview-rows";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Your account", description: "Your Everloot account settings.", path: "/account" }),
  robots: { index: false, follow: false },
};

const link = "text-accent hover:underline underline-offset-4";
const heading = "text-cell font-semibold text-fg";
const section = "scroll-mt-20 space-y-2";

// The Profile section only renders when it holds more than its one sentence; the nav lists what renders.
const sections = (withProfile: boolean) => [
  { id: "overview", label: "Overview" },
  ...(withProfile ? [{ id: "profile", label: "Profile" }] : []),
  { id: "keys", label: "API keys" },
  { id: "chat-keys", label: "Chat keys" },
  { id: "data", label: "Data and privacy" },
];

const listed = (parts: string[]) =>
  parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")}${parts.length > 2 ? "," : ""} and ${parts[parts.length - 1]}`;

// With Better Auth on, the session also carries the email and the sign-in methods.
async function details() {
  if (!authV2Enabled()) return { email: null, methods: ["battlenet"] };
  const requestHeaders = await headers();
  const [session, accounts] = await Promise.all([
    getAuth().api.getSession({ headers: requestHeaders }),
    getAuth().api.listUserAccounts({ headers: requestHeaders }),
  ]);
  const email = session?.user.email;
  return { email: email && !isPlaceholderEmail(email) ? email : null, methods: accounts.map((a) => a.providerId) };
}

export default async function AccountPage() {
  let account;
  try {
    const user = await getUser();
    account = user && { user, ...await details() };
  } catch {
    return (
      <Container width="reading">
        <DataTitle title="Your account" />
        <p role="alert" className="text-fg-2">Your account is unavailable right now. Try again in a minute.</p>
      </Container>
    );
  }
  if (!account) redirect(signInPath("/account"));
  const { user, email, methods } = account;
  // The counts are extras: when they cannot be read, the rest of the page still works.
  let overview: AccountOverview | null = null;
  try {
    overview = await loadOverview(user);
  } catch {}
  const profile = overview?.profile ?? null;
  const kept = [
    "your sign-in details",
    guardOn() && "your API keys with a daily count of their requests",
    savedBuildsOn() && "your saved builds and characters",
    profilesOn() && "your profile",
  ].filter((part): part is string => typeof part === "string");
  const withProfile = Boolean(email || profile || profilesOn() || methods.includes("credential"));
  const privateNote = (
    <p className="text-sm text-fg-2">
      Only you see your account name{email && " and email"}.
      {profilesOn() && " A public profile shows your handle and display name, never these."}
    </p>
  );

  return (
    <Container width="reading">
      <DataTitle title="Your account" />
      <nav aria-label="Account sections" className="mb-6 flex flex-wrap gap-x-4 gap-y-1 border-b border-line pb-2 text-meta">
        {sections(withProfile).map((s) => <a key={s.id} href={`#${s.id}`} className="text-fg-2 hover:text-accent">{s.label}</a>)}
      </nav>

      <div className="space-y-8">
        <section id="overview" aria-labelledby="overview-heading" className={section}>
          <h2 id="overview-heading" className={heading}>Overview</h2>
          <OverviewRows name={user.name} methods={methods} overview={overview} />
          {!overview && <p role="alert" className="text-sm text-fg-2">Some details are unavailable right now. Try again in a minute.</p>}
          {!withProfile && privateNote}
        </section>

        {withProfile && (
          <section id="profile" aria-labelledby="profile-heading" className={section}>
            <h2 id="profile-heading" className={heading}>Profile</h2>
            {(email || profile) && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                {profile && <><dt className="text-muted">Display name</dt><dd className="text-fg">{profile.displayName}</dd></>}
                {email && <><dt className="text-muted">Email</dt><dd className="text-fg">{email}</dd></>}
              </dl>
            )}
            {privateNote}
            <ul className="space-y-1 text-sm">
              {profilesOn() && <li><Link href="/settings" className={link}>Edit your handle, display name and status</Link></li>}
              {methods.includes("credential") && <li><Link href="/reset-password" className={link}>Change your password</Link></li>}
            </ul>
          </section>
        )}

        <section id="keys" aria-labelledby="keys-heading" className="scroll-mt-20 space-y-3">
          <h2 id="keys-heading" className={heading}>API keys</h2>
          <p className="text-sm text-fg-2">
            Keys for the Everloot API and MCP server. How to use them is in <Link href="/docs/api/keys" className={link}>the docs</Link>.
          </p>
          <ApiKeys />
        </section>

        <section id="chat-keys" aria-labelledby="chat-keys-heading" className="scroll-mt-20 space-y-3">
          <h2 id="chat-keys-heading" className={heading}>Chat keys</h2>
          <ChatKeys />
        </section>

        <section id="data" aria-labelledby="data-heading" className={section}>
          <h2 id="data-heading" className={heading}>Data and privacy</h2>
          <p className="text-sm text-fg-2">
            Everloot keeps {listed(kept)}. Chat keys stay in this browser. The{" "}
            <Link href="/privacy" className={link}>Privacy Policy</Link> says what each one holds and how long it is kept.
          </p>
          <ul className="space-y-1 text-sm text-fg-2">
            {guardOn() && <li>Revoke or delete API keys <a href="#keys" className={link}>above</a>.</li>}
            {savedBuildsOn() && <li>Delete saved builds and characters on <Link href="/me" className={link}>My builds</Link>.</li>}
            {profilesOn() && <li>Change your profile or make it private on <Link href="/settings" className={link}>Settings</Link>.</li>}
            {playerPagesOn() && <li>Hide a character&apos;s public player page with the <Link href="/players/opt-out" className={link}>hide form</Link>.</li>}
            <li>
              To delete your account and everything tied to it, email{" "}
              <a href="mailto:hello@everloot.app" className={link}>hello@everloot.app</a>. We answer within a month.
            </li>
          </ul>
        </section>
      </div>
    </Container>
  );
}
