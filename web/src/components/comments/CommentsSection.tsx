"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { SectionHeading } from "@/components/ui";
import { signInPath } from "@/lib/auth/return-to";
import { COMMENT_LINK_HOSTS } from "@/lib/comment-markup";
import {
  COMMENTS_ROUTE, COMMENT_LIMITS, REPORT_REASONS, REPORT_REASON_LABEL, type CommentEntityType, type CommentsView, type PageComment, type ReportReason,
} from "@/lib/comments-shared";
import CommentBody from "./CommentBody";

const TRY_AGAIN = "That did not work. Try again.";
const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const QUIET = "btn min-h-11 px-4 text-sm";
const SMALL = "min-h-11 px-2 text-sm text-fg-2 underline decoration-edge underline-offset-4 hover:text-fg hover:decoration-fg";
const BOX = "w-full rounded-control border border-edge bg-canvas px-3 py-2 text-base text-fg focus:border-accent";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const chars = (s: string) => Array.from(s).length;

type Note = { kind: "ok" | "error"; text: string } | null;

/**
 * The comments under an entity page. They load here, in the browser, from /comments (never cached), so the page's
 * cached HTML carries no session and no comment. Signed out it reads; signed in with a handle it posts, edits for a
 * few minutes and deletes the player's own, and reports others'.
 */
export default function CommentsSection({ type, id }: { type: CommentEntityType; id: number }) {
  const pathname = usePathname();
  const [view, setView] = useState<CommentsView | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ id: string; reason: ReportReason; note: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${COMMENTS_ROUTE}?type=${type}&id=${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setView(await response.json() as CommentsView);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [type, id]);
  useEffect(() => { void load(); }, [load]);

  /** One write for the page's account; true when it was done. The server's refusal is shown as it worded it. */
  async function write(body: object, done: string): Promise<boolean> {
    if (!view?.viewer) return false;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(COMMENTS_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json", "x-everloot-expected-owner": view.viewer.id },
        body: JSON.stringify(body),
      });
      const answer = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setNote({ kind: "error", text: answer.error ?? TRY_AGAIN });
        return false;
      }
      setNote({ kind: "ok", text: done });
      await load();
      return true;
    } catch {
      setNote({ kind: "error", text: TRY_AGAIN });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function post(event: FormEvent) {
    event.preventDefault();
    if (await write({ action: "post", type, id, body: draft }, "Your comment is posted.")) setDraft("");
  }

  const viewer = view?.viewer ?? null;
  const comments = view?.comments ?? [];

  function form() {
    if (!view) return null;
    if (!viewer) {
      return <p className="text-sm text-fg-2"><a href={signInPath(`${pathname}#comments`)} className={LINK}>Sign in</a> to comment.</p>;
    }
    if (!viewer.handle) {
      return (
        <p className="text-sm text-fg-2">
          Choose a handle on <a href="/settings" className={LINK}>your settings page</a> to comment. A comment shows your handle, never your BattleTag.
        </p>
      );
    }
    return (
      <form onSubmit={(e) => void post(e)} className="space-y-2">
        <label className="block space-y-1 text-sm">
          <span className="block text-muted">Comment as @{viewer.handle}</span>
          <textarea name="body" rows={4} maxLength={COMMENT_LIMITS.body} required value={draft} onChange={(e) => setDraft(e.target.value)} className={BOX} />
        </label>
        <p className="text-xs text-muted">
          **bold**, *italic*, `code` and ||spoiler||. Put anything that spoils a fight or a story in a spoiler. Links only to{" "}
          {COMMENT_LINK_HOSTS.join(", ")}; no images. {chars(draft)}/{COMMENT_LIMITS.body}
        </p>
        <button type="submit" className="btn btn-primary min-h-11 px-4 text-sm" disabled={busy || !draft.trim()} aria-busy={busy}>Post comment</button>
      </form>
    );
  }

  function actions(c: PageComment) {
    if (!viewer || c.status === "deleted") return null;
    if (c.mine) {
      if (deleting === c.id) {
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-fg-2">Delete this comment? Its words go for good.</span>
            <button type="button" className={QUIET} disabled={busy} onClick={() => void write({ action: "delete", commentId: c.id }, "Your comment is deleted.").then(() => setDeleting(null))}>Delete comment</button>
            <button type="button" className={QUIET} onClick={() => setDeleting(null)}>Cancel</button>
          </div>
        );
      }
      return (
        <div className="flex flex-wrap gap-x-2">
          {c.editable && <button type="button" className={SMALL} onClick={() => setEditing({ id: c.id, body: c.body })}>Edit</button>}
          <button type="button" className={SMALL} onClick={() => setDeleting(c.id)}>Delete</button>
        </div>
      );
    }
    if (c.status !== "visible") return null;
    if (c.reported) return <p className="text-sm text-muted">Reported</p>;
    if (reporting?.id === c.id) {
      return (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block space-y-1 text-sm">
            <span className="block text-muted">Why</span>
            <select name="reason" value={reporting.reason} onChange={(e) => setReporting({ ...reporting, reason: e.target.value as ReportReason })}
              className="min-h-11 rounded-control border border-edge bg-canvas px-2 text-fg focus:border-accent">
              {REPORT_REASONS.map((r) => <option key={r} value={r}>{REPORT_REASON_LABEL[r]}</option>)}
            </select>
          </label>
          <label className="block min-w-0 flex-1 space-y-1 text-sm">
            <span className="block text-muted">Note for the moderators (optional)</span>
            <input name="note" maxLength={COMMENT_LIMITS.note} value={reporting.note} onChange={(e) => setReporting({ ...reporting, note: e.target.value })}
              className={`min-h-11 ${BOX}`} />
          </label>
          <button type="button" className={QUIET} disabled={busy}
            onClick={() => void write({ action: "report", commentId: c.id, reason: reporting.reason, note: reporting.note }, "Thanks. A moderator will look at it.").then((ok) => ok && setReporting(null))}>
            Send report
          </button>
          <button type="button" className={QUIET} onClick={() => setReporting(null)}>Cancel</button>
        </div>
      );
    }
    return <button type="button" className={SMALL} onClick={() => setReporting({ id: c.id, reason: "spam", note: "" })}>Report</button>;
  }

  function item(c: PageComment) {
    if (c.status !== "visible") {
      return (
        <li key={c.id} className="border-t border-edge py-3 text-sm text-muted">
          {c.status === "hidden" ? "This comment was hidden by a moderator." : "This comment was deleted by its author."}
          {c.status === "hidden" && actions(c)}
        </li>
      );
    }
    return (
      <li key={c.id} className="space-y-2 border-t border-edge py-3">
        <p className="text-sm text-muted">
          <span className="font-medium text-fg">@{c.author ?? "player"}</span> · <time dateTime={c.createdAt}>{day(c.createdAt)}</time>
          {c.editedAt && <> · edited</>}
        </p>
        {editing?.id === c.id
          ? (
            <div className="space-y-2">
              <textarea aria-label="Edit your comment" rows={4} maxLength={COMMENT_LIMITS.body} value={editing.body}
                onChange={(e) => setEditing({ id: c.id, body: e.target.value })} className={BOX} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={QUIET} disabled={busy || !editing.body.trim()}
                  onClick={() => void write({ action: "edit", commentId: c.id, body: editing.body }, "Your comment is saved.").then((ok) => ok && setEditing(null))}>Save</button>
                <button type="button" className={QUIET} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          )
          : <CommentBody body={c.body} />}
        {editing?.id !== c.id && actions(c)}
      </li>
    );
  }

  return (
    <section aria-labelledby="comments" className="mt-8">
      <SectionHeading id="comments" note="Players' notes on this page. Be kind, and keep spoilers in a spoiler.">Comments</SectionHeading>
      <div className="space-y-4">
        {form()}
        {note && <p role={note.kind === "error" ? "alert" : "status"} className="text-sm text-fg">{note.text}</p>}
        {failed
          ? <p role="status" className="text-sm text-fg-2">Comments are unavailable right now. <button type="button" className={SMALL} onClick={() => void load()}>Try again</button></p>
          : !view
            ? <p role="status" className="text-sm text-muted">Loading comments…</p>
            : comments.length
              ? <ol className="border-b border-edge">{comments.map(item)}</ol>
              : <p className="text-sm text-muted">No comments yet.</p>}
      </div>
    </section>
  );
}
