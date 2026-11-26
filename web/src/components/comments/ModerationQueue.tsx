"use client";

import { useState } from "react";
import { MODERATION_ROUTE, REPORT_REASON_LABEL, commentEntityHref, type ModerationAction, type QueuedComment } from "@/lib/comments-shared";
import CommentBody from "./CommentBody";

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const QUIET = "btn min-h-11 px-4 text-sm";
const TYPE_LABEL: Record<QueuedComment["entityType"], string> = { item: "Item", quest: "Quest", npc: "NPC", spell: "Spell", zone: "Zone", instance: "Instance" };
const DONE: Record<ModerationAction, string> = { hide: "Hidden.", restore: "Restored.", dismiss: "Reports dismissed; the comment stays." };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/** The moderators' list: each comment with its page, its reports' reasons and notes, and what can be done to it. */
export default function ModerationQueue({ initial }: { initial: QueuedComment[] }) {
  const [rows, setRows] = useState(initial);
  const [notes, setNotes] = useState<Record<string, { kind: "ok" | "error"; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function act(row: QueuedComment, action: ModerationAction) {
    setBusy(row.id);
    try {
      const response = await fetch(MODERATION_ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commentId: row.id, action }) });
      const answer = await response.json().catch(() => ({})) as { status?: QueuedComment["status"]; error?: string };
      if (!response.ok || !answer.status) {
        setNotes((n) => ({ ...n, [row.id]: { kind: "error", text: answer.error ?? "That did not work. Try again." } }));
        return;
      }
      setRows((all) => all.map((r) => (r.id === row.id ? { ...r, status: answer.status!, openReports: action === "restore" ? r.openReports : 0 } : r)));
      setNotes((n) => ({ ...n, [row.id]: { kind: "ok", text: DONE[action] } }));
    } catch {
      setNotes((n) => ({ ...n, [row.id]: { kind: "error", text: "That did not work. Try again." } }));
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) return <p className="text-sm text-muted">Nothing is reported, and nothing was hidden in the last 30 days.</p>;
  return (
    <ol className="border-b border-edge">
      {rows.map((row) => (
        <li key={row.id} className="space-y-2 border-t border-edge py-4">
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">@{row.author ?? "player"}</span> on{" "}
            <a href={commentEntityHref(row.entityType, row.entityId)} className={LINK}>{TYPE_LABEL[row.entityType]} {row.entityId}</a>
            {" · "}<time dateTime={row.createdAt}>{when(row.createdAt)}</time>
            {row.editedAt && " · edited"}
            {" · "}<span className="font-medium text-fg">{row.status === "hidden" ? "Hidden" : row.status === "deleted" ? "Deleted" : "Visible"}</span>
          </p>
          {row.openReports > 0 && (
            <div className="text-sm text-fg-2">
              <p>{row.openReports} open {row.openReports === 1 ? "report" : "reports"}: {row.reasons.map((r) => REPORT_REASON_LABEL[r]).join(", ")}</p>
              {row.notes.length > 0 && <ul className="list-disc pl-5">{row.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            </div>
          )}
          {row.body ? <CommentBody body={row.body} /> : <p className="text-sm text-muted">Deleted by its author.</p>}
          <div className="flex flex-wrap items-center gap-2">
            {row.status === "visible" && <button type="button" className={QUIET} disabled={busy === row.id} onClick={() => void act(row, "hide")}>Hide</button>}
            {row.status === "visible" && row.openReports > 0 && <button type="button" className={QUIET} disabled={busy === row.id} onClick={() => void act(row, "dismiss")}>Dismiss reports</button>}
            {row.status === "hidden" && <button type="button" className={QUIET} disabled={busy === row.id} onClick={() => void act(row, "restore")}>Restore</button>}
            {notes[row.id] && <p role={notes[row.id].kind === "error" ? "alert" : "status"} className="text-sm text-fg">{notes[row.id].text}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
