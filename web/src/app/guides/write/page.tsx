import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import GuideEditor from "@/components/guides/GuideEditor";
import { Container, DataTitle, Prose, SectionHeading } from "@/components/ui";
import { signInPath } from "@/lib/auth/return-to";
import {
  GUIDE_LIMITS, GUIDE_STATUS_LABEL, WRITE_PATH, draftBlocks, emptyDraft, guideAuthor, guideEditorOptions, guideSubmissionsOn, listOwnGuides,
  newestRevision, previewLinkable, submissionProblems, type GuideAuthor, type GuideRevision, type OwnGuide,
} from "@/lib/guide-submissions";
import { validId } from "@/lib/saved-builds";
import { getUser, type AccountUser } from "@/lib/supabase/server";
import { loadWiki, publishedPage, type Block } from "@/lib/wiki";
import { resolveTokens } from "@/lib/wiki-names";
import { WikiBlock, type TextContext } from "../../wiki/wiki-text";

// A player's own community guides: the list, the editor, and a preview of the saved draft drawn by the guides' own
// renderer, with what must change before it can be submitted. Private to the signed-in account, never indexed, and a 404
// with EVERLOOT_GUIDE_SUBMISSIONS off. It is one of the protected pages (data/protected-paths.json): no ads or analytics
// load beside the drafts, the strict Content-Security-Policy applies, and a move to or from a public page reloads the
// document first. Nothing here is published: the public guides are still the reviewed files in kb/guides.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Write a guide",
  alternates: { canonical: WRITE_PATH },
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ guide?: string | string[] }> };

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const heading = "text-cell font-semibold text-fg";

interface Preview { revision: GuideRevision; blocks: Block[]; ctx: TextContext; problems: string[] }
interface Loaded {
  user: AccountUser;
  guides: OwnGuide[];
  author: GuideAuthor;
  /** The guide asked for, with its newest revision drawn for its writer. */
  open: { guide: OwnGuide; preview: Preview | null } | null;
}

/** Everything the page reads: null when signed out, "unknown" for a guide that is not the account's. Throws when storage fails. */
async function load(asked: string | null): Promise<Loaded | "unknown" | null> {
  const user = await getUser();
  if (!user) return null;
  const [guides, author] = await Promise.all([listOwnGuides(user.id), guideAuthor(user.id)]);
  if (asked === null) return { user, guides, author, open: null };
  const guide = guides.find((g) => g.id === asked);
  if (!guide) return "unknown";
  const revision = await newestRevision(user.id, guide.id);
  if (!revision) return { user, guides, author, open: { guide, preview: null } };
  const blocks = draftBlocks(revision.draft.body);
  const wiki = loadWiki();
  const [tokens, problems] = await Promise.all([resolveTokens({ blocks }), submissionProblems(revision.draft, author)]);
  const ctx: TextContext = { tokens, pages: (slug) => publishedPage(wiki, slug), linkable: (href) => previewLinkable(href, revision.draft.sources) };
  return { user, guides, author, open: { guide, preview: { revision, blocks, ctx, problems } } };
}

/** The saved words as a guide page would draw them, to their writer only: links only to this site or the draft's own sources. */
function DraftPreview({ preview: { revision, blocks, ctx, problems }, author }: { preview: Preview; author: GuideAuthor }) {
  const { draft } = revision;
  return (
    <section aria-labelledby="preview" className="mt-12 max-w-3xl space-y-4 border-t border-line pt-8">
      <SectionHeading id="preview" note={`Revision ${revision.revision}, ${GUIDE_STATUS_LABEL[revision.status].toLowerCase()}, as a guide page draws it. Only you can see it.`}>
        Preview
      </SectionHeading>
      <article className="space-y-3">
        <h3 className="text-2xl font-semibold tracking-tight text-fg [overflow-wrap:anywhere]">{draft.title}</h3>
        {draft.summary && <p className="text-fg-2">{draft.summary}</p>}
        <p className="text-sm text-fg-2">
          {author.handle
            ? <>By @{author.handle}</>
            : <>No author name yet: <Link href="/settings" className={link}>choose a handle</Link> to submit. A guide names its author by handle, never by BattleTag.</>}
        </p>
        <Prose>
          {blocks.map((b, i) => (b.type === "heading" && b.level === 2
            ? <h4 key={i} className="pt-4 text-lg font-semibold text-fg">{b.text}</h4>
            : <WikiBlock key={i} block={b} ctx={ctx} />))}
        </Prose>
      </article>
      <section aria-labelledby="before-submitting" className="space-y-2 rounded-card border border-line bg-canvas p-4 text-sm text-fg-2">
        <h3 id="before-submitting" className={heading}>Before it can be submitted</h3>
        {problems.length
          ? <ul className="list-disc space-y-1 pl-5">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          : <p>Nothing: it reads as a guide that could be published, and is ready to submit.</p>}
      </section>
    </section>
  );
}

export default async function WriteGuidePage({ searchParams }: Props) {
  if (!guideSubmissionsOn()) notFound();
  const { guide: asked } = await searchParams;
  if (asked !== undefined && !validId(asked)) notFound();
  let loaded: Loaded | "unknown" | null;
  try {
    loaded = await load(asked ?? null);
  } catch {
    return (
      <Container>
        <DataTitle title="Write a guide" />
        <p role="alert" className="text-fg-2">Your guide drafts are unavailable right now. Try again in a minute.</p>
      </Container>
    );
  }
  if (loaded === null) redirect(signInPath(WRITE_PATH));
  if (loaded === "unknown") notFound();
  const { user, guides, author, open } = loaded;

  // The editor holds the draft, or the words of the last revision sent, as the start of the next one.
  const newest = open?.preview?.revision ?? null;
  const revision = newest === null ? 1 : newest.status === "draft" ? newest.revision : newest.revision + 1;
  const waiting = open?.guide.revisions.find((r) => r.status === "submitted")?.revision ?? null;

  return (
    <Container>
      <DataTitle title="Write a guide" meta={author.handle ? `@${author.handle}` : "No handle yet"} />
      <p className="mb-6 max-w-3xl text-sm text-fg-2">
        Write a guide in the guides&apos; own format and keep it as a private draft. When it is ready, submit a revision: it is
        sent for review exactly as it is then. Community guides are not published yet.
      </p>
      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <nav aria-labelledby="your-guides" className="space-y-2 text-sm">
          <h2 id="your-guides" className={heading}>Your guides</h2>
          {guides.length
            ? (
              <ul className="space-y-2">
                {guides.map((g) => (
                  <li key={g.id} className="min-w-0 [overflow-wrap:anywhere]">
                    <Link href={`${WRITE_PATH}?guide=${g.id}`} className={link}>{g.revisions[0].title}</Link>{" "}
                    <span className="text-muted">{GUIDE_STATUS_LABEL[g.revisions[0].status]}, revision {g.revisions[0].revision}</span>
                  </li>
                ))}
              </ul>
            )
            : <p className="text-muted">No guides yet.</p>}
          <p><Link href={WRITE_PATH} className={link}>Start a new guide</Link></p>
        </nav>
        <div className="min-w-0">
          <GuideEditor
            key={open?.guide.id ?? "new"}
            ownerId={user.id}
            guideId={open?.guide.id ?? null}
            draft={newest?.draft ?? emptyDraft()}
            revision={revision}
            waiting={waiting}
            author={author}
            options={guideEditorOptions()}
            limits={GUIDE_LIMITS}
          />
          {open?.preview && <DraftPreview preview={open.preview} author={author} />}
        </div>
      </div>
    </Container>
  );
}
