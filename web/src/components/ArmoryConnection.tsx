"use client";

import { useState, type FormEvent } from "react";

export default function ArmoryConnection({ id, name, path, onSaved }: { id: string; name: string; path: string | null; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(armoryUrl: string | null) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/me/characters/${encodeURIComponent(id)}/armory`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ armoryUrl }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save the connection.");
      setMessage(armoryUrl ? "Armory connected. Your public-page and section settings still control what you share." : "Armory connection removed.");
      await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the connection."); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(String(new FormData(event.currentTarget).get("armoryUrl") ?? ""));
  }
  return <details className="py-2 text-sm text-fg-2">
    <summary className="min-h-11 cursor-pointer py-2">{path ? "Manage armory connection" : "Connect your Blizzard armory"}</summary>
    <div className="space-y-3">
      <p>Connect {name} to its full Blizzard name. This is a player-supplied connection. <a href="/armory/submit" className="underline">Add the profile to the armory first</a> if it is missing.</p>
      {path && <p><a href={path} className="underline">View armory profile</a></p>}
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label htmlFor={`armory-${id}`} className="w-full">Blizzard armory link for {name}</label>
        <input id={`armory-${id}`} type="url" name="armoryUrl" required maxLength={500} className="min-h-11 min-w-0 flex-1 rounded-control border border-edge bg-canvas px-3 text-fg" />
        <button type="submit" disabled={busy} className="btn btn-secondary min-h-11">{busy ? "Saving…" : "Connect"}</button>
        {path && <button type="button" disabled={busy} onClick={() => void save(null)} className="btn btn-secondary min-h-11">Remove connection</button>}
      </form>
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
