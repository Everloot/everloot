import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Landing from "../page";
import BuildsTable from "@/components/builds/BuildsTable";
import { className, describeBuilds } from "@/components/builds/describe";
import Avatar from "@/components/home/Avatar";
import CharacterSwitch from "@/components/home/CharacterSwitch";
import Greeting from "@/components/home/Greeting";
import LaunchCountdown from "@/components/LaunchCountdown";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import type { AccountShell } from "@/lib/account-shell-types";
import { loadAccountShell } from "@/lib/account-shell";
import { ADD_FROM_COOKIE } from "@/lib/auth/device-accounts";
import { filterTimeline, loadTimeline, TYPE_LABEL } from "@/lib/changes";
import { postPath } from "../../../../kb/src/blue-pages";
import { HOME_REWRITE_HEADER, profilesOn } from "@/lib/profiles";
import { editPath, savedBuildsOn, type AccountBuilds } from "@/lib/saved-builds";
import { listOwn } from "@/lib/saved-builds-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Home",
  alternates: { canonical: "/" },
  robots: { index: false, follow: false },
};

const QUICK_ACTIONS = [
  { href: "/tools/talents", label: "Plan a build" },
  { href: "/database/items", label: "Find an item" },
  { href: "/tools/auctions", label: "Auction House" },
  { href: "/upload", label: "Upload addon data" },
];
const rail = "text-meta font-semibold text-muted";
const railLink = "block truncate rounded-control px-2 py-1 text-cell text-fg-2 hover:bg-panel hover:text-fg";

/**
 * The signed-in home. Visitors never see this route: the middleware rewrites `/` here only when a session cookie
 * is present, and `/` stays the cached landing page. A cookie with no session behind it gets the landing too.
 */
export default async function SignedInHome({ searchParams }: { searchParams?: Promise<{ added?: string | string[] }> }) {
  if (!profilesOn()) notFound();
  const buildsEnabled = savedBuildsOn();
  let loaded: { shell: AccountShell | null; saved: AccountBuilds };
  try {
    const found = await loadAccountShell();
    loaded = { shell: found, saved: found && buildsEnabled ? await listOwn(found.userId) : { characters: [], builds: [] } };
  } catch {
    // Storage trouble: `/` still answers with the landing page.
    return <Landing />;
  }
  const { shell, saved } = loaded;
  if (!shell) {
    if ((await headers()).get(HOME_REWRITE_HEADER)) return <Landing />;
    redirect("/");
  }

  const active = buildsEnabled ? shell.characters.find((c) => c.id === shell.activeCharacterId) ?? null : null;
  const main = shell.characters.find((c) => c.id === shell.mainCharacterId) ?? null;
  const activeBuilds = active ? saved.builds.filter((b) => b.characterId === active.id) : [];
  const facts = await describeBuilds(activeBuilds);
  const latest = filterTimeline(await loadTimeline(), "all", "forever").slice(0, 5);
  // Back from "Add another account" through Battle.net as an account that was already here: Battle.net kept the
  // earlier login and signed it in again.
  const sameAccount = (await searchParams)?.added === "bnet"
    && ((await cookies()).get(ADD_FROM_COOKIE)?.value ?? "").split(",").includes(shell.userId);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,18rem)]">
      <aside aria-label="Your account" className="space-y-5">
        <div className="flex items-start gap-3">
          <Avatar name={shell.displayName} classSlug={main?.classSlug ?? null} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-fg">{shell.displayName}</p>
            {shell.handle
              ? <p className="truncate text-meta text-muted">@{shell.handle}</p>
              : <Link href="/settings" className="text-meta text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Choose a handle</Link>}
            {shell.status && <p className="truncate text-meta text-fg-2">{shell.status.emoji} {shell.status.text}</p>}
          </div>
        </div>
        {buildsEnabled && <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-cell">
            <span className="block text-meta text-muted">Playing</span>
            {active
              ? <span className={`block truncate font-semibold ${CLASS_TEXT[active.classSlug] ?? "text-fg"}`}>{active.name}</span>
              : <Link href="/me" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Add a character</Link>}
          </p>
          <CharacterSwitch characters={shell.characters} activeId={active?.id ?? null} />
        </div>}
        <nav aria-label="Home">
          <Link href="/" aria-current="page" className={`${railLink} text-fg`}>Home</Link>
          <Link href="/changes" className={railLink}>Feed</Link>
        </nav>
        {buildsEnabled && <section aria-labelledby="your-characters" className="space-y-1">
          <h2 id="your-characters" className={rail}>Your characters</h2>
          {shell.characters.length === 0
            ? <p className="text-cell text-muted">None yet. <Link href="/me" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Add one</Link></p>
            : (
              <ul>
                {shell.characters.map((c) => (
                  <li key={c.id}>
                    <Link href={`/me/characters/${c.id}`} className={`${railLink} flex items-center justify-between gap-2`}>
                      <span className={`truncate ${CLASS_TEXT[c.classSlug] ?? "text-fg"}`}>{c.name}</span>
                      {c.id === shell.mainCharacterId && <span className="text-meta text-muted">Main</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </section>}
        {buildsEnabled && <section aria-labelledby="recent-builds" className="space-y-1">
          <h2 id="recent-builds" className={rail}>Recent builds</h2>
          {saved.builds.length === 0
            ? <p className="text-cell text-muted">None yet. <Link href="/tools/talents" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Plan one</Link></p>
            : (
              <ul>
                {saved.builds.slice(0, 5).map((b) => (
                  <li key={b.id}><a href={editPath(b)} className={railLink}>{b.name}</a></li>
                ))}
              </ul>
            )}
        </section>}
      </aside>

      <section aria-label="Start" className="order-first min-w-0 space-y-5 lg:order-none">
        {sameAccount && (
          <p role="status" className="rounded-control border border-line bg-panel px-3 py-2 text-cell text-fg-2">
            You&apos;re already signed in as {shell.displayName}. To add a different Battle.net account, sign out at battle.net first, then try again.
          </p>
        )}
        <Greeting name={shell.displayName} />
        <form action="/chat" method="get" role="search" aria-label="Ask anything" className="flex gap-2">
          <label htmlFor="ask" className="sr-only">Ask anything</label>
          <input id="ask" name="q" required maxLength={500} autoComplete="off"
            placeholder={active ? `Ask anything. Chat knows you're on ${active.name}.` : "Ask anything about WoW: Forever"}
            className="min-h-11 w-full min-w-0 rounded-control border border-edge bg-canvas px-3 py-2 text-base text-fg placeholder:text-muted focus:border-accent" />
          {active && <input type="hidden" name="character" value={active.id} />}
          <button type="submit" className="btn btn-primary min-h-11 shrink-0 px-4 text-sm">Ask</button>
        </form>
        <ul aria-label="Quick actions" className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((a) => <li key={a.href}><Link href={a.href} className="btn min-h-9 px-3 text-sm">{a.label}</Link></li>)}
        </ul>
        {buildsEnabled && <section aria-labelledby="active-builds" className="space-y-2">
          <h2 id="active-builds" className="text-cell font-semibold text-fg">
            {active ? <>Builds for <span className={CLASS_TEXT[active.classSlug] ?? ""}>{active.name}</span></> : "Your builds"}
          </h2>
          {!active ? (
            <p className="text-cell text-muted">Add a character on <Link href="/me" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">My builds</Link> to see its builds here.</p>
          ) : activeBuilds.length === 0 ? (
            <p className="text-cell text-muted">
              No builds for this {className(active.classSlug).toLowerCase()} yet.{" "}
              <Link href={`/tools/talents/${active.classSlug}`} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Plan one</Link>
            </p>
          ) : (
            <BuildsTable builds={activeBuilds} facts={facts} caption={`Builds for ${active.name}`} onCharacterPage />
          )}
        </section>}
      </section>

      <aside aria-label="Latest from Forever" className="space-y-5">
        <section aria-labelledby="latest" className="space-y-1">
          <h2 id="latest" className={rail}>Latest from Forever</h2>
          <ol>
            {latest.map((e) => (
              <li key={e.id} className="border-b border-line py-1.5">
                <p className="text-meta text-muted">{TYPE_LABEL[e.type]} · <time dateTime={e.at}>{e.at.slice(0, 10)}</time></p>
                {postPath(e)
                  ? <Link href={postPath(e)!} className="text-cell text-blue-post [overflow-wrap:anywhere] hover:underline underline-offset-4">{e.title}</Link>
                  : <Link href="/changes" className="text-cell text-fg [overflow-wrap:anywhere] hover:text-accent">{e.title}</Link>}
              </li>
            ))}
          </ol>
          <Link href="/changes" className="text-meta text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">All changes</Link>
        </section>
        <LaunchCountdown />
      </aside>
    </div>
  );
}
