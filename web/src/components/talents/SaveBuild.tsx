"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ACCOUNT_CHANGED_EVENT } from "@/components/AccountControls";
import { useWorkspaceOwner } from "@/components/workspace/LocalPlanSave";
import { signInPath } from "@/lib/auth/return-to";
import { ACCOUNT_MISMATCH, editPath, EXPECTED_OWNER_HEADER, LIMITS, validId, type AccountBuilds, type SavedBuild } from "@/lib/saved-builds";
import { Input } from "@/components/ui";

// Save in the talent calculator (docs/design/specs/2026-10-20-saved-builds-design.md). Signed out, Save offers
// sign-in and brings the visitor back to the same build; signed in, it files the build under a name, a character
// and notes. Opened from a saved build (?saved=<id>), Save updates that build and Save as new makes a copy.
// What it shows belongs to the account this tab knows is signed in (useWorkspaceOwner). When that changes it is
// dropped at once, and an answer asked for before is neither shown nor followed by another request. Every write
// names that account (EXPECTED_OWNER_HEADER), so one sent before this tab notices a change is refused, not misfiled.

const PENDING = "everloot:pending-save";
/** A new account's confirmation link works for an hour; the waiting build is kept a little longer, then dropped. */
const PENDING_MS = 2 * 60 * 60 * 1000;
const button = "btn px-3 text-sm sm:px-5";
const CHANGED = "The account signed in here changed, so nothing was saved. Press Save again.";
const SWITCHED = "You are signed in to a different account now, so nothing was saved. Press Save again to save the build to this one.";
const CHANGED_MID_SAVE = "The account signed in here changed before the save finished. Sign in to that account again to see whether the build was saved.";
const REFUSED = "The account signed in here changed, so nothing was saved. What you typed stays with the account you started with.";
const UNCHECKED = "Your account could not be checked, so Save is off for now. Reload the page to try again.";
const UNCHECKED_CLOSED = "Your account could not be checked, so nothing was saved and Save is off for now. Reload the page to try again.";
const NO_FORM = { name: "", characterId: "", newName: "", newRealm: "", notes: "", shared: true, showName: false };

/** A write the site refused because another account is signed in here now (409 account_mismatch). */
class AccountChanged extends Error {}

/**
 * Called by the calculator before it reads its address: after a sign-in (or a sign-up's confirmation link, which
 * may open in another tab) that started at Save, the address is /tools/talents/<class>?save=1 with no build in it.
 * The build waited in local storage; put it back.
 */
export function restorePendingSave(): void {
  try {
    const pending = localStorage.getItem(PENDING);
    if (!pending || new URLSearchParams(window.location.search).get("save") !== "1") return;
    localStorage.removeItem(PENDING);
    const { path, hash, at } = JSON.parse(pending) as { path?: unknown; hash?: unknown; at?: unknown };
    const fresh = typeof at === "number" && Date.now() - at < PENDING_MS;
    if (fresh && path === window.location.pathname && typeof hash === "string" && hash.startsWith("#plan") && !window.location.hash) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
    }
  } catch {
    // No local storage (private mode, blocked): the visitor lands on an empty calculator, nothing worse.
  }
}

/** The address with ?saved= set to the build being edited (or removed), and ?save= dropped. The hash stays. */
function rewriteSearch(saved: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete("save");
  if (saved) url.searchParams.set("saved", saved);
  else url.searchParams.delete("saved");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Where sign-in comes back to: this class's calculator with Save open again, still editing the saved build the
 *  address names. The build itself waits in local storage (rememberBuild). */
function returnPath(classSlug: string): string {
  const saved = new URLSearchParams(window.location.search).get("saved");
  return `/tools/talents/${classSlug}?${validId(saved) ? `saved=${saved}&` : ""}save=1`;
}

/** `unchecked`: this tab cannot say which account is signed in, so it shows no one's builds and Save is off. */
type Account = { status: "loading" } | { status: "off" } | { status: "signed-out" } | { status: "error" } | { status: "unchecked" }
  | { status: "ready"; data: AccountBuilds };

export default function SaveBuild({ classSlug, codes, defaultName, onMessage }: {
  classSlug: string;
  /** The two sets' share codes as they are now; the first is null until set 1 has a point. */
  codes: [string | null, string | null];
  defaultName: string;
  onMessage: (text: string) => void;
}) {
  // Strict: a check that fails gives up the account it had, as the session may have changed since.
  const [owner, recheck] = useWorkspaceOwner({ strict: true });
  // Whose builds may show: an account's id, "signed-out", or "checking" and "unavailable" while none is known.
  const ownerKey = owner.status === "ready" ? (owner.owner.kind === "account" ? owner.owner.userId : "signed-out") : owner.status;
  const [account, setAccount] = useState<Account>({ status: "loading" });
  const [editing, setEditing] = useState<SavedBuild | null>(null);
  const [panel, setPanel] = useState<"save" | "sign-in" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(NO_FORM);
  // The name the build bar shows now; the panel can open from the first render's effect, before the build loads.
  const nameNow = useRef(defaultName);
  nameNow.current = defaultName;
  /** Goes up whenever the account signed in here may have changed. A request keeps the count it started under; an
   *  answer that comes back under another changes nothing, and nothing more is sent after it. */
  const era = useRef(0);
  // The panel as it is now, and the account it was for, for the moment the account changes.
  const shown = useRef({ panel, busy, form, editing: editing?.id ?? null });
  shown.current = { panel, busy, form, editing: editing?.id ?? null };
  const shownFor = useRef(ownerKey);
  /** What was typed when another account took over, by the account it was typed for. Only that account gets it back. */
  const drafts = useRef(new Map<string, { editing: string | null; form: typeof NO_FORM }>());
  const saveButton = useRef<HTMLButtonElement>(null);
  const saveForm = useRef<HTMLFormElement>(null);
  const signInLink = useRef<HTMLAnchorElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);

  // Sign out in this tab drops the answers already asked for now, before the account is checked again: one landing
  // in between would bring the old account's builds back.
  useEffect(() => {
    const onChanged = () => { era.current++; };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
  }, []);

  useEffect(() => {
    const ask = ++era.current;
    // Nothing shown for one account outlives it: its builds, the one being edited and the panel go before the next
    // account's are read. What was typed in the panel is kept for its own account, out of sight.
    const was = shown.current;
    const before = shownFor.current;
    shownFor.current = ownerKey;
    if (was.panel === "save") {
      if (validId(before)) drafts.current.set(before, { editing: was.editing, form: was.form });
      onMessage(was.busy ? CHANGED_MID_SAVE : validId(ownerKey) ? SWITCHED : ownerKey === "unavailable" ? UNCHECKED_CLOSED : CHANGED);
    }
    setAccount({ status: "loading" });
    setEditing(null);
    setPanel(null);
    setBusy(false);
    if (ownerKey === "checking") return;
    (async () => {
      try {
        // The list names the account it is for, as every save does: the site refuses it if the session is another one.
        const response = await fetch("/api/me/builds", { cache: "no-store", headers: validId(ownerKey) ? { [EXPECTED_OWNER_HEADER]: ownerKey } : {} });
        if (era.current !== ask) return;
        if (response.status === 404) { setAccount({ status: "off" }); return; }
        if (response.status === 401) { setAccount({ status: "signed-out" }); return; }
        // Another account than the one this tab confirmed is signed in now: take no list, and ask again who it is.
        if (response.status === 409 && (await response.json().catch(() => ({}))).code === ACCOUNT_MISMATCH) {
          if (era.current === ask) recheck();
          return;
        }
        // Builds show only for an account this tab knows by its id, never for a guess.
        if (!validId(ownerKey)) { setAccount({ status: "unchecked" }); return; }
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json() as AccountBuilds;
        if (era.current !== ask) return;
        setAccount({ status: "ready", data });
        const params = new URLSearchParams(window.location.search);
        const saved = data.builds.find((b) => b.id === params.get("saved") && b.classSlug === classSlug) ?? null;
        setEditing(saved);
        if (params.get("save") === "1") { rewriteSearch(saved?.id ?? null); openSave(saved); }
      } catch {
        if (era.current === ask) setAccount({ status: "error" });
      }
    })();
    // Read again when the class or the account changes; the message and opening the panel only use setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classSlug, ownerKey]);

  // An open panel takes the focus, so the keyboard carries on from there: the build's name, or the sign-in link.
  useEffect(() => {
    if (panel === "save") saveForm.current?.querySelector("input")?.focus();
    else if (panel === "sign-in") signInLink.current?.focus();
  }, [panel]);

  // My builds is a <details>, which closes only from its own button: a press outside closes it too.
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  if (account.status === "off") return null;
  const mine = account.status === "ready" ? account.data.builds.filter((b) => b.classSlug === classSlug) : [];
  const characters = account.status === "ready" ? account.data.characters.filter((c) => c.classSlug === classSlug) : [];

  function openSave(from: SavedBuild | null) {
    setError(null);
    // A draft this account left when another one took over comes back, for the same build.
    const draft = drafts.current.get(ownerKey);
    const kept = draft && draft.editing === (from?.id ?? null) ? draft.form : null;
    if (kept) drafts.current.delete(ownerKey);
    setForm(kept ?? {
      name: from?.name ?? nameNow.current, characterId: from?.characterId ?? "", newName: "", newRealm: "",
      notes: from?.notes ?? "", shared: from?.shared ?? true, showName: from?.showName ?? false,
    });
    setPanel("save");
  }

  /** Closes the panel and gives the focus back to Save. */
  function close() {
    setPanel(null);
    saveButton.current?.focus();
  }

  function onSave() {
    if (account.status === "signed-out") { setPanel(panel === "sign-in" ? null : "sign-in"); return; }
    if (account.status !== "ready") { onMessage("Your account could not be checked. Reload the page and try again."); return; }
    if (panel === "save") setPanel(null);
    else openSave(editing);
  }

  /** Keys pressed in the panel stay in it, away from the calculator's shortcuts (Ctrl+Z there takes back a point,
   *  not the notes' last edit); Escape closes it. */
  function onPanelKey(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    if (event.key === "Escape") close();
  }

  /** Escape in My builds closes it and gives the focus back to its button. */
  function onMenuKey(event: KeyboardEvent<HTMLDetailsElement>) {
    const details = event.currentTarget;
    if (event.key !== "Escape" || !details.open) return;
    event.stopPropagation();
    details.open = false;
    details.querySelector("summary")?.focus();
  }

  function rememberBuild() {
    try {
      localStorage.setItem(PENDING, JSON.stringify({ path: window.location.pathname, hash: window.location.hash, at: Date.now() }));
    } catch {}
  }

  /**
   * One write, naming the account the panel was opened for: the site refuses it if another account is signed in now.
   * Null when the account changed here while it was out: its answer is not for what is shown now.
   */
  async function post<T>(url: string, body: object, ask: number, owner: string): Promise<T | null> {
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json", [EXPECTED_OWNER_HEADER]: owner }, body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (era.current !== ask) return null;
    if (response.status === 401) { setAccount({ status: "signed-out" }); setPanel("sign-in"); }
    if (response.status === 409 && result.code === ACCOUNT_MISMATCH) throw new AccountChanged(REFUSED);
    if (!response.ok) throw new Error(result.error ?? "That did not work. Try again.");
    return result as T;
  }

  async function submit(event: FormEvent<HTMLFormElement>, asNew: boolean) {
    event.preventDefault();
    if (account.status !== "ready" || !codes[0] || !validId(ownerKey)) return;
    const ask = era.current;
    const owner = ownerKey;
    setBusy(true);
    setError(null);
    try {
      let data = account.data;
      let characterId: string | null = form.characterId || null;
      if (form.characterId === "new") {
        const made = await post<{ character: AccountBuilds["characters"][number] }>("/api/me/characters", { name: form.newName, classSlug, realm: form.newRealm }, ask, owner);
        if (!made) return;
        const { character } = made;
        data = { ...data, characters: [...data.characters, character] };
        characterId = character.id;
        // Kept at once, so if the build fails to save, trying again files it under this character, not a second one.
        setAccount({ status: "ready", data });
        setForm((f) => ({ ...f, characterId: character.id, newName: "", newRealm: "" }));
      }
      const update = editing && !asNew;
      const answer = await post<{ build: SavedBuild }>("/api/me/builds", {
        ...(update ? { id: editing.id } : {}),
        name: form.name, notes: form.notes, characterId, code: codes[0], code2: codes[1], shared: form.shared, showName: form.showName,
      }, ask, owner);
      if (!answer) return;
      const { build } = answer;
      data = { ...data, builds: [build, ...data.builds.filter((b) => b.id !== build.id)] };
      setAccount({ status: "ready", data });
      setEditing(build);
      close();
      rewriteSearch(build.id);
      onMessage(`${update ? "Saved" : "Saved as a new build"}. ${build.link ? `Short link: ${build.link}` : "Its short link is off."}`);
    } catch (err) {
      if (era.current === ask) {
        // Refused for another account: the panel stays open with what was typed, and the bar says why too.
        setError(err instanceof Error ? err.message : "That did not work. Try again.");
        if (err instanceof AccountChanged) onMessage(err.message);
      }
    } finally {
      if (era.current === ask) setBusy(false);
    }
  }

  return (
    <>
      <button ref={saveButton} type="button" className={button} onClick={onSave} aria-expanded={panel !== null}
        disabled={!codes[0] || account.status === "loading" || account.status === "unchecked"}
        aria-describedby={account.status === "unchecked" ? "save-build-unchecked" : undefined}
        onKeyDown={(e) => { if (e.key === "Escape" && panel) { e.stopPropagation(); setPanel(null); } }}
        title={codes[0] ? undefined : "Spend a point in set 1 to save"}>Save</button>
      {account.status === "unchecked" && <p id="save-build-unchecked" className="text-sm text-fg-2">{UNCHECKED}</p>}
      {mine.length > 0 && (
        <details ref={menu} className="relative min-w-0 max-sm:open:basis-full" onKeyDown={onMenuKey}>
          <summary className={`${button} cursor-pointer list-none`}>My builds</summary>
          {/* On a phone the list opens in the page, across the bar under its button: pinned to the button's right edge
              as a dropdown, it ran off the left side of a 390 px screen. min-w-0 lets it shrink to the bar, so a long
              name is cut off instead of widening the bar past the screen. */}
          <ul className="z-20 mt-1 max-h-80 overflow-y-auto rounded-control border border-edge bg-panel p-1 sm:absolute sm:right-0 sm:w-72">
            {mine.map((b) => (
              <li key={b.id}><a href={editPath(b)} className="block truncate rounded-control px-3 py-2 text-sm text-fg-2 hover:bg-canvas hover:text-accent">{b.name}</a></li>
            ))}
            <li><a href="/me" className="block rounded-control px-3 py-2 text-sm text-fg hover:bg-canvas">All my builds</a></li>
          </ul>
        </details>
      )}
      {editing && <p className="min-w-0 truncate text-sm text-fg-2">Editing: <span className="text-fg">{editing.name}</span></p>}

      {panel === "sign-in" && (
        <section aria-label="Sign in to save builds" onKeyDown={onPanelKey} className="order-last basis-full rounded-control border border-line bg-canvas p-3 text-sm text-fg-2">
          <p>
            Sign in to save builds to your account. You come back to this build after.{" "}
            <a ref={signInLink} href={signInPath(returnPath(classSlug))} onClick={rememberBuild} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Sign in</a>
          </p>
        </section>
      )}

      {panel === "save" && account.status === "ready" && (
        <form ref={saveForm} aria-label="Save build" onSubmit={(e) => submit(e, false)} onKeyDown={onPanelKey} className="order-last grid basis-full gap-3 rounded-control border border-line bg-canvas p-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="block text-muted">Name</span>
            <Input required maxLength={LIMITS.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="block text-muted">Character</span>
            <select value={form.characterId} onChange={(e) => setForm({ ...form, characterId: e.target.value })}
              className="min-h-11 w-full rounded-control border border-edge bg-canvas px-3 text-base text-fg">
              <option value="">No character</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.realm ? `${c.name} (${c.realm})` : c.name}</option>)}
              <option value="new">New character…</option>
            </select>
          </label>
          {form.characterId === "new" && (
            <>
              <label className="block space-y-1 text-sm">
                <span className="block text-muted">Character name</span>
                <Input required maxLength={LIMITS.characterName} value={form.newName} onChange={(e) => setForm({ ...form, newName: e.target.value })} />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="block text-muted">Realm (optional)</span>
                <Input maxLength={LIMITS.realm} value={form.newRealm} onChange={(e) => setForm({ ...form, newRealm: e.target.value })} />
              </label>
            </>
          )}
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="block text-muted">Notes (optional)</span>
            <textarea maxLength={LIMITS.notes} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full rounded-control border border-edge bg-canvas px-3 py-2 text-base text-fg" />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-fg-2">
            <input type="checkbox" checked={form.shared} onChange={(e) => setForm({ ...form, shared: e.target.checked })} className="size-5" />
            Share link on
          </label>
          <label className={`flex min-h-11 items-center gap-2 text-sm ${form.shared ? "text-fg-2" : "text-muted"}`}>
            <input type="checkbox" checked={form.showName} disabled={!form.shared} onChange={(e) => setForm({ ...form, showName: e.target.checked })} className="size-5" />
            Show my name on the shared link
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 sm:justify-end">
            {!codes[0] && <p className="text-sm text-fg-2">Spend a point to save this build.</p>}
            <button type="submit" className={`${button} btn-primary`} disabled={busy || !codes[0]} aria-busy={busy}>{editing ? "Save" : "Save build"}</button>
            {editing && <button type="button" className={button} disabled={busy || !codes[0]} onClick={(e) => submit(e as unknown as FormEvent<HTMLFormElement>, true)}>Save as new</button>}
            <button type="button" className={button} onClick={close}>Cancel</button>
          </div>
          {error && <p role="alert" className="text-sm text-fg sm:col-span-2">{error}</p>}
          <p className="text-xs text-muted sm:col-span-2">Anyone with the short link can open the build. Your characters stay private.</p>
        </form>
      )}
    </>
  );
}
