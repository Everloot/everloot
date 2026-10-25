import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { playerPagesOn } from "@/lib/player-pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Hide a character", description: "Take a WoW: Forever character off Everloot's player pages. No account needed.", path: "/players/opt-out" }),
  robots: { index: false, follow: false },
};

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const field = "w-full min-h-11 rounded-lg border border-edge bg-canvas px-3 text-fg placeholder:text-muted";

export default async function OptOutPage(props: { searchParams: Promise<{ name?: string | string[]; realm?: string | string[]; done?: string | string[]; error?: string | string[] }> }) {
  if (!playerPagesOn()) notFound();
  const params = await props.searchParams;
  const done = first(params.done) === "1";
  const error = first(params.error);

  return (
    <article className="space-y-6 max-w-xl">
      <header className="space-y-3">
        <p className="font-mono text-xs text-muted">WoW: Forever · players</p>
        <h1 className="text-3xl font-bold text-fg tracking-tight">Hide a character</h1>
        <p className="text-sm text-fg-2">
          Enter the character&apos;s name and realm. Its page and its search result are removed, and Everloot does not
          keep it again if the addon sees it later. You do not need an account, and we do not ask who you are, so the
          hide takes effect as soon as you send it. To undo it, email{" "}
          <a className={link} href="mailto:hello@everloot.app">hello@everloot.app</a>.
        </p>
      </header>

      {done && <p role="status" className="rounded-xl border border-line bg-panel p-4 text-fg">Done. That character is hidden.</p>}
      {error && <p role="alert" className="rounded-xl border border-line bg-panel p-4 text-fg">
        {error === "limit" ? "Too many requests from this connection. Try again in an hour." : error === "storage" ? "We could not save that. Try again in a moment." : "Check the name (2 to 12 letters) and the realm, and send it again."}
      </p>}

      <form action="/api/players/opt-out" method="post" className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="opt-name" className="text-sm text-fg">Character name</label>
          <input id="opt-name" name="name" required minLength={2} maxLength={12} autoComplete="off" defaultValue={first(params.name) ?? ""} className={field} />
        </div>
        <div className="space-y-1">
          <label htmlFor="opt-realm" className="text-sm text-fg">Realm</label>
          <input id="opt-realm" name="realm" required minLength={2} maxLength={40} autoComplete="off" defaultValue={first(params.realm) ?? ""} className={field} />
        </div>
        <button type="submit" className="btn btn-primary min-h-11">Hide this character</button>
      </form>

      <p className="text-sm text-muted">
        <Link href="/players" className={link}>Back to player search</Link> · <Link href="/privacy#player-pages" className={link}>Privacy policy</Link>
      </p>
    </article>
  );
}
