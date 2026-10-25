"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { signInPath } from "@/lib/auth/return-to";
import { editPath, LIMITS, type AccountBuilds, type SavedBuild } from "@/lib/saved-builds";
import { Input } from "@/components/ui";

// Save in the talent calculator (docs/design/specs/2026-10-20-saved-builds-design.md). Signed out, Save offers
// sign-in and brings the visitor back to the same build; signed in, it files the build under a name, a character
// and notes. Opened from a saved build (?saved=<id>), Save updates that build and Save as new makes a copy.

const PENDING = "everloot:pending-save";
/** A new account's confirmation link works for an hour; the waiting build is kept a little longer, then dropped. */
const PENDING_MS = 2 * 60 * 60 * 1000;
const button = "btn px-3 text-sm sm:px-5";

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

type Account = { status: "loading" } | { status: "off" } | { status: "signed-out" } | { status: "error" } | { status: "ready"; data: AccountBuilds };

export default function SaveBuild({ classSlug, codes, defaultName, onMessage }: {
  classSlug: string;
  /** The two sets' share codes as they are now; the first is null until set 1 has a point. */
  codes: [string | null, string | null];
  defaultName: string;
  onMessage: (text: string) => void;
}) {
  const [account, setAccount] = useState<Account>({ status: "loading" });
  const [editing, setEditing] = useState<SavedBuild | null>(null);
  const [panel, setPanel] = useState<"save" | "sign-in" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", characterId: "", newName: "", newRealm: "", notes: "", shared: true, showName: false });
  // The name the build bar shows now; the panel can open from the first render's effect, before the build loads.
  const nameNow = useRef(defaultName);
  nameNow.current = defaultName;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const response = await fetch("/api/me/builds", { cache: "no-store" });
        if (!live) return;
        if (response.status === 404) { setAccount({ status: "off" }); return; }
        if (response.status === 401) { setAccount({ status: "signed-out" }); return; }
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json() as AccountBuilds;
        if (!live) return;
        setAccount({ status: "ready", data });
        const params = new URLSearchParams(window.location.search);
        const saved = data.builds.find((b) => b.id === params.get("saved") && b.classSlug === classSlug) ?? null;
        setEditing(saved);
        if (params.get("save") === "1") { rewriteSearch(saved?.id ?? null); openSave(saved); }
      } catch {
        if (live) setAccount({ status: "error" });
      }
    })();
    return () => { live = false; };
    // Read once per page: the class does not change under the calculator, and opening the panel only uses setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classSlug]);

  if (account.status === "off") return null;
  const mine = account.status === "ready" ? account.data.builds.filter((b) => b.classSlug === classSlug) : [];
  const characters = account.status === "ready" ? account.data.characters.filter((c) => c.classSlug === classSlug) : [];

  function openSave(from: SavedBuild | null) {
    setError(null);
    setForm({
      name: from?.name ?? nameNow.current, characterId: from?.characterId ?? "", newName: "", newRealm: "",
      notes: from?.notes ?? "", shared: from?.shared ?? true, showName: from?.showName ?? false,
    });
    setPanel("save");
  }

  function onSave() {
    if (account.status === "signed-out") { setPanel(panel === "sign-in" ? null : "sign-in"); return; }
    if (account.status !== "ready") { onMessage("Your account could not be checked. Reload the page and try again."); return; }
    if (panel === "save") setPanel(null);
    else openSave(editing);
  }

  function rememberBuild() {
    try {
      localStorage.setItem(PENDING, JSON.stringify({ path: window.location.pathname, hash: window.location.hash, at: Date.now() }));
    } catch {}
  }

  async function post<T>(url: string, body: object): Promise<T> {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) { setAccount({ status: "signed-out" }); setPanel("sign-in"); }
    if (!response.ok) throw new Error(result.error ?? "That did not work. Try again.");
    return result as T;
  }

  async function submit(event: FormEvent<HTMLFormElement>, asNew: boolean) {
    event.preventDefault();
    if (account.status !== "ready" || !codes[0]) return;
    setBusy(true);
    setError(null);
    try {
      let data = account.data;
      let characterId: string | null = form.characterId || null;
      if (form.characterId === "new") {
        const { character } = await post<{ character: AccountBuilds["characters"][number] }>("/api/me/characters", { name: form.newName, classSlug, realm: form.newRealm });
        data = { ...data, characters: [...data.characters, character] };
        characterId = character.id;
        // Kept at once, so if the build fails to save, trying again files it under this character, not a second one.
        setAccount({ status: "ready", data });
        setForm((f) => ({ ...f, characterId: character.id, newName: "", newRealm: "" }));
      }
      const update = editing && !asNew;
      const { build } = await post<{ build: SavedBuild }>("/api/me/builds", {
        ...(update ? { id: editing.id } : {}),
        name: form.name, notes: form.notes, characterId, code: codes[0], code2: codes[1], shared: form.shared, showName: form.showName,
      });
      data = { ...data, builds: [build, ...data.builds.filter((b) => b.id !== build.id)] };
      setAccount({ status: "ready", data });
      setEditing(build);
      setPanel(null);
      rewriteSearch(build.id);
      onMessage(`${update ? "Saved" : "Saved as a new build"}. ${build.link ? `Short link: ${build.link}` : "Its short link is off."}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={button} onClick={onSave} disabled={!codes[0] || account.status === "loading"} aria-expanded={panel !== null}
        title={codes[0] ? undefined : "Spend a point in set 1 to save"}>Save</button>
      {mine.length > 0 && (
        <details className="relative">
          <summary className={`${button} cursor-pointer list-none`}>My builds</summary>
          <ul className="absolute right-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-control border border-edge bg-panel p-1">
            {mine.map((b) => (
              <li key={b.id}><a href={editPath(b)} className="block truncate rounded-control px-3 py-2 text-sm text-fg-2 hover:bg-canvas hover:text-accent">{b.name}</a></li>
            ))}
            <li><a href="/me" className="block rounded-control px-3 py-2 text-sm text-fg hover:bg-canvas">All my builds</a></li>
          </ul>
        </details>
      )}
      {editing && <p className="text-sm text-fg-2">Editing: <span className="text-fg">{editing.name}</span></p>}

      {panel === "sign-in" && (
        <section aria-label="Sign in to save builds" className="order-last basis-full rounded-control border border-line bg-canvas p-3 text-sm text-fg-2">
          <p>
            Sign in to save builds to your account. You come back to this build after.{" "}
            <a href={signInPath(`/tools/talents/${classSlug}?save=1`)} onClick={rememberBuild} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Sign in</a>
          </p>
        </section>
      )}

      {panel === "save" && account.status === "ready" && (
        <form aria-label="Save build" onSubmit={(e) => submit(e, false)} className="order-last grid basis-full gap-3 rounded-control border border-line bg-canvas p-3 sm:grid-cols-2">
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
            <button type="button" className={button} onClick={() => setPanel(null)}>Cancel</button>
          </div>
          {error && <p role="alert" className="text-sm text-fg sm:col-span-2">{error}</p>}
          <p className="text-xs text-muted sm:col-span-2">Anyone with the short link can open the build. Your characters stay private.</p>
        </form>
      )}
    </>
  );
}
