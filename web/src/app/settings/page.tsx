import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { className } from "@/components/builds/describe";
import MainCharacterButton from "@/components/settings/MainCharacterButton";
import ProfileForm from "@/components/settings/ProfileForm";
import StatusForm from "@/components/settings/StatusForm";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Badge, Container, DataTable, DataTitle, type Column } from "@/components/ui";
import type { AccountShell, ShellCharacter } from "@/lib/account-shell-types";
import { loadAccountShell, readProfile, toSettings, type ProfileSettings } from "@/lib/account-shell";
import { signInPath } from "@/lib/auth/return-to";
import { profilesOn } from "@/lib/profiles";
import { savedBuildsOn } from "@/lib/saved-builds";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  alternates: { canonical: "/settings" },
  robots: { index: false, follow: false },
};

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";
const heading = "scroll-mt-20 text-base font-semibold text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";
const sectionLink = "inline-flex min-h-11 items-center rounded-control px-3 text-fg-2 transition-colors hover:bg-panel hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The player's profile, status and characters, with links to their keys and the Desktop App. */
export default async function SettingsPage() {
  if (!profilesOn()) notFound();
  let loaded: { shell: AccountShell; profile: ProfileSettings } | null;
  try {
    const shell = await loadAccountShell();
    loaded = shell && { shell, profile: toSettings(await readProfile(shell.userId)) };
  } catch {
    return (
      <Container>
        <DataTitle title="Settings" />
        <p role="alert" className="text-fg-2">Your settings are unavailable right now. Try again in a minute.</p>
      </Container>
    );
  }
  if (!loaded) redirect(signInPath("/settings"));
  const { shell, profile } = loaded;
  const buildsEnabled = savedBuildsOn();

  const columns: Column<ShellCharacter>[] = [
    {
      key: "name", header: "Name",
      cell: (c) => (
        <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
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
    <Container>
      <DataTitle title="Settings" meta={shell.handle ? `@${shell.handle}` : "No handle yet"} />
      <nav aria-label="Settings sections" className="mb-8 flex flex-wrap gap-1 border-b border-line pb-3 text-sm">
        <a href="#profile" className={sectionLink}>Profile</a>
        <a href="#status" className={sectionLink}>Status</a>
        <a href="#characters" className={sectionLink}>Characters</a>
        <a href="#more" className={sectionLink}>Account</a>
      </nav>
      <div className="max-w-3xl space-y-8 [overflow-wrap:anywhere]">
        <section aria-labelledby="profile" className="min-w-0 space-y-4 border-b border-line pb-8">
          <h2 id="profile" tabIndex={-1} className={heading}>Profile</h2>
          <ProfileForm profile={profile} accountName={shell.displayName} />
          {profile.publicProfile && profile.handle && (
            <p className="text-sm text-fg-2">Your public profile: <Link href={`/u/${profile.handle}`} className={link}>/u/{profile.handle}</Link></p>
          )}
        </section>

        <section aria-labelledby="status" className="min-w-0 space-y-4 border-b border-line pb-8">
          <h2 id="status" tabIndex={-1} className={heading}>Status</h2>
          <StatusForm status={profile.status} />
        </section>

        <section aria-labelledby="characters" className="min-w-0 space-y-4 border-b border-line pb-8">
          <h2 id="characters" tabIndex={-1} className={heading}>Characters</h2>
          <DataTable
            dense
            caption="Your characters"
            columns={columns}
            rows={shell.characters}
            rowKey={(c) => c.id}
            meta={(c) => <>
              <p>{[className(c.classSlug), c.realm].filter(Boolean).join(" · ")}</p>
              <MainCharacterButton characterId={c.id} main={c.id === shell.mainCharacterId} name={c.name} />
            </>}
            empty={<p className="px-3 py-4 text-cell text-muted">No characters yet.</p>}
          />
          <p className="text-sm text-fg-2">
            Your main character colours your avatar and is who you play unless you switch.
            {buildsEnabled && <> Add, rename or delete characters on <Link href="/me" className={link}>My builds</Link>.</>}
          </p>
        </section>

        <section aria-labelledby="more" className="min-w-0 space-y-4">
          <h2 id="more" tabIndex={-1} className={heading}>Account</h2>
          <ul className="divide-y divide-line text-sm">
            <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 first:pt-0"><Link href="/account" className={link}>Your account</Link> <span className="text-fg-2">overview, data and privacy</span></li>
            <li className="py-3"><Link href="/account#keys" className={link}>API keys</Link></li>
            <li className="py-3"><Link href="/account#chat-keys" className={link}>Assistant setup</Link></li>
            <li className="py-3"><Link href="/addon" className={link}>Desktop App and addon</Link></li>
          </ul>
        </section>
      </div>
    </Container>
  );
}
