"use client";

import { useCallback, useEffect, useState } from "react";
import CopyButton from "@/components/ui/CopyButton";

/** One link as GET /api/me/characters/links lists it. */
export interface ListedLink {
  id: string; name: string; realm: string; race: string; class: string; faction: string; level: number;
  status: "linked" | "frozen"; linked_at: string; last_upload_at: string;
  /**
   * Listed only while the character pages are on (EVERLOOT_SHOWCASE=1). `label` only while planned builds are on too
   * (EVERLOOT_SHOWCASE_BUILDS=1): the build label whose shared builds the page lists, or null. `sections` only while
   * private sync is on too (EVERLOOT_PRIVATE_SYNC=1): each category's section switch.
   */
  page?: { public: boolean; path: string; label?: { id: string; name: string } | null; sections?: Record<SyncCategory, boolean> };
  /** Listed only while private sync is on: each category's sync, in page order. */
  sync?: { category: SyncCategory; on: boolean; capturedAt: string | null }[];
}
/** SYNC_CATEGORIES in web/src/lib/private-sync.ts, which is server code and cannot be imported here. */
type SyncCategory = "gear" | "talents" | "professions" | "reputations" | "raids" | "achievements";
/** Each category's name here, and the visibility switch that shows it (SHOW_SWITCH in private-sync.ts). */
const CATEGORY: Record<SyncCategory, { name: string; show: string }> = {
  gear: { name: "Gear", show: "show_gear" }, talents: { name: "Talents", show: "show_talents" },
  professions: { name: "Professions", show: "show_professions" }, reputations: { name: "Reputations", show: "show_reputations" },
  raids: { name: "Raids", show: "show_raids" }, achievements: { name: "Achievements and titles", show: "show_collections" },
};
/** A build label as GET /api/me/builds lists it. */
interface Label { id: string; name: string; classSlug: string }
type State = { status: "loading" } | { status: "signed-out" } | { status: "off" } | { status: "error"; message: string } | { status: "ready"; links: ListedLink[] };

const button = "inline-flex items-center justify-center min-h-11 px-3 rounded-lg border border-line text-sm text-fg hover:text-accent disabled:opacity-60";
const primary = "inline-flex items-center justify-center min-h-11 px-4 rounded-lg bg-accent text-bg text-sm font-semibold hover:bg-accent/90 disabled:opacity-60";
const day = (iso: string) => iso.slice(0, 10);
/** CODE_MINUTES in web/src/lib/character-links.ts, which is server code and cannot be imported here. */
const CODE_MINUTES = 15;

/** The game's tokens as words: SHAMAN is Shaman, NightElf is Night Elf, Scourge is Undead. */
const words = (token: string) => token === "Scourge" ? "Undead"
  : token.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** What a public character page shows, said next to its switch. */
export const PAGE_TEXT = "The public page shows this character's name, level, race, class, faction and realm, and the day it was last sent. Never your BattleTag or account. Search engines are asked not to index it.";

/** What attaching a build label does, said next to its picker. */
export const LABEL_TEXT = "Planned builds: the page can list the shared builds you filed under one of your build labels on My builds. Only the build's name and link show; unshared builds never do.";

/** What private sync does, said above a character's sync switches. */
export const SYNC_TEXT = "Sync: the Everloot Desktop App sends what you turn on here, with a key made with \"Sync my linked characters\". Every part starts off, and only you see what is synced. Turning a part's sync off deletes what was synced for it.";

/** Why a section switch does nothing yet, or null when its section can show. */
function notShownBecause(pagePublic: boolean, syncOn: boolean): string | null {
  if (!pagePublic && !syncOn) return "Shows only once the page is public and sync is on.";
  if (!pagePublic) return "Shows only once the page is public.";
  if (!syncOn) return "Shows only once sync is on.";
  return null;
}

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
  // The account's build labels, read only when the list offers planned builds; null until then or when unreadable.
  const [labels, setLabels] = useState<Label[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/me/characters/links", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (response.status === 404) return setState({ status: "off" });
      if (response.status === 401) return setState({ status: "signed-out" });
      if (!response.ok || !Array.isArray(result.links)) return setState({ status: "error", message: result.error ?? "Your linked characters are unavailable right now. Try again in a minute." });
      setState({ status: "ready", links: result.links });
      if ((result.links as ListedLink[]).some((l) => l.page?.label !== undefined)) {
        const builds = await fetch("/api/me/builds", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        setLabels(Array.isArray(builds?.characters) ? builds.characters : null);
      }
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

  async function setPublic(link: ListedLink, on: boolean) {
    setBusy(link.id);
    setSaid(null);
    try {
      const response = await fetch(`/api/me/characters/links/${encodeURIComponent(link.id)}/visibility`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page_public: on }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "That did not work. Try again.");
      setSaid(on ? `${link.name}'s page is public.` : `${link.name}'s page is private again.`);
      await load();
    } catch (e) {
      setSaid(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /** One sync or section switch: POSTs `body` to the link's `route`, says `done`, and reads the list again. */
  async function setSwitch(link: ListedLink, key: string, route: "sync" | "visibility", body: Record<string, boolean>, done: string) {
    setBusy(key);
    setSaid(null);
    try {
      const response = await fetch(`/api/me/characters/links/${encodeURIComponent(link.id)}/${route}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "That did not work. Try again.");
      setSaid(done);
      setConfirm(null);
      await load();
    } catch (e) {
      setSaid(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function setLabel(link: ListedLink, id: string | null) {
    setBusy(link.id);
    setSaid(null);
    try {
      const response = await fetch(`/api/me/characters/links/${encodeURIComponent(link.id)}/label`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "That did not work. Try again.");
      setSaid(id ? `${link.name}'s page lists that label's shared builds.` : `${link.name}'s page lists no planned builds.`);
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
        to anyone else{state.links.some((l) => l.page) ? " unless you make a character's page public" : ""}.
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
              {link.status === "linked" && link.page && (
                <div className="space-y-2">
                  <p className="text-fg-2">{PAGE_TEXT}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-fg">Public page: {link.page.public ? "on" : "off"}</span>
                    <button
                      type="button"
                      className={button}
                      aria-label={link.page.public ? `Make ${link.name}'s page private` : `Make ${link.name}'s page public`}
                      onClick={() => void setPublic(link, !link.page!.public)}
                      disabled={busy !== null}
                    >
                      {busy === link.id ? "Saving…" : link.page.public ? "Make it private" : "Make it public"}
                    </button>
                    {link.page.public && (
                      <>
                        <a href={link.page.path} className={button}>View the page</a>
                        <a href={`${link.page.path}/card-square.png`} download={`${link.name.toLowerCase()}-card.png`} className={button}>Download card</a>
                      </>
                    )}
                  </div>
                  {link.page.label !== undefined && (
                    <div className="space-y-1">
                      <p className="text-fg-2">{LABEL_TEXT}</p>
                      <label className="flex flex-wrap items-center gap-2">
                        <span className="text-fg">Planned builds from</span>
                        <select
                          className="min-h-11 rounded-lg border border-line bg-bg px-2 text-sm text-fg"
                          value={link.page.label?.id ?? ""}
                          onChange={(e) => void setLabel(link, e.target.value || null)}
                          disabled={busy !== null}
                        >
                          <option value="">None</option>
                          {labelChoices(link, labels).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              )}
              {link.sync && (
                <div className="space-y-2">
                  <p className="text-fg-2">
                    {SYNC_TEXT}{link.page?.sections ? " A part shows on the public page only while the page is public, its sync is on and you show it." : ""}
                  </p>
                  {link.status === "linked" && <a href={`/me/characters/links/${encodeURIComponent(link.id)}`} className={button}>See what&apos;s synced</a>}
                  <ul className="space-y-2">
                    {link.sync.map(({ category, on }) => {
                      const { name, show } = CATEGORY[category];
                      const lower = name.toLowerCase();
                      const frozen = link.status !== "linked";
                      const key = `${link.id}:${category}`;
                      const shown = link.page?.sections?.[category];
                      const why = link.page && !frozen ? notShownBecause(link.page.public, on) : null;
                      const whyId = `sync-why-${key}`;
                      return (
                        <li key={category} className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="min-w-44 text-fg">{name}</span>
                            <span className="text-fg-2">Sync {on ? "on" : "off"}</span>
                            <button
                              type="button"
                              className={button}
                              aria-label={`Turn ${on ? "off" : "on"} ${lower} sync for ${link.name}`}
                              onClick={() => (on ? setConfirm(key) : void setSwitch(link, `${key}:sync`, "sync", { [category]: true }, `${name} sync is on for ${link.name}.`))}
                              disabled={busy !== null || frozen}
                            >
                              {busy === `${key}:sync` ? "Saving…" : on ? "Turn off" : "Turn on"}
                            </button>
                            {shown !== undefined && (
                              <>
                                <span className="text-fg-2">Page: {shown && !why && !frozen ? "shown" : "not shown"}</span>
                                <button
                                  type="button"
                                  className={button}
                                  aria-label={shown ? `Hide ${lower} from ${link.name}'s page` : `Show ${lower} on ${link.name}'s page`}
                                  aria-describedby={why ? whyId : undefined}
                                  onClick={() => void setSwitch(link, `${key}:show`, "visibility", { [show]: !shown },
                                    shown ? `${name} is off ${link.name}'s page.` : `${name} shows on ${link.name}'s page.`)}
                                  // A switch that is on can always be turned off; one that is off turns on only when it would show.
                                  disabled={busy !== null || frozen || (!shown && why !== null)}
                                >
                                  {busy === `${key}:show` ? "Saving…" : shown ? "Hide" : "Show"}
                                </button>
                              </>
                            )}
                            {why && <span id={whyId} className="text-fg-2">{why}</span>}
                          </div>
                          {confirm === key && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-fg">Turn off {lower} sync? What was synced for it is deleted now.</span>
                              <button type="button" className={button} onClick={() => void setSwitch(link, `${key}:sync`, "sync", { [category]: false }, `${name} sync is off for ${link.name}, and what was synced for it is deleted.`)} disabled={busy !== null}>
                                {busy === `${key}:sync` ? "Deleting…" : "Turn off and delete"}
                              </button>
                              <button type="button" className={button} onClick={() => setConfirm(null)} disabled={busy !== null}>Keep it</button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
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

/**
 * The labels a link can take: the account's labels of the character's class, and the attached one even when the
 * labels could not be read. Never picked for the player: "None" stays until they choose.
 */
function labelChoices(link: ListedLink, labels: Label[] | null): { id: string; name: string }[] {
  const own = (labels ?? []).filter((l) => l.classSlug === link.class.toLowerCase());
  const attached = link.page?.label;
  return attached && !own.some((l) => l.id === attached.id) ? [attached, ...own] : own;
}
