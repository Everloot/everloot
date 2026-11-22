"use client";

import { useState } from "react";

type Match = { region: "us" | "eu"; slug: string; surname: string };

export default function ArmoryConnection({ id, name, path, onSaved }: { id: string; name: string; path: string | null; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const url = `/api/me/characters/${encodeURIComponent(id)}/armory`;

  async function findMatches() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not look up Armory profiles. Try again.");
      const body = await response.json() as { matches: Match[] };
      setMatches(body.matches);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not look up Armory profiles.");
    } finally { setBusy(false); }
  }

  async function save(match: Match | null) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(match ? { match } : { armoryUrl: null }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save the connection.");
      setMessage(match ? "Armory connected. Your public-page and section settings still control what you share." : "Armory connection removed.");
      if (!match) setMatches(null);
      await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the connection."); }
    finally { setBusy(false); }
  }
  return <details className="py-2 text-sm text-fg-2" onToggle={(event) => {
    if (event.currentTarget.open && !path && matches === null && !busy) void findMatches();
  }}>
    <summary className="min-h-11 cursor-pointer py-2">{path ? "Manage armory connection" : "Connect your Blizzard armory"}</summary>
    <div className="space-y-3">
      {path ? <div className="flex flex-wrap items-center gap-3">
        <a href={path} className="underline">View Armory profile</a>
        <button type="button" disabled={busy} onClick={() => void save(null)} className="btn btn-secondary min-h-11">Remove connection</button>
      </div> : matches?.length ? <>
        <p>{matches.length === 1 ? "Confirm this is your character." : "Choose your character’s full name."} Linked dungeon progress can appear in player tooltips.</p>
        <ul className="space-y-2">{matches.map((match) => <li key={`${match.region}/${match.slug}`}>
          <button type="button" disabled={busy} onClick={() => void save(match)} className="btn btn-secondary min-h-11">
            Connect {name} {match.surname} · {match.region.toUpperCase()}
          </button>
        </li>)}</ul>
        <p><a href="/armory/submit" className="underline">My profile is missing</a></p>
      </> : matches ? <p>No matching profiles yet. <a href="/armory/submit" className="underline">Add your character by name</a>, then check again.</p>
        : busy ? <p role="status">Looking up Armory profiles…</p> : null}
      {!path && !busy && !matches?.length && <button type="button" onClick={() => void findMatches()} className="btn btn-secondary min-h-11">Find my profile</button>}
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
