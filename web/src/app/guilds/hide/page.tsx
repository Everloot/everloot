import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, Input, PageHeader } from "@/components/ui";
import { guildsOn } from "@/lib/guilds";
import { pageMetadata } from "@/lib/seo";
import { link } from "../parts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Hide a guild", description: "Take a WoW: Forever guild off Everloot's guild pages and ladder. No account needed.", path: "/guilds/hide" }),
  robots: { index: false, follow: false },
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function HideGuildPage(props: { searchParams: Promise<{ guild?: string | string[]; realm?: string | string[]; done?: string | string[]; error?: string | string[] }> }) {
  if (!guildsOn()) notFound();
  const params = await props.searchParams;
  const done = first(params.done) === "1";
  const error = first(params.error);

  return (
    <Container width="reading">
      <article className="space-y-6">
        <PageHeader
          title="Hide a guild"
          lede="Enter the guild's name and realm. Its page, its place on the ladder and its search result are removed, and the kills its members upload are not kept. You do not need an account or an officer rank, and we do not ask who you are, so the hide takes effect as soon as you send it."
          meta={<span>The characters keep their own pages; each can be hidden with the <Link href="/players/opt-out" className={link}>character hide form</Link>. To undo a guild hide, email <a className={link} href="mailto:hello@everloot.app">hello@everloot.app</a>.</span>}
        />

        {done && <p role="status" className="rounded-xl border border-line bg-panel p-4 text-fg">Done. That guild is hidden.</p>}
        {error && <p role="alert" className="rounded-xl border border-line bg-panel p-4 text-fg">
          {error === "limit" ? "Too many requests from this connection. Try again in an hour." : error === "storage" ? "We could not save that. Try again in a moment." : "Check the guild name (2 to 24 characters) and the realm, and send it again."}
        </p>}

        <form action="/api/guilds/hide" method="post" className="max-w-xl space-y-4">
          <div className="space-y-1">
            <label htmlFor="hide-guild" className="text-sm text-fg">Guild name</label>
            <Input id="hide-guild" name="guild" required minLength={2} maxLength={24} autoComplete="off" defaultValue={first(params.guild) ?? ""} />
          </div>
          <div className="space-y-1">
            <label htmlFor="hide-realm" className="text-sm text-fg">Realm</label>
            <Input id="hide-realm" name="realm" required minLength={2} maxLength={40} autoComplete="off" defaultValue={first(params.realm) ?? ""} />
          </div>
          <button type="submit" className="btn btn-primary min-h-11">Hide this guild</button>
        </form>

        <p className="text-sm text-muted">
          <Link href="/guilds" className={link}>Back to guilds</Link> · <Link href="/privacy#player-pages" className={link}>Privacy policy</Link>
        </p>
      </article>
    </Container>
  );
}
