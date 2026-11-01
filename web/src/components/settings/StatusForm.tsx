"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui";
import type { AccountStatus } from "@/lib/account-shell-types";
import { CLEAR_AFTER, clearsAtFor, PROFILE_LIMITS, shellChanged, type ClearAfter } from "@/lib/profiles";

const KEEP = "keep";

/** One emoji and a short line, cleared after a time the player picks, or by hand. */
export default function StatusForm({ status }: { status: AccountStatus | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function send(body: object, done: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch("/api/me/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "That did not work. Try again.");
      setSaved(done);
      shellChanged();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const choice = String(form.get("clearAfter") ?? "never");
    // "Keep current" leaves the clear-after time the status already has.
    const clearsAt = choice === KEEP ? status?.clearsAt ?? null : clearsAtFor(choice as ClearAfter, new Date())?.toISOString() ?? null;
    void send({ emoji: form.get("emoji"), text: form.get("text"), clearsAt }, "Status set.");
  }

  return (
    <form onSubmit={submit} aria-label="Status" className="grid min-w-0 gap-x-4 gap-y-5 sm:grid-cols-[6rem_minmax(0,1fr)_10rem]">
      <label className="block min-w-0 space-y-2 text-sm">
        <span className="block text-fg-2">Emoji</span>
        <Input name="emoji" defaultValue={status?.emoji ?? ""} maxLength={16} autoComplete="off" />
      </label>
      <label className="block min-w-0 space-y-2 text-sm">
        <span className="block text-fg-2">What are you up to?</span>
        <Input name="text" defaultValue={status?.text ?? ""} maxLength={PROFILE_LIMITS.statusText} autoComplete="off" />
      </label>
      <label className="block min-w-0 space-y-2 text-sm">
        <span className="block text-fg-2">Clear after</span>
        <select name="clearAfter" defaultValue={status?.clearsAt ? KEEP : "never"} className="min-h-11 w-full min-w-0 rounded-control border border-edge bg-canvas px-3 text-base text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          {status?.clearsAt && <option value={KEEP}>Keep current</option>}
          {CLEAR_AFTER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-3 sm:col-span-3">
        <button type="submit" className="btn btn-primary min-h-11 px-4 text-sm" disabled={busy} aria-busy={busy}>Set status</button>
        {status && <button type="button" className="btn min-h-11 px-4 text-sm" disabled={busy} onClick={() => void send({ emoji: null, text: null, clearsAt: null }, "Status cleared.")}>Clear status</button>}
        {status?.clearsAt && <p className="text-xs text-muted">Clears <time dateTime={status.clearsAt}>{status.clearsAt.slice(0, 16).replace("T", " ")} UTC</time></p>}
        {saved && <p role="status" className="text-sm text-accent">{saved}</p>}
        {error && <p role="alert" className="w-full rounded-control border border-edge bg-panel px-3 py-2 text-sm text-fg [overflow-wrap:anywhere]">{error}</p>}
      </div>
    </form>
  );
}
