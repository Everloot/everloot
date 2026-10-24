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

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  alternates: { canonical: "/settings" },
  robots: { index: false, follow: false },
};

const link = "text-accent hover:underline underline-offset-4";
const heading = "text-cell font-semibold text-fg";

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

  const columns: Column<ShellCharacter>[] = [
    {
      key: "name", header: "Name",
      cell: (c) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          <Link href={`/me/characters/${c.id}`} className={`min-w-0 hover:underline ${CLASS_TEXT[c.classSlug] ?? "text-fg"}`}>{c.name}</Link>
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
      <nav aria-label="Settings sections" className="mb-6 flex flex-wrap gap-x-4 gap-y-1 border-b border-line pb-2 text-meta">
        <a href="#profile" className="text-fg-2 hover:text-accent">Profile</a>
        <a href="#status" className="text-fg-2 hover:text-accent">Status</a>
        <a href="#characters" className="text-fg-2 hover:text-accent">Characters</a>
        <a href="#more" className="text-fg-2 hover:text-accent">More</a>
      </nav>
      <div className="space-y-8">
        <section aria-labelledby="profile" className="scroll-mt-20 space-y-2">
          <h2 id="profile" className={heading}>Profile</h2>
          <ProfileForm profile={profile} accountName={shell.displayName} />
          {profile.publicProfile && profile.handle && (
            <p className="text-sm text-fg-2">Your public profile: <Link href={`/u/${profile.handle}`} className={link}>/u/{profile.handle}</Link></p>
          )}
        </section>

        <section aria-labelledby="status" className="scroll-mt-20 space-y-2">
          <h2 id="status" className={heading}>Status</h2>
          <StatusForm status={profile.status} />
        </section>

        <section aria-labelledby="characters" className="scroll-mt-20 space-y-2">
          <h2 id="characters" className={heading}>Characters</h2>
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
            Your main character colours your avatar and is who you play unless you switch. Add, rename or delete characters on{" "}
            <Link href="/me" className={link}>My builds</Link>.
          </p>
        </section>

        <section aria-labelledby="more" className="scroll-mt-20 space-y-2">
          <h2 id="more" className={heading}>More</h2>
          <ul className="space-y-1 text-sm">
            <li><Link href="/account" className={link}>Your account</Link> <span className="text-fg-2">overview, data and privacy</span></li>
            <li><Link href="/account#keys" className={link}>API keys</Link></li>
            <li><Link href="/account#chat-keys" className={link}>Chat keys</Link></li>
            <li><Link href="/addon" className={link}>Desktop App and addon</Link></li>
          </ul>
        </section>
      </div>
    </Container>
  );
}
