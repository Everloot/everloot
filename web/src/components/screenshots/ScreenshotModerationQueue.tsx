"use client";

/* eslint-disable @next/next/no-img-element -- screenshots are WebPs the server already sized; next/image would only add an optimizer hop and a second copy. */
import { useState } from "react";
import {
  SCREENSHOT_MODERATION_ROUTE, screenshotEntityHref, screenshotFileHref, screenshotReviewHref, type QueuedScreenshot, type ScreenshotModerationAction,
} from "@/lib/screenshots-shared";

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const QUIET = "btn min-h-11 px-4 text-sm";
const TYPE_LABEL: Record<QueuedScreenshot["entityType"], string> = { item: "Item", quest: "Quest", npc: "NPC", spell: "Spell", zone: "Zone", instance: "Instance" };
const DONE: Record<"approved" | "rejected", string> = { approved: "Approved. It shows on its page within a few minutes.", rejected: "Rejected. Its file is removed." };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const kb = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString("en-US")} KB`;

type Row = Omit<QueuedScreenshot, "status"> & { status: QueuedScreenshot["status"] | "rejected" };

/** The moderators' list: each screenshot at full width, its page and uploader, and what can be done to it. */
export default function ScreenshotModerationQueue({ initial }: { initial: QueuedScreenshot[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [notes, setNotes] = useState<Record<string, { kind: "ok" | "error"; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function act(row: Row, action: ScreenshotModerationAction) {
    setBusy(row.id);
    try {
      const response = await fetch(SCREENSHOT_MODERATION_ROUTE, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ screenshotId: row.id, action }),
      });
      const answer = await response.json().catch(() => ({})) as { status?: "approved" | "rejected"; error?: string };
      if (!response.ok || !answer.status) {
        setNotes((n) => ({ ...n, [row.id]: { kind: "error", text: answer.error ?? "That did not work. Try again." } }));
        return;
      }
      setRows((all) => all.map((r) => (r.id === row.id ? { ...r, status: answer.status! } : r)));
      setNotes((n) => ({ ...n, [row.id]: { kind: "ok", text: DONE[answer.status!] } }));
    } catch {
      setNotes((n) => ({ ...n, [row.id]: { kind: "error", text: "That did not work. Try again." } }));
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) return <p className="text-sm text-muted">Nothing is waiting, and nothing was approved in the last 30 days.</p>;
  return (
    <ol className="border-b border-edge">
      {rows.map((row) => (
        <li key={row.id} className="space-y-2 border-t border-edge py-4">
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">@{row.author ?? "player"}</span> on{" "}
            <a href={screenshotEntityHref(row.entityType, row.entityId)} className={LINK}>{TYPE_LABEL[row.entityType]} {row.entityId}</a>
            {" · "}<time dateTime={row.createdAt}>{when(row.createdAt)}</time>
            {" · "}{row.width} × {row.height}, {kb(row.bytes)}
            {" · "}<span className="font-medium text-fg">{row.status === "pending" ? "Waiting" : row.status === "approved" ? "Approved" : "Rejected"}</span>
          </p>
          {row.status !== "rejected" && (
            <img src={row.status === "pending" ? screenshotReviewHref(row.id) : screenshotFileHref(row.id)} width={row.width} height={row.height}
              alt={`Screenshot uploaded by @${row.author ?? "player"} for ${TYPE_LABEL[row.entityType]} ${row.entityId}`}
              className="h-auto w-full max-w-3xl rounded-control border border-edge" />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {row.status === "pending" && <button type="button" className="btn btn-primary min-h-11 px-4 text-sm" disabled={busy === row.id} onClick={() => void act(row, "approve")}>Approve</button>}
            {row.status === "pending" && <button type="button" className={QUIET} disabled={busy === row.id} onClick={() => void act(row, "reject")}>Reject</button>}
            {row.status === "approved" && <button type="button" className={QUIET} disabled={busy === row.id} onClick={() => void act(row, "reject")}>Take down</button>}
            {notes[row.id] && <p role={notes[row.id].kind === "error" ? "alert" : "status"} className="text-sm text-fg">{notes[row.id].text}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
