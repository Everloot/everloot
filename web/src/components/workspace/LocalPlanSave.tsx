"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ACCOUNT_CHANGED_EVENT } from "@/components/AccountControls";
import { Input } from "@/components/ui";
import {
  WORKSPACE_LIMITS, deviceStorage, lookupOwner, orderState, readWorkspace, sameOwner, savePlan, type LocalPlan, type Owner,
} from "@/lib/player-workspace";

// Save on this device, for the talent calculator beside its account Save: the plan is kept by name in this
// browser (lib/player-workspace.ts), with no account and nothing sent. The calculator passes its codes and orders
// in as they are now; the widget never reads them from the address, which the calculator rewrites as points go in.

export type OwnerState = { status: "checking" } | { status: "ready"; owner: Owner } | { status: "unavailable" };

/**
 * Whose plans this browser shows, from /api/auth/me: asked when the page opens, again each time the tab comes back
 * (another tab may have signed in, out or into another account), and at once after Sign out in this tab
 * (ACCOUNT_CHANGED_EVENT). Only the latest answer counts. A failed check after a good one keeps the owner it had,
 * but a sign-out is certain: it drops every answer already asked for, at once, and starts over as `retry` does,
 * with no one's plans until the next answer.
 */
export function useWorkspaceOwner(): [OwnerState, () => void] {
  const [state, setState] = useState<OwnerState>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);
  // Show no one's plans and ask again; the answers asked for before are dropped when the check restarts.
  const retry = useCallback(() => { setState({ status: "checking" }); setAttempt((n) => n + 1); }, []);
  useEffect(() => {
    let active = true;
    let asked = 0;
    async function check() {
      const ask = ++asked;
      const found = await lookupOwner();
      if (!active || ask !== asked) return;
      setState((now) => {
        if (!found.ok) return now.status === "ready" ? now : { status: "unavailable" };
        return now.status === "ready" && sameOwner(now.owner, found.owner) ? now : { status: "ready", owner: found.owner };
      });
    }
    void check();
    const onShow = () => void check();
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    // A sign-out drops the answers already asked for now, not when the check restarts: one landing before then
    // would bring the old account back.
    const onChanged = () => { active = false; retry(); };
    window.addEventListener("focus", onShow);
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
    return () => {
      active = false;
      window.removeEventListener("focus", onShow);
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
    };
  }, [attempt, retry]);
  return [state, retry];
}

const button = "btn px-3 text-sm sm:px-5";

/** "Saved "Frost" on this device.", and which sets have no spend order a reader can use. */
function savedLine(plan: LocalPlan, updated: boolean): string {
  const unknown = ([[plan.code, plan.order], [plan.code2, plan.order2]] as const)
    .flatMap(([code, token], i) => (code && !orderState(code, token).known ? [i + 1] : []));
  const order = unknown.length === 2 ? " Both sets' spend orders are unknown." : unknown.length === 1 ? ` Set ${unknown[0]}'s spend order is unknown.` : "";
  return `${updated ? "Updated" : "Saved"} "${plan.name}" on this device.${order}`;
}

export default function LocalPlanSave({ classSlug, codes, orders, defaultName, onMessage }: {
  classSlug: string;
  /** The two sets' share codes as they are now; the first is null until set 1 has a point. */
  codes: [string | null, string | null];
  /** Each set's spend order token, null when the order is unknown. */
  orders: [string | null, string | null];
  defaultName: string;
  onMessage: (text: string) => void;
}) {
  const [ownerState] = useWorkspaceOwner();
  const owner = ownerState.status === "ready" ? ownerState.owner : null;
  /** The owner the panel was opened for; null while it is closed. */
  const [openFor, setOpenFor] = useState<Owner | null>(null);
  const [plans, setPlans] = useState<LocalPlan[]>([]);
  const [form, setForm] = useState({ target: "", name: "", notes: "" });
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The name the build bar shows now, for a new plan.
  const nameNow = useRef(defaultName);
  nameNow.current = defaultName;

  // What was typed for one account is never saved into another: a switch closes the panel, and so does a sign-out,
  // which leaves no owner until the next answer.
  useEffect(() => {
    if (!openFor || (owner && sameOwner(openFor, owner))) return;
    setOpenFor(null);
    setLastSaved(null);
    onMessage(owner
      ? "You are signed in to a different account now, so nothing was saved. Press Save on this device again to save it under this one."
      : "The account signed in here changed, so nothing was saved. Press Save on this device again.");
  }, [owner, openFor, onMessage]);

  function pick(target: string, from: LocalPlan[] = plans) {
    const plan = from.find((p) => p.id === target);
    setForm({ target: plan?.id ?? "", name: plan?.name ?? nameNow.current, notes: plan?.notes ?? "" });
  }

  function toggle() {
    if (openFor) { setOpenFor(null); return; }
    if (!owner) { onMessage("Your account could not be checked, so nothing was saved. Reload the page and try again."); return; }
    const read = readWorkspace(deviceStorage(), owner);
    if (!read.ok) { onMessage(read.message); return; }
    const mine = read.workspace.plans.filter((p) => p.classSlug === classSlug);
    setPlans(mine);
    pick(lastSaved ?? "", mine);
    setError(null);
    setOpenFor(owner);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openFor || !owner || !sameOwner(openFor, owner)) return;
    const result = savePlan(deviceStorage(), openFor, { id: form.target || null, name: form.name, notes: form.notes, classSlug, codes, orders });
    if (!result.ok) { setError(result.message); return; }
    setLastSaved(result.plan.id);
    setOpenFor(null);
    onMessage(savedLine(result.plan, form.target !== ""));
  }

  return (
    <>
      <button type="button" className={button} onClick={toggle} disabled={!codes[0] || ownerState.status === "checking"} aria-expanded={openFor !== null}
        title={codes[0] ? undefined : "Spend a point in set 1 to save"}>Save on this device</button>

      {openFor && (
        <form aria-label="Save on this device" onSubmit={submit} className="order-last grid basis-full gap-3 rounded-control border border-line bg-canvas p-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="block text-muted">Save as</span>
            <select value={form.target} onChange={(e) => pick(e.target.value)}
              className="min-h-11 w-full rounded-control border border-edge bg-canvas px-3 text-base text-fg">
              <option value="">A new plan</option>
              {plans.map((p) => <option key={p.id} value={p.id}>Replace {p.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="block text-muted">Name</span>
            <Input required maxLength={WORKSPACE_LIMITS.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="block text-muted">Notes (optional)</span>
            <textarea maxLength={WORKSPACE_LIMITS.notes} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full rounded-control border border-edge bg-canvas px-3 py-2 text-base text-fg" />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 sm:justify-end">
            <button type="submit" className={`${button} btn-primary`}>{form.target ? "Replace plan" : "Save plan"}</button>
            <button type="button" className={button} onClick={() => setOpenFor(null)}>Cancel</button>
          </div>
          {error && <p role="alert" className="text-sm text-fg sm:col-span-2">{error}</p>}
          <p className="text-xs text-muted sm:col-span-2">
            Kept in this browser only{openFor.kind === "account" ? ", with the account you are signed in to" : ""}. Nothing is uploaded.{" "}
            <a href="/tools/builds" className="text-fg-2 underline decoration-edge underline-offset-4 hover:decoration-fg">Plans on this device</a>
          </p>
        </form>
      )}
    </>
  );
}
