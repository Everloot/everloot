"use client";

import { useEffect, useRef, useState } from "react";
import { codeClass, editPath, LIMITS, type SavedBuild } from "@/lib/saved-builds";

const field = "min-h-9 w-full rounded-control border border-line bg-canvas px-2 text-sm text-fg focus:border-accent focus:outline-none";
// A dropped connection or a server error can come after the build was saved, so neither is called "Not saved".
const UNCONFIRMED = "We could not confirm the save. Check your builds before trying again.";

type Props = { accountId: string; build?: SavedBuild; onSaved: (build: SavedBuild) => void; onCancel: () => void };

/** Why a refused save was refused: the server's own words for limits and input, plain ones for the rest. */
function reason(status: number, body: { error?: unknown } | null): string {
  if (status === 401) return "You are signed out. Sign in again to save builds.";
  if (status === 403) return "The request was refused. Reload the page and try again.";
  if (typeof body?.error === "string") return body.error;
  return status === 404 ? "That build is no longer in your account." : "That could not be saved as it is.";
}

/**
 * A saved build made or edited from a Chat project, by pasting a share code from the talent calculator. A new build
 * is private to the account; an edit keeps whatever sharing the build already had, so there is no Share toggle here.
 * Keyed by account and build: switching either starts it over and abandons a save on its way, so one build's
 * edits are never posted under another's id.
 */
export default function PrivateBuildForm(props: Props) {
  return <Form key={`${props.accountId}:${props.build?.id ?? "new"}`} {...props} />;
}

function Form({ accountId, build, onSaved, onCancel }: Props) {
  const [name, setName] = useState(build?.name ?? "");
  const [code, setCode] = useState(build?.code ?? "");
  const [code2, setCode2] = useState(build?.code2 ?? "");
  const [notes, setNotes] = useState(build?.notes ?? "");
  const [state, setState] = useState<{ busy: boolean; error: string; retry: boolean }>({ busy: false, error: "", retry: false });
  const busy = useRef(false);
  const live = useRef<AbortController | null>(null);
  useEffect(() => () => live.current?.abort(), []);

  async function save() {
    if (busy.current) return;
    const cls = codeClass(code.trim());
    const error = !name.trim() ? `Give the build a name of 1 to ${LIMITS.name} characters.`
      : !cls ? "That share code is not valid. Copy it from the talent calculator's Share button."
      : code2.trim() && codeClass(code2.trim()) !== cls ? "The second share code is not valid, or is for another class."
      : "";
    if (error) { setState({ busy: false, error, retry: false }); return; }
    busy.current = true;
    const ctrl = new AbortController();
    live.current = ctrl;
    setState({ busy: true, error: "", retry: false });
    let outcome: string;
    try {
      const res = await fetch("/api/me/chat/builds", {
        method: "POST", cache: "no-store", credentials: "same-origin", signal: ctrl.signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedAccountId: accountId,
          build: { id: build?.id ?? null, name: name.trim(), notes: notes.trim() || null, code: code.trim(), code2: code2.trim() || null },
        }),
      });
      const body = (await res.json().catch(() => null)) as { accountId?: unknown; build?: SavedBuild; error?: unknown } | null;
      if (ctrl.signal.aborted) return;
      if (res.ok && body?.accountId === accountId && body.build) {
        busy.current = false;
        setState({ busy: false, error: "", retry: false });
        onSaved(body.build);
        return;
      }
      outcome = res.ok && body?.build && body.accountId !== accountId ? "You are signed in as someone else now. Reload Chat to see this account's builds."
        : res.ok || res.status >= 500 ? UNCONFIRMED
        : `Not saved. ${reason(res.status, body)}`;
    } catch {
      if (ctrl.signal.aborted) return;
      outcome = UNCONFIRMED;
    }
    busy.current = false;
    setState({ busy: false, error: outcome, retry: true });
  }

  return (
    <form aria-label={build ? `Edit ${build.name}` : "New private build"} className="space-y-2 rounded-card border border-edge bg-panel p-3 text-sm"
      onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="text-fg-2">
        Paste the share code from the talent calculator&apos;s Share button.{" "}
        {build ? "Its sharing stays as you set it on your builds page." : "This build is private to your account."}
      </p>
      <input aria-label="Build name" maxLength={LIMITS.name} className={field} value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Share code" maxLength={LIMITS.code} spellCheck={false} autoComplete="off" className={field} value={code} onChange={(e) => setCode(e.target.value)} />
      <input aria-label="Second share code (optional)" maxLength={LIMITS.code} spellCheck={false} autoComplete="off" className={field} value={code2} onChange={(e) => setCode2(e.target.value)} />
      <textarea aria-label="Notes (optional)" maxLength={LIMITS.notes} rows={3} className={`${field} py-1`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {state.error && <p role="alert" className="text-danger">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary min-h-9 px-4 text-sm" disabled={state.busy}>
          {state.busy ? "Saving…" : state.retry ? "Try again" : "Save build"}
        </button>
        <button type="button" className="btn min-h-9 px-4 text-sm" onClick={onCancel}>Cancel</button>
        {build && <a href={editPath(build)} className="text-accent underline">Open in the calculator</a>}
      </div>
    </form>
  );
}
