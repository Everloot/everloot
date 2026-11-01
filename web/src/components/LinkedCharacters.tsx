"use client";

import { useCallback, useEffect, useState } from "react";
import CopyButton from "@/components/ui/CopyButton";

/** One link as GET /api/me/characters/links lists it. */
export interface ListedLink {
  id: string; name: string; realm: string; race: string; class: string; faction: string; level: number;
  status: "linked" | "frozen"; linked_at: string; last_upload_at: string;
}
type State = { status: "loading" } | { status: "signed-out" } | { status: "off" } | { status: "error"; message: string } | { status: "ready"; links: ListedLink[] };

const button = "inline-flex items-center justify-center min-h-11 px-3 rounded-lg border border-line text-sm text-fg hover:text-accent disabled:opacity-60";
const primary = "inline-flex items-center justify-center min-h-11 px-4 rounded-lg bg-accent text-bg text-sm font-semibold hover:bg-accent/90 disabled:opacity-60";
const day = (iso: string) => iso.slice(0, 10);
/** CODE_MINUTES in web/src/lib/character-links.ts, which is server code and cannot be imported here. */
const CODE_MINUTES = 15;

/** The game's tokens as words: SHAMAN is Shaman, NightElf is Night Elf, Scourge is Undead. */
const words = (token: string) => token === "Scourge" ? "Undead"
  : token.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * What a frozen link says to its owner. It tells them another account linked the character too, and nothing about
 * that account. How to reach us about it is the owner's decision (D8 in the identity ADR), so no contact or promise
 * of review is made here yet.
 */
export const FROZEN_TEXT = "Frozen: another account has linked this character too, so it is frozen on both accounts and shows nowhere until that is settled. Unlinking it here does not unfreeze the other account's link.";

/**
 * The account page's linked characters: make a code to type in game, the account's own links with their status, and
 * Unlink. Shown only while EVERLOOT_CHARACTER_LINKS=1 (the list answers 404 otherwise, and this renders nothing).
 */
export default function LinkedCharacters() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/me/characters/links", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (response.status === 404) return setState({ status: "off" });
      if (response.status === 401) return setState({ status: "signed-out" });
      if (!response.ok || !Array.isArray(result.links)) return setState({ status: "error", message: result.error ?? "Your linked characters are unavailable right now. Try again in a minute." });
      setState({ status: "ready", links: result.links });
    } catch {
      setState({ status: "error", message: "Your linked characters are unavailable right now. Try again in a minute." });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function makeCode() {
    setBusy("code");
    setSaid(null);
    try {
      const response = await fetch("/api/me/characters/link-codes", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.code !== "string") throw new Error(result.error ?? "That did not work. Try again.");
      setCode({ code: result.code, expiresAt: result.expiresAt });
    } catch (e) {
      setSaid(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function unlink(link: ListedLink) {
    setBusy(link.id);
    setSaid(null);
    try {
      const response = await fetch(`/api/me/characters/links/${encodeURIComponent(link.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      // Already gone (unlinked in another tab) reads the same as done: the list is read again either way.
      if (!response.ok && response.status !== 404) throw new Error(result.error ?? "That did not work. Try again.");
      setSaid(`Unlinked ${link.name}.`);
      setConfirm(null);
      await load();
    } catch (e) {
      setSaid(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "off") return null;
  if (state.status === "loading") return <p className="text-sm text-fg-2">Loading your linked characters…</p>;
  if (state.status === "signed-out") return <p className="text-sm text-fg-2"><a href="/sign-in" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Sign in</a> to link your characters.</p>;
  if (state.status === "error") return <p role="alert" className="text-sm text-fg-2">{state.message}</p>;

  const command = code ? `/everloot link ${code.code}` : "";
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-2">
        Link a character by typing a code on it in game. A link says that a character typed a code from this account in its
        Everloot addon file; it is not checked with Blizzard. Linked characters are private: nothing about them is shown
        to anyone else.
      </p>
      <div className="space-y-2">
        <button type="button" className={primary} onClick={() => void makeCode()} disabled={busy !== null}>{busy === "code" ? "Making a code…" : "Make a link code"}</button>
        {code && (
          <div className="space-y-2 rounded-lg border border-line p-3 text-sm">
            <p className="text-fg">On the character you want to link, type <code className="font-mono">{command}</code> then <code>/reload</code>.</p>
            <CopyButton text={command} label="Copy the command" className={button} />
            <p className="text-fg-2">
              The code works once, for {CODE_MINUTES} minutes (until {new Date(code.expiresAt).toISOString().slice(11, 16)} UTC). The Everloot Desktop
              App, signed in to this account, sends it after the reload. Then press Check again.
            </p>
          </div>
        )}
      </div>
      {state.links.length === 0 ? (
        <p className="text-sm text-fg-2">No linked characters yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {state.links.map((link) => (
            <li key={link.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-fg"><b>{link.name}</b> · Level {link.level} {words(link.race)} {words(link.class)} · {link.realm}</span>
                <span className="text-fg-2">{link.status === "linked" ? "Linked" : "Frozen"}</span>
              </div>
              <p className="text-fg-2">Linked {day(link.linked_at)}, last sent {day(link.last_upload_at)}.</p>
              {link.status === "frozen" && <p className="text-fg">{FROZEN_TEXT}</p>}
              {confirm === link.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-fg">Unlink {link.name}? Your saved builds stay.</span>
                  <button type="button" className={button} onClick={() => void unlink(link)} disabled={busy !== null}>{busy === link.id ? "Unlinking…" : "Unlink"}</button>
                  <button type="button" className={button} onClick={() => setConfirm(null)} disabled={busy !== null}>Keep it</button>
                </div>
              ) : (
                <button type="button" className={button} aria-label={`Unlink ${link.name}`} onClick={() => setConfirm(link.id)} disabled={busy !== null}>Unlink</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={button} onClick={() => void load()} disabled={busy !== null}>Check again</button>
      <p role="status" className="text-sm text-fg-2">{said}</p>
    </div>
  );
}
