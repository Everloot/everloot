import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Landing from "../page";
import BuildsTable from "@/components/builds/BuildsTable";
import { className, describeBuilds } from "@/components/builds/describe";
import { publishedClassChanges } from "@/lib/talents/freshness-records";
import Avatar from "@/components/home/Avatar";
import CharacterSwitch from "@/components/home/CharacterSwitch";
import StartHere from "@/components/start/StartHere";
import Greeting from "@/components/home/Greeting";
import LaunchCountdown from "@/components/LaunchCountdown";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Badge, Card, GET_THE_ADDON } from "@/components/ui";
import Coins from "@/components/ui/Coins";
import { day } from "@/app/armory/parts";
import type { AccountShell, ShellCharacter } from "@/lib/account-shell-types";
import { loadAccountShell } from "@/lib/account-shell";
import { armoryCharacterPath, regionLabel } from "@/lib/armory";
import type { ArmoryCharacter } from "@/lib/armory-store";
import { ADD_FROM_COOKIE } from "@/lib/auth/device-accounts";
import { ownArmoryCharacters } from "@/lib/character-armory";
import { characterLinksOn } from "@/lib/character-links";
import { filterTimeline, loadTimeline, TYPE_LABEL, type ChangeEntry } from "@/lib/changes";
import { ownGold } from "@/lib/own-gold";
import { postPath } from "@kb/blue-pages";
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
  { href: "/upload", label: "Upload addon data" },
];
const rail = "text-meta font-semibold text-muted";
const railLink = "block truncate rounded-control px-2 py-1 text-cell text-fg-2 hover:bg-panel hover:text-fg";
const textLink = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

const savedCount = (n: number) => n === 0 ? "No saved builds" : n === 1 ? "1 saved build" : `${n} saved builds`;
const placeLine = (c: ShellCharacter) => [className(c.classSlug), c.realm].filter(Boolean).join(" · ");

/** When a linked character was last seen: its last login or the addon's last sighting, whichever is later. */
const seenAt = (c: ArmoryCharacter) => Math.max(Date.parse(c.lastLogin ?? "") || 0, Date.parse(c.addonSeen ?? "") || 0);
const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/**
 * The hero among the linked characters: the one named like the account's main character, else the one seen most
 * recently. Null without linked characters.
 */
function heroOf(linked: readonly ArmoryCharacter[], main: ShellCharacter | null): { hero: ArmoryCharacter; isMain: boolean } | null {
  const named = main ? linked.find((c) => sameName(c.name, main.name)) : undefined;
  if (named) return { hero: named, isMain: true };
  const recent = [...linked].sort((a, b) => seenAt(b) - seenAt(a))[0];
  return recent ? { hero: recent, isMain: false } : null;
}

/** One compact alt: its avatar, name in its class colour and one line under it. */
function AltCard({ href, name, classSlug, line }: { href: string; name: string; classSlug: string; line: string }) {
  return (
    <Link href={href} className="flex min-h-11 min-w-0 items-center gap-3 rounded-control border border-line px-3 py-2 hover:border-accent">
      <Avatar name={name} classSlug={classSlug} size={28} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-cell font-semibold ${CLASS_TEXT[classSlug] ?? "text-fg"}`}>{name}</span>
        <span className="block truncate text-meta text-muted">{line}</span>
      </span>
    </Link>
  );
}

/** The linked hero's sheet summary from its armory row, and its gold only when the owner's own sync supplied it. */
function LinkedHero({ hero, isMain, gold }: { hero: ArmoryCharacter; isMain: boolean; gold: Record<string, number> | undefined }) {
  const classSlug = hero.class.toLowerCase();
  const login = day(hero.lastLogin);
  const acquired = gold?.["328"], most = gold?.["334"];
  return (
    <Card href={armoryCharacterPath(hero.region, hero.slug)} padding="none">
      <div className="flex min-w-0 items-start gap-4 p-4">
        <Avatar name={hero.name} classSlug={classSlug} size={48} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="flex min-w-0 items-center gap-2">
            <span className={`truncate text-base font-semibold ${CLASS_TEXT[classSlug] ?? "text-fg"}`}>{hero.name} {hero.surname}</span>
            {isMain && <Badge tone="neutral">Main</Badge>}
          </p>
          <p className="truncate text-meta text-fg-2">Level {hero.level} {hero.race} {hero.class}</p>
          <p className="truncate text-meta text-muted">{hero.faction} · {regionLabel(hero.region)} {hero.ruleset}{login && <> · Last login {login}</>}</p>
          {hero.itemLevel !== null && <p className="text-meta text-fg-2">Item level <span className="font-mono tabular-nums">{hero.itemLevel}</span></p>}
          {(acquired !== undefined || most !== undefined) && (
            <p className="text-meta text-fg-2">
              {acquired !== undefined && <>Total gold acquired <Coins copper={acquired} /></>}
              {acquired !== undefined && most !== undefined && " · "}
              {most !== undefined && <>Most gold ever owned <Coins copper={most} /></>}
              <span className="block text-muted">Only you see your gold.</span>
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Characters first. With linked characters (the armory rows the account's links are associated with), the hero is the
 * main or the most recently seen one, with its sheet summary; the other linked characters and the added characters no
 * link covers are the alts. Without them, the main added character's card leads as before. With no character at all,
 * one card: install the addon and connect the Desktop App. Completion % is not shown: completion is read per install,
 * not per character.
 */
function YourCharacters({ shell, characters, builds, linked, gold }: {
  shell: AccountShell; characters: ShellCharacter[]; builds: AccountBuilds["builds"]; linked: ArmoryCharacter[];
  gold: Map<string, Record<string, number>> | null;
}) {
  if (characters.length === 0 && linked.length === 0) {
    return (
      <Card as="section" aria-labelledby="your-characters" className="space-y-4">
        <div className="space-y-1">
          <h2 id="your-characters" className="text-base font-semibold text-fg">Bring in your characters</h2>
          <p className="text-cell text-fg-2">Install the Everloot addon and connect the Desktop App to your account, and your characters come in as you play.</p>
        </div>
        <Link href={GET_THE_ADDON.href} className="btn btn-primary min-h-11 px-4 text-sm">Install addon + Connect</Link>
        <p className="text-meta text-muted">
          Already installed? <Link href="/desktop/connect" className={textLink}>Connect the Desktop App</Link>, or <Link href="/me" className={textLink}>add a character by name</Link>.
        </p>
      </Card>
    );
  }
  const main = characters.find((c) => c.id === shell.mainCharacterId) ?? null;
  const linkedHero = heroOf(linked, main);
  const first = linkedHero ? null : main ?? characters[0];
  const count = (id: string) => builds.filter((b) => b.characterId === id).length;
  const linkedAlts = linked.filter((c) => c !== linkedHero?.hero);
  const addedAlts = characters.filter((c) => c.id !== first?.id && !linked.some((l) => sameName(l.name, c.name)));
  return (
    <section aria-labelledby="your-characters" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="your-characters" className="text-cell font-semibold text-fg">Your characters</h2>
        <Link href="/me" className={`text-meta ${textLink}`}>Manage</Link>
      </div>
      {linkedHero && <LinkedHero hero={linkedHero.hero} isMain={linkedHero.isMain} gold={gold?.get(armoryCharacterPath(linkedHero.hero.region, linkedHero.hero.slug))} />}
      {first && <Card href={`/me/characters/${first.id}`} padding="none">
        <div className="flex min-w-0 items-center gap-4 p-4">
          <Avatar name={first.name} classSlug={first.classSlug} size={48} />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-2">
              <span className={`truncate text-base font-semibold ${CLASS_TEXT[first.classSlug] ?? "text-fg"}`}>{first.name}</span>
              {main && <Badge tone="neutral">Main</Badge>}
            </p>
            <p className="truncate text-meta text-fg-2">{placeLine(first)}</p>
            <p className="text-meta text-muted">{savedCount(count(first.id))}</p>
          </div>
        </div>
      </Card>}
      {linkedAlts.length + addedAlts.length > 0 && (
        <ul aria-label="Alts" className="grid gap-2 sm:grid-cols-2">
          {linkedAlts.map((c) => (
            <li key={`${c.region}/${c.slug}`} className="min-w-0">
              <AltCard href={armoryCharacterPath(c.region, c.slug)} name={c.name} classSlug={c.class.toLowerCase()} line={`Level ${c.level} ${c.class}`} />
            </li>
          ))}
          {addedAlts.map((c) => (
            <li key={c.id} className="min-w-0"><AltCard href={`/me/characters/${c.id}`} name={c.name} classSlug={c.classSlug} line={placeLine(c)} /></li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Forever blue posts Everloot has read since the hero's last login, newest first; nothing without a login. */
function SinceLastPlayed({ login, posts }: { login: string; posts: ChangeEntry[] }) {
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby="since-last-played" className="space-y-1">
      <h2 id="since-last-played" className="text-cell font-semibold text-fg">Since you last played</h2>
      <p className="text-meta text-muted">New blue posts since your last login on <time dateTime={login}>{day(login)}</time>.</p>
      <ul>
        {posts.map((e) => (
          <li key={e.id} className="border-b border-line py-1.5">
            {postPath(e)
              ? <Link href={postPath(e)!} className="text-cell text-blue-post [overflow-wrap:anywhere] hover:underline underline-offset-4">{e.title}</Link>
              : <Link href="/changes" className="text-cell text-fg [overflow-wrap:anywhere] hover:text-accent">{e.title}</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}

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
  const facts = await describeBuilds(activeBuilds, publishedClassChanges);
  const forever = filterTimeline(await loadTimeline(), "all", "forever");
  const latest = forever.slice(0, 5);
  // The account's linked characters and their synced gold, read only while character links are on. A failed read
  // (null) shows no linked character rather than taking the home down.
  const [linked, gold] = characterLinksOn()
    ? await Promise.all([ownArmoryCharacters(shell.userId), ownGold(shell.userId)])
    : [null, null];
  const ownLinked = linked ?? [];
  const hero = heroOf(ownLinked, buildsEnabled ? main : null)?.hero ?? null;
  const login = hero?.lastLogin && Number.isFinite(Date.parse(hero.lastLogin)) ? hero.lastLogin : null;
  const sincePosts = login ? forever.filter((e) => e.type === "post" && Date.parse(e.at) > Date.parse(login)).slice(0, 5) : [];
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
        {buildsEnabled && saved.builds.length > 0 && <section aria-labelledby="recent-builds" className="space-y-1">
          <h2 id="recent-builds" className={rail}>Recent builds</h2>
          <ul>
            {saved.builds.slice(0, 5).map((b) => (
              <li key={b.id}><a href={editPath(b)} className={railLink}>{b.name}</a></li>
            ))}
          </ul>
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
        {(buildsEnabled || ownLinked.length > 0) && (
          <YourCharacters shell={shell} characters={buildsEnabled ? shell.characters : []} builds={saved.builds} linked={ownLinked} gold={gold} />
        )}
        {login && <SinceLastPlayed login={login} posts={sincePosts} />}
        <ul aria-label="Quick actions" className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((a) => <li key={a.href}><Link href={a.href} className="btn min-h-9 px-3 text-sm">{a.label}</Link></li>)}
        </ul>
        <StartHere compact />
        {active && (activeBuilds.length > 0 ? (
          <section aria-labelledby="active-builds" className="space-y-2">
            <h2 id="active-builds" className="text-cell font-semibold text-fg">
              Builds for <span className={CLASS_TEXT[active.classSlug] ?? ""}>{active.name}</span>
            </h2>
            <BuildsTable builds={activeBuilds} facts={facts} caption={`Builds for ${active.name}`} onCharacterPage />
          </section>
        ) : (
          <p><Link href={`/tools/talents/${active.classSlug}`} className="btn min-h-11 px-4 text-sm">Plan a build for {active.name}</Link></p>
        ))}
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
