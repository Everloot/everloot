"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import CopyButton from "@/components/ui/CopyButton";
import {
  DEFAULT_EXPIRY_DAYS, EXPIRY_DAYS, KEY_SCOPES, MAX_EXPIRY_DAYS, PURPOSE_MAX, daysUntil, expiryFrom, keyExpired, type KeyRow,
} from "@/lib/api-key-policy";

interface Ready { status: "ready"; keys: KeyRow[]; limit: number; ownScope: boolean; records: boolean; scopes: string[] }
type State = { status: "loading" } | { status: "signed-out" } | { status: "off" } | { status: "error"; message: string } | Ready;
interface Fresh { token: string; name: string; expiresAt: string | null; rolled: boolean }

const button = "inline-flex items-center justify-center min-h-11 px-3 rounded-lg border border-line text-sm text-fg hover:text-accent disabled:opacity-60";
const primary = "inline-flex items-center justify-center min-h-11 px-4 rounded-lg bg-accent text-bg text-sm font-semibold hover:bg-accent/90 disabled:opacity-60";
const input = "min-h-11 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-fg aria-[invalid=true]:border-accent";
const DAY_MS = 86_400_000;
const EXPIRY_LABEL: Record<number, string> = { 7: "7 days", 30: "30 days", 90: "90 days", 365: "1 year" };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "Never");
const scopeLabel = (id: string) => KEY_SCOPES.find((s) => s.id === id)?.label ?? id;

function expiresText(k: KeyRow, now: number): string {
  if (!k.expires_at) return "Never";
  if (keyExpired(k, now)) return `Expired ${day(k.expires_at)}`;
  const left = daysUntil(k.expires_at, now);
  return `${day(k.expires_at)}, in ${left} ${left === 1 ? "day" : "days"}`;
}

async function send(method: "POST" | "DELETE", url: string, body?: object) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "That did not work. Try again.");
  return result;
}

/** The one-time reveal of a new or rolled key, with a copy button. */
function Reveal({ fresh, onDone }: { fresh: Fresh; onDone: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => { heading.current?.focus(); }, [fresh.token]);
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border border-accent bg-panel p-4">
      <h3 id={`${id}-title`} ref={heading} tabIndex={-1} className="font-semibold text-fg">
        {fresh.rolled ? `New secret for ${fresh.name}` : `Your new key: ${fresh.name}`}
      </h3>
      <p className="text-sm text-fg">Copy it now. It won&apos;t be shown again.{fresh.rolled && " The old secret has stopped working."}</p>
      <code className="block break-all rounded-lg border border-line bg-canvas p-3 font-mono text-sm text-fg">{fresh.token}</code>
      <p className="text-sm text-muted">{fresh.expiresAt ? `It expires on ${day(fresh.expiresAt)}.` : "It has no end date."}</p>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={fresh.token} label="Copy key" failedLabel="Copy failed" className={primary} />
        <button type="button" className={button} onClick={onDone}>Done</button>
      </div>
    </section>
  );
}

type Errors = Partial<Record<"name" | "purpose" | "date", string>>;

/** Create API key: name, what it is for, permissions and when it expires. */
function CreateForm({ ready, onMade, onCancel }: { ready: Ready; onMade: (fresh: Fresh) => void; onCancel: () => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string>(String(DEFAULT_EXPIRY_DAYS));
  const [date, setDate] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date();
  const minDate = new Date(today.getTime() + DAY_MS).toISOString().slice(0, 10);
  const maxDate = new Date(today.getTime() + (MAX_EXPIRY_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  const offered = KEY_SCOPES.filter((s) => s.always || ready.scopes.includes(s.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Errors = {};
    if (!name.trim()) found.name = "Give the key a name.";
    if (ready.records && !purpose.trim()) found.purpose = "Say what the key is for.";
    if (ready.records && expiry === "custom") {
      const checked = expiryFrom({ date });
      if ("error" in checked) found.date = date ? checked.error : "Pick a date.";
    }
    setErrors(found);
    setFailure(null);
    const first = (["name", "purpose", "date"] as const).find((f) => found[f]);
    if (first) {
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    const chosen = scopes.filter((s) => ready.scopes.includes(s));
    const body = ready.records
      ? { label: name, purpose, scopes: chosen, ...(expiry === "custom" ? { expiresOn: date } : { expiresInDays: Number(expiry) }) }
      : { label: name, ...(chosen.includes("read:own") ? { builds: true } : {}) };
    setBusy(true);
    try {
      const made = await send("POST", "/api/keys", body);
      onMade({ token: made.token, name: name.trim(), expiresAt: made.expires_at ?? null, rolled: false });
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const described = (field: keyof Errors, hint?: string) => [hint, errors[field] ? `${id}-${field}-error` : null].filter(Boolean).join(" ") || undefined;
  const fieldError = (field: keyof Errors) => errors[field] && <p id={`${id}-${field}-error`} className="text-sm text-fg">{errors[field]}</p>;

  return (
    <form noValidate onSubmit={submit} aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-line bg-panel p-4">
      <h3 id={`${id}-title`} className="font-semibold text-fg">Create API key</h3>

      <div className="space-y-1">
        <label htmlFor={`${id}-name`} className="block text-sm text-fg">Name</label>
        <input id={`${id}-name`} className={input} value={name} maxLength={60} required autoFocus aria-invalid={!!errors.name}
          aria-describedby={described("name")} onChange={(e) => setName(e.target.value)} placeholder="My drop-rate script" />
        {fieldError("name")}
      </div>

      {ready.records && (
        <div className="space-y-1">
          <label htmlFor={`${id}-purpose`} className="block text-sm text-fg">What it&apos;s for</label>
          <textarea id={`${id}-purpose`} className={`${input} py-2`} rows={2} value={purpose} maxLength={PURPOSE_MAX} required aria-invalid={!!errors.purpose}
            aria-describedby={described("purpose", `${id}-purpose-hint`)} onChange={(e) => setPurpose(e.target.value)}
            placeholder="A spreadsheet of drop rates for my guild" />
          <p id={`${id}-purpose-hint`} className="text-xs text-muted">A sentence is enough. We keep it with the key so we know what keys are used for.</p>
          {fieldError("purpose")}
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm text-fg">Permissions</legend>
        {offered.map((s) => (
          <label key={s.id} className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={s.always || scopes.includes(s.id)} disabled={s.always}
              onChange={(e) => setScopes(e.target.checked ? [...scopes, s.id] : scopes.filter((x) => x !== s.id))} />
            <span>
              <span className="text-fg">{s.label}</span>{s.always && <span className="text-muted"> (every key)</span>}
              <span className="block text-muted">{s.note}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {ready.records && (
        <fieldset className="space-y-2">
          <legend className="text-sm text-fg">Expires after</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {[...EXPIRY_DAYS.map(String), "custom"].map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm text-fg">
                <input type="radio" name={`${id}-expiry`} value={value} className="size-5" checked={expiry === value} onChange={() => setExpiry(value)} />
                {value === "custom" ? "Custom date" : EXPIRY_LABEL[Number(value)]}
                {value === String(DEFAULT_EXPIRY_DAYS) && <span className="text-muted">(recommended)</span>}
              </label>
            ))}
          </div>
          {expiry === "custom" ? (
            <div className="space-y-1">
              <label htmlFor={`${id}-date`} className="block text-sm text-fg">Last day the key works (UTC)</label>
              <input id={`${id}-date`} type="date" className={`${input} max-w-56`} value={date} min={minDate} max={maxDate} aria-invalid={!!errors.date}
                aria-describedby={described("date")} onChange={(e) => setDate(e.target.value)} />
              {fieldError("date")}
            </div>
          ) : (
            <p className="text-xs text-muted">Expires on {new Date(today.getTime() + Number(expiry) * DAY_MS).toISOString().slice(0, 10)}. You can roll it for a new secret before then.</p>
          )}
        </fieldset>
      )}

      {failure && <p role="alert" className="text-sm text-fg">{failure}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primary} disabled={busy} aria-busy={busy}>Create key</button>
        <button type="button" className={button} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * The signed-in player's keys on /account and /docs/api/keys: create one (name, purpose, permissions, expiry), see
 * each key's permissions, dates and last use, roll one to a new secret, revoke one, delete a revoked or expired one.
 * Before 20261022120000_api_key_expiry.sql is applied the server says `records: false`, and the form asks only for
 * a name and permissions, as before.
 */
export default function ApiKeys() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: "revoke" | "roll" } | null>(null);
  /** Where keyboard focus goes once a confirm box closes: the button that opened it, or the key's row. */
  const [returnTo, setReturnTo] = useState<{ id: string; action: "revoke" | "roll" | "row" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const createButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => { if (confirming) confirmButton.current?.focus(); }, [confirming]);
  useEffect(() => {
    if (!returnTo || confirming) return;
    const row = Array.from(list.current?.children ?? []).find((li) => (li as HTMLElement).dataset.key === returnTo.id) as HTMLElement | undefined;
    const target = row?.querySelector<HTMLElement>(`[data-action="${returnTo.action}"]`) ?? row ?? list.current ?? createButton.current;
    target?.focus();
    setReturnTo(null);
  }, [returnTo, confirming, state]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/keys", { cache: "no-store" });
        const body = await response.json();
        if (!active) return;
        if (response.status === 401) setState({ status: "signed-out" });
        else if (response.status === 503 && body.error === "API keys are not switched on yet.") setState({ status: "off" });
        else if (!response.ok) setState({ status: "error", message: body.error ?? "Keys are unavailable." });
        else {
          const ownScope = body.ownScope === true;
          setState({
            status: "ready", keys: body.keys, limit: body.limit, ownScope, records: body.records === true,
            scopes: Array.isArray(body.scopes) ? body.scopes : ["read:public", ...(ownScope ? ["read:own"] : [])],
          });
        }
      } catch {
        if (active) setState({ status: "error", message: "Keys are unavailable. Try again." });
      }
    })();
    return () => { active = false; };
  }, [reload]);

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await run(); } catch (err) { setError(err instanceof Error ? err.message : "That did not work. Try again."); } finally { setBusy(false); }
  }

  // The revoked key keeps its row (its Roll and Revoke buttons go), so focus lands on the row.
  const revoke = (k: KeyRow) => act(async () => {
    await send("DELETE", `/api/keys?id=${encodeURIComponent(k.id)}`);
    setConfirming(null);
    setReturnTo({ id: k.id, action: "row" });
    setReload((n) => n + 1);
  });
  const erase = (k: KeyRow) => act(async () => { await send("DELETE", `/api/keys?id=${encodeURIComponent(k.id)}&erase=1`); setReload((n) => n + 1); });
  const roll = (k: KeyRow) => act(async () => {
    const made = await send("POST", `/api/keys?roll=${encodeURIComponent(k.id)}`);
    setConfirming(null);
    setFresh({ token: made.token, name: k.label || `evl_…${k.hint}`, expiresAt: made.expires_at ?? null, rolled: true });
    setReload((n) => n + 1);
  });

  if (state.status === "loading") return <p className="text-sm text-muted">Checking your account…</p>;
  if (state.status === "off") return <p className="text-sm text-muted">Keys are not switched on yet. Until they are, every endpoint works without one.</p>;
  if (state.status === "error") return <p role="alert" className="text-sm text-fg">{state.message}</p>;
  if (state.status === "signed-out") {
    return <p className="text-fg-2"><a href="/sign-in" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Sign in</a> to make a key.</p>;
  }
  const now = Date.now();
  const live = state.keys.filter((k) => !k.revoked_at && !keyExpired(k, now)).length;
  const full = live >= state.limit;

  return (
    <div className="space-y-4">
      {fresh && <Reveal fresh={fresh} onDone={() => { setFresh(null); setTimeout(() => createButton.current?.focus(), 0); }} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-2">{live} of {state.limit} active keys</p>
        {!creating && (
          <button ref={createButton} type="button" className={primary} disabled={full} aria-describedby={full ? "api-keys-full" : undefined}
            onClick={() => { setCreating(true); setFresh(null); }}>Create API key</button>
        )}
      </div>
      {full && !creating && <p id="api-keys-full" className="text-sm text-muted">You have {state.limit} active keys. Revoke one to make another.</p>}

      {creating && (
        <CreateForm ready={state}
          onMade={(made) => { setCreating(false); setFresh(made); setReload((n) => n + 1); }}
          onCancel={() => { setCreating(false); setTimeout(() => createButton.current?.focus(), 0); }} />
      )}

      {state.keys.length > 0 && (
        <ul ref={list} tabIndex={-1} aria-label="Your API keys" className="divide-y divide-line border-y border-line">
          {state.keys.map((k) => {
            const expired = !k.revoked_at && keyExpired(k, now);
            const status = k.revoked_at ? `Revoked ${day(k.revoked_at)}` : expired ? "Expired" : "Active";
            const asking = confirming?.id === k.id ? confirming.action : null;
            const name = k.label || "Unnamed key";
            return (
              <li key={k.id} data-key={k.id} tabIndex={-1} className="space-y-2 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold text-fg">{name}</span>
                  <span className={`rounded-full border px-2 text-xs ${status === "Active" ? "border-accent text-accent" : "border-line text-fg-2"}`}>{status}</span>
                </div>
                {k.purpose && <p className="text-sm text-fg-2">{k.purpose}</p>}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                  <dt className="text-muted">Key</dt><dd><code className="font-mono text-fg">evl_…{k.hint}</code></dd>
                  <dt className="text-muted">Permissions</dt><dd className="text-fg-2">{(k.scopes ?? ["read:public"]).map(scopeLabel).join(", ")}</dd>
                  <dt className="text-muted">Created</dt><dd className="text-fg-2">{day(k.created_at)}</dd>
                  <dt className="text-muted">Expires</dt><dd className="text-fg-2">{expiresText(k, now)}</dd>
                  <dt className="text-muted">Last used</dt><dd className="text-fg-2">{day(k.last_used_at)}</dd>
                </dl>
                {asking ? (
                  <div role="group" aria-label={`Confirm ${asking} ${name}`} className="space-y-2 rounded-lg border border-line bg-panel p-3">
                    <p className="text-sm text-fg">
                      {asking === "revoke"
                        ? `Revoke ${name}? Anything using evl_…${k.hint} stops working at once.`
                        : `Roll ${name}? You get a new secret with the same name, permissions and lifetime. evl_…${k.hint} stops working at once.`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button ref={confirmButton} type="button" className={primary} disabled={busy} onClick={() => void (asking === "revoke" ? revoke(k) : roll(k))}>
                        {asking === "revoke" ? "Revoke key" : "Roll key"}
                      </button>
                      <button type="button" className={button} onClick={() => { setConfirming(null); setReturnTo({ id: k.id, action: asking }); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {!k.revoked_at && state.records && (
                      <button type="button" data-action="roll" className={button} disabled={busy || (expired && full)} aria-label={`Roll ${name}`} onClick={() => setConfirming({ id: k.id, action: "roll" })}>Roll</button>
                    )}
                    {!k.revoked_at && !expired && (
                      <button type="button" data-action="revoke" className={button} disabled={busy} aria-label={`Revoke ${name}`} onClick={() => setConfirming({ id: k.id, action: "revoke" })}>Revoke</button>
                    )}
                    {(k.revoked_at || expired) && (
                      <button type="button" className={button} disabled={busy} aria-label={`Delete ${name}`} onClick={() => void erase(k)}>Delete</button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-fg">{error}</p>}
    </div>
  );
}
