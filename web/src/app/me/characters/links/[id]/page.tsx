import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ShowcaseSections, { ShowcaseHeader } from "@/components/showcase/ShowcaseSections";
import { Card, Container, PageHeader, SectionHeading } from "@/components/ui";
import { signInPath } from "@/lib/auth/return-to";
import { factSections, withFacts } from "@/lib/character-facts";
import { loadFactNames } from "@/lib/character-facts-names";
import { buildShowcase, characterPath, FOOTER_LINE, SECTION_TITLES, type SectionKey } from "@/lib/character-showcase";
import { privateSyncOn, SYNC_CATEGORIES, type SyncCategory } from "@/lib/private-sync";
import { ownCharacterFacts, ownSyncedLink, type OwnCategory, type OwnSyncedLink } from "@/lib/private-sync-store";
import { validId } from "@/lib/saved-builds";
import { getUser } from "@/lib/supabase/server";

/**
 * /me/characters/links/<id>: the signed-in preview of one of the account's linked characters, with everything it
 * synced, switched on for the public page or not (showcase plan S5). Only the account that holds the link sees it;
 * any other id is a 404. Read on every request, never cached and never indexed. 404 until EVERLOOT_PRIVATE_SYNC=1.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Character preview", robots: { index: false, follow: false } };

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
/** The section each category fills on the page. */
const SECTION: Record<SyncCategory, SectionKey> = {
  gear: "gear", stats: "stats", talents: "talents", pvp: "pvp", professions: "professions", reputations: "reputations", raids: "raids", achievements: "collections",
};

type Params = { params: Promise<{ id: string }> };

function Settings({ link: l, categories }: { link: OwnSyncedLink; categories: OwnCategory[] }) {
  const by = new Map(categories.map((c) => [c.category, c]));
  return (
    <section aria-labelledby="sync-settings" className="space-y-2">
      <SectionHeading id="sync-settings">Sync and public sections</SectionHeading>
      <Card>
        <ul className="space-y-1 text-sm">
          {SYNC_CATEGORIES.map((category) => {
            const c = by.get(category);
            const sync = c?.consented === true;
            const shown = l.shown[category];
            return (
              <li key={category} data-category={category} data-sync={sync ? "on" : "off"} data-public={shown ? "on" : "off"}
                className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line py-1">
                <span className="text-fg">{SECTION_TITLES[SECTION[category]]}{category === "achievements" ? " (achievements and titles)" : ""}</span>
                <span className="text-fg-2">
                  Sync {sync ? "on" : "off"} · Public {shown && l.pagePublic ? "on" : shown ? "on once the page is public" : "off"}
                  {c?.fact ? <> · Captured <span className="font-mono">{c.fact.capturedAt.slice(0, 10)}</span></> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

export default async function LinkPreviewPage({ params }: Params) {
  if (!privateSyncOn()) notFound();
  const { id } = await params;
  if (!validId(id)) notFound();
  const user = await getUser();
  if (!user) redirect(signInPath(`/me/characters/links/${id}`));
  let found: OwnSyncedLink | null;
  let categories: OwnCategory[] = [];
  try {
    found = await ownSyncedLink(user.id, id);
    if (found) categories = await ownCharacterFacts(user.id, id);
  } catch {
    return (
      <Container width="reading">
        <PageHeader trail={[{ name: "Home", path: "/" }]} title="Character preview" />
        <p role="alert" className="text-fg-2">Your character is unavailable right now. Try again in a minute.</p>
      </Container>
    );
  }
  if (!found) notFound();
  const c = found;
  const facts = categories.flatMap((x) => (x.fact ? [x.fact] : []));
  const now = new Date();
  const path = characterPath(c.ruleset, c.realm, c.name);
  const showcase = buildShowcase(withFacts({
    sample: false, path, name: c.name, level: c.level, race: c.race, class: c.class, faction: c.faction, realm: c.realm, title: null, guild: null,
    lastUpload: new Date(c.lastUploadAt).toISOString().slice(0, 10),
    gear: { state: "empty" }, stats: { state: "unsupported" }, talents: { state: "empty" }, pvp: { state: "empty" }, professions: { state: "empty" }, reputations: { state: "empty" },
    raids: { state: "empty" }, collections: { state: "empty" },
  }, facts.length ? factSections(facts, await loadFactNames(facts, c.class), now) : {}), now);
  return (
    <Container width="reading">
      <article className="space-y-8">
        <ShowcaseHeader showcase={showcase} trail={[{ name: "Home", path: "/" }, { name: "Account", path: "/account" }, { name: c.name, path: `/me/characters/links/${id}` }]} />
        <Card className="space-y-2 text-sm text-fg-2">
          <p>
            Only you see this preview. It shows everything synced for this character. The public page,{" "}
            <Link href={path} className={link}>{path}</Link>, shows only the sections you switch on, and only while the page itself is on.
          </p>
          {c.status === "frozen" && (
            <p role="status">
              This character is frozen: another account also linked it. Nothing synced is kept or shown for it until we look at it.
            </p>
          )}
        </Card>
        <Settings link={c} categories={categories} />
        <div className="space-y-8" data-part="preview">
          {c.status === "linked" && <ShowcaseSections showcase={showcase} preview />}
          <p className="text-sm text-fg-2">{FOOTER_LINE}</p>
        </div>
      </article>
    </Container>
  );
}
