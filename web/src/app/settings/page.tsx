import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import ApiKeys from "@/components/ApiKeys";
import { className } from "@/components/builds/describe";
import ChatKeys from "@/components/chat/ChatKeys";
import LinkedCharacters from "@/components/LinkedCharacters";
import MainCharacterButton from "@/components/settings/MainCharacterButton";
import ProfileForm from "@/components/settings/ProfileForm";
import StatusForm from "@/components/settings/StatusForm";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Badge, Container, DataTable, type Column } from "@/components/ui";
import YourEverlootHeader from "@/components/YourEverloot";
import { loadOverview, type AccountOverview } from "@/lib/account-overview";
import type { AccountShell, ShellCharacter } from "@/lib/account-shell-types";
import { loadAccountShell, readProfile, toSettings, type ProfileSettings } from "@/lib/account-shell";
import { authV2Enabled, withAuth, signInMethods } from "@/lib/auth/auth";
import { configuredSocialProviders, type SocialProvider } from "@/lib/auth/social";
import { isPlaceholderEmail } from "@/lib/auth/battlenet";
import { signInPath } from "@/lib/auth/return-to";
import { characterLinksOn } from "@/lib/character-links";
import { guardOn } from "@/lib/data-guard";
import { playerPagesOn } from "@/lib/player-pages";
import { profilesOn } from "@/lib/profiles";
import { savedBuildsOn } from "@/lib/saved-builds";
import { getUser } from "@/lib/supabase/server";
import Integrations from "./integrations";
import OverviewRows from "./overview-rows";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your Everloot profile, characters, privacy, connected apps and API keys.",
  alternates: { canonical: "/settings" },
  robots: { index: false, follow: false },
};

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const heading = "text-cell font-semibold text-fg";
const subheading = "text-meta font-semibold text-fg-2";
const section = "scroll-mt-20 space-y-3";

/** The sections, in page order, each with its anchor in the nav. /account and its old anchors land in them. */
const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "characters", label: "Characters & sync" },
  { id: "privacy", label: "Privacy" },
  { id: "integrations", label: "Integrations" },
  { id: "keys", label: "API keys" },
  { id: "danger", label: "Danger zone" },
] as const;

const listed = (parts: string[]) =>
  parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")}${parts.length > 2 ? "," : ""} and ${parts[parts.length - 1]}`;

// With Better Auth on, the session also carries the email and the sign-in methods.
async function details() {
  if (!authV2Enabled()) return { email: null, methods: ["battlenet"] };
  const requestHeaders = await headers();
  const [session, accounts] = await withAuth((auth) => Promise.all([
    auth.api.getSession({ headers: requestHeaders }),
    auth.api.listUserAccounts({ headers: requestHeaders }),
  ]));
  const email = session?.user.email;
  return { email: email && !isPlaceholderEmail(email) ? email : null, methods: accounts.map((a) => a.providerId) };
}

/** The profile form's data with EVERLOOT_PROFILES on; null when it cannot be read, so its parts say so and the rest works. */
async function loadProfile(): Promise<{ shell: AccountShell; profile: ProfileSettings } | null> {
  const shell = await loadAccountShell();
  return shell && { shell, profile: toSettings(await readProfile(shell.userId)) };
}

function Characters({ shell }: { shell: AccountShell }) {
  const buildsEnabled = savedBuildsOn();
  const columns: Column<ShellCharacter>[] = [
    {
      key: "name", header: "Name",
      cell: (c) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          {buildsEnabled
            ? <Link href={`/me/characters/${c.id}`} className={`min-w-0 hover:underline ${CLASS_TEXT[c.classSlug] ?? "text-fg"}`}>{c.name}</Link>
            : <span className={`min-w-0 ${CLASS_TEXT[c.classSlug] ?? "text-fg"}`}>{c.name}</span>}
          {c.id === shell.mainCharacterId && <Badge tone="neutral">Main</Badge>}
        </span>
      ),
    },
    { key: "class", header: "Class", nowrap: true, cell: (c) => <span className="text-fg-2">{className(c.classSlug)}</span> },
    { key: "realm", header: "Realm", cell: (c) => <span className="text-fg-2">{c.realm ?? "–"}</span> },
    {
      key: "main", header: <span className="sr-only">Main character</span>, nowrap: true,
      cell: (c) => <MainCharacterButton characterId={c.id} main={c.id === shell.mainCharacterId} name={c.name} />,
    },
  ];
  return (
    <>
      <DataTable
        dense
        caption="Your characters"
        columns={columns}
        rows={shell.characters}
        rowKey={(c) => c.id}
        meta={(c) => [className(c.classSlug), c.realm].filter(Boolean).join(" · ")}
        empty={<p className="px-3 py-4 text-cell text-muted">No characters yet.</p>}
      />
      <p className="text-sm text-fg-2">
        Your main character colours your avatar and is who you play unless you switch.
        {buildsEnabled && <> Add, rename or delete characters on <Link href="/me" className={link}>My builds</Link>.</>}
      </p>
    </>
  );
}

/**
 * One page for everything about the account (#1278): Profile, Characters & sync, Privacy, Integrations, API keys and
 * Danger zone. /account sends here. Parts behind a switch that is off are left out; a part whose storage fails says
 * so and the rest of the page still works. What lives only in this browser (plans, alts, chat keys) is labelled so.
 */
export default async function SettingsPage({ searchParams }: { searchParams?: Promise<{ linkError?: string | string[] }> }) {
  let account;
  try {
    const user = await getUser();
    account = user && { user, ...await details() };
  } catch {
    return (
      <Container width="reading">
        <YourEverlootHeader current="/settings" title="Settings" />
        <p role="alert" className="text-fg-2">Your settings are unavailable right now. Try again in a minute.</p>
      </Container>
    );
  }
  if (!account) redirect(signInPath("/settings"));
  const { user, email, methods } = account;
  const profiles = profilesOn();
  const builds = savedBuildsOn();
  const links = characterLinksOn();
  const keysOn = guardOn();
  const availableLogins: (SocialProvider | "battlenet")[] = authV2Enabled()
    ? [...(signInMethods().battlenet ? ["battlenet" as const] : []), ...configuredSocialProviders()] : [];
  const linkError = (await searchParams)?.linkError === "1";
  // The overview and the profile are read side by side; when one fails, its parts say so and the rest still works.
  const [overviewRead, profileRead] = await Promise.allSettled([
    loadOverview(user),
    profiles ? loadProfile() : Promise.resolve(null),
  ]);
  const overview: AccountOverview | null = overviewRead.status === "fulfilled" ? overviewRead.value : null;
  const loaded = profileRead.status === "fulfilled" ? profileRead.value : null;
  const profileFailed = profiles && !loaded;
  const kept = [
    "your sign-in details",
    keysOn && "your API keys, with when each was last used and a daily count of their requests",
    builds && "your saved builds and characters",
    profiles && "your profile",
    links && "the characters you linked",
  ].filter((part): part is string => typeof part === "string");

  return (
    <Container width="reading">
      <YourEverlootHeader current="/settings" title="Settings"
        meta={loaded ? (loaded.shell.handle ? `@${loaded.shell.handle}` : "No handle yet") : undefined}
        lede="Your profile, characters, privacy, connected apps and keys." />
      <nav aria-label="Settings sections" className="mb-6 flex flex-wrap gap-x-4 gap-y-1 border-b border-line pb-2 text-meta">
        {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`} className="text-fg-2 hover:text-accent">{s.label}</a>)}
      </nav>

      <div className="space-y-10">
        <section id="profile" aria-labelledby="profile-heading" className={section}>
          <h2 id="profile-heading" className={heading}>Profile</h2>
          <div id="overview" className="scroll-mt-20 space-y-2">
            <OverviewRows name={user.name} methods={methods} overview={overview} />
            {!overview && <p role="alert" className="text-sm text-fg-2">Some details are unavailable right now. Try again in a minute.</p>}
          </div>
          {email && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Email</dt><dd className="text-fg">{email}</dd>
            </dl>
          )}
          <p className="text-sm text-fg-2">
            Only you see your account name{email && " and email"}.
            {profiles && " A public profile shows your handle and display name, never these."}
          </p>
          {methods.includes("credential") && <p className="text-sm"><Link href="/reset-password" className={link}>Change your password</Link></p>}
          {loaded && (
            <>
              <ProfileForm profile={loaded.profile} accountName={loaded.shell.displayName} />
              {loaded.profile.publicProfile && loaded.profile.handle && (
                <p className="text-sm text-fg-2">Your public profile: <Link href={`/u/${loaded.profile.handle}`} className={link}>/u/{loaded.profile.handle}</Link></p>
              )}
              <h3 id="status" className={`${subheading} scroll-mt-20 pt-2`}>Status</h3>
              <StatusForm status={loaded.profile.status} />
            </>
          )}
          {profileFailed && <p role="alert" className="text-sm text-fg-2">Your profile is unavailable right now. Try again in a minute.</p>}
        </section>

        <section id="characters" aria-labelledby="characters-heading" className={section}>
          <h2 id="characters-heading" className={heading}>Characters &amp; sync</h2>
          {loaded && <Characters shell={loaded.shell} />}
          {links && (
            <div id="linked-characters" className="scroll-mt-20 space-y-3">
              <h3 className={subheading}>Linked characters</h3>
              <LinkedCharacters />
            </div>
          )}
          <div className="space-y-1 text-sm">
            <h3 className={subheading}>Sync</h3>
            <p className="text-fg-2">
              The Desktop App uploads what the addon recorded after each logout{builds && " and puts your saved builds in the game"}.
              Whether it is connected is under <a href="#integrations" className={link}>Integrations</a>.
              You can also <Link href="/upload" className={link}>upload a file by hand</Link>.
            </p>
          </div>
          <div id="this-browser" className="scroll-mt-20 space-y-1 text-sm">
            <h3 className={subheading}>On this browser only</h3>
            <p className="text-fg-2">Kept in this browser, not in your account. Other devices do not see them, and clearing this site&apos;s data removes them.</p>
            <ul className="space-y-1">
              <li><Link href="/tools/builds" className={link}>Plans on this device</Link> <span className="text-fg-2">talent plans you keep by name</span></li>
              <li><Link href="/tools/alts" className={link}>Alts on this device</Link> <span className="text-fg-2">your characters and the plans each uses</span></li>
            </ul>
          </div>
        </section>

        <section id="privacy" aria-labelledby="privacy-heading" className={section}>
          <h2 id="privacy-heading" className={heading}>Privacy</h2>
          <p id="data" className="scroll-mt-20 text-sm text-fg-2">
            Everloot keeps {listed(kept)}. Plans and alts on this device, and chat keys, stay in your browser. The{" "}
            <Link href="/privacy" className={link}>Privacy Policy</Link> says what each one holds and how long it is kept.
          </p>
          <ul className="space-y-1 text-sm text-fg-2">
            {profiles && <li>Make your profile public or private, and choose what it shows, in <a href="#profile" className={link}>Profile</a>.</li>}
            {playerPagesOn() && <li>Hide a character&apos;s public player page with the <Link href="/players/opt-out" className={link}>hide form</Link>.</li>}
            {keysOn && <li>A key&apos;s last use is shown only to you. Everloot keeps no record of which app used the key or what it asked.</li>}
          </ul>
        </section>

        <section id="integrations" aria-labelledby="integrations-heading" className="scroll-mt-20 space-y-4">
          <h2 id="integrations-heading" className={heading}>Integrations</h2>
          {linkError && <p role="alert" className="text-sm text-fg">That login could not be linked. Use a provider account with a verified email that is not already linked to another Everloot account.</p>}
          <Integrations methods={methods} name={user.name} overview={overview} availableLogins={availableLogins} />
        </section>

        <section id="keys" aria-labelledby="keys-heading" className={section}>
          <h2 id="keys-heading" className={heading}>API keys</h2>
          <p className="text-sm text-fg-2">
            Keys for the Everloot API and MCP server. How to use them is in <Link href="/docs/api/keys" className={link}>the docs</Link>.
          </p>
          <ApiKeys />
          <div id="chat-keys" className="scroll-mt-20 space-y-3 pt-4">
            <h3 id="chat-keys-heading" className={subheading}>Assistant setup <span className="font-normal text-muted">· this tab only</span></h3>
            <ChatKeys />
          </div>
        </section>

        <section id="danger" aria-labelledby="danger-heading" className={section}>
          <h2 id="danger-heading" className={heading}>Danger zone</h2>
          <div className="space-y-2 rounded-card border border-danger p-4 text-sm text-fg-2">
            <ul className="space-y-1">
              {keysOn && <li>Disconnect an app or revoke a key in <a href="#keys" className={link}>API keys</a>. Anything using it stops at once.</li>}
              {builds && <li>Delete saved builds and characters on <Link href="/me" className={link}>My builds</Link>.</li>}
              {links && <li>Unlink a character in <a href="#linked-characters" className={link}>Linked characters</a>.</li>}
              <li>
                To delete your account and everything tied to it, email{" "}
                <a href="mailto:hello@everloot.app" className={link}>hello@everloot.app</a>. We answer within a month.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </Container>
  );
}
