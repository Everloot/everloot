"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { editPath, LIMITS, type SavedBuild } from "@/lib/saved-builds";

const action = "inline-flex min-h-8 items-center px-1.5 text-cell text-fg-2 hover:text-accent disabled:opacity-60";

/** The copy's name: "<name> (copy)", cut so it stays within the name limit. */
export function copyName(name: string): string {
  const suffix = " (copy)";
  return Array.from(name).slice(0, LIMITS.name - suffix.length).join("").trimEnd() + suffix;
}

/** Open, Duplicate, Delete (asks once more) and, on a character's page, Make active. */
export default function BuildActions({ build, canActivate = false }: { build: SavedBuild; canActivate?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "That did not work. Try again.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  // The build as saved, both sets' spend orders included. A duplicate keeps its sharing and, as any new build says, does
  // not show the owner's name.
  const fields = { name: build.name, notes: build.notes, characterId: build.characterId, code: build.code, code2: build.code2, order: build.order, order2: build.order2 };
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <a href={editPath(build)} className={action}>Open</a>
      <button type="button" className={action} disabled={busy}
        onClick={() => send("/api/me/builds", { method: "POST", body: JSON.stringify({ ...fields, name: copyName(build.name), shared: build.shared, showName: false }) })}>Duplicate</button>
      {canActivate && build.characterId && !build.active && (
        <button type="button" className={action} disabled={busy}
          onClick={() => send("/api/me/builds", { method: "POST", body: JSON.stringify({ id: build.id, ...fields, active: true }) })}>Make active</button>
      )}
      {confirming ? (
        <button type="button" className={`${action} text-fg`} disabled={busy} onClick={() => send(`/api/me/builds/${build.id}`, { method: "DELETE" })}>Delete for good</button>
      ) : (
        <button type="button" className={action} disabled={busy} onClick={() => setConfirming(true)}>Delete</button>
      )}
      {error && <span role="alert" className="text-cell text-fg">{error}</span>}
    </span>
  );
}
