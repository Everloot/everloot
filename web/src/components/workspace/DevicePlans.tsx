"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { className } from "@/components/builds/describe";
import { Card, CopyButton, Field, SectionHeading } from "@/components/ui";
import { restoreLines } from "@/lib/alt-workspace";
import {
  BACKUP_TOO_LARGE, WORKSPACE_LIMITS, applyImport, bucketKey, copyPlan, deletePlan, deviceStorage, editPlan, exportBackup, hiddenFrom, storedCounts,
  orderState, previewImport, readPlanText, readWorkspace, sameOwner, savePlan, sentPlans, withWorkspaceLock,
  type Failure, type ImportPreview, type LocalPlan, type Owner, type PlanText, type ReadResult,
} from "@/lib/player-workspace";
import { planHash, replacePlanHash } from "@/lib/talents/import";
import { useWorkspaceOwner } from "./LocalPlanSave";

// /tools/builds: the plans kept in this browser (lib/player-workspace.ts) for whoever is signed in now, or for
// the browser signed out. Named, opened, edited, copied, deleted, backed up and restored here, with nothing sent:
// the page asks the network only who is signed in. The calculator's Save on this device opens it with the plan in
// the address fragment, to be named and saved here. Every change is made holding the workspace lock
// (withWorkspaceLock), one tab at a time, as a transfer's are. A signed-out plan an account has now (a transfer saved
// it there) is that account's: it is not shown here, or in a backup from here (hiddenFrom).

const action = "inline-flex min-h-8 items-center px-1.5 text-cell text-fg-2 hover:text-accent disabled:opacity-60";
const textarea = "w-full rounded-control border border-edge bg-canvas px-3 py-2 text-base text-fg";

/** A saved order says who made it, not that it fits the tree: shown wherever orders are. */
const UNCHECKED = "Spend orders show as they were saved. The calculator checks them against the talent tree only when a plan opens.";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const day = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The calculator's address for a plan: both sets, each with its order, in the fragment that never reaches the server. */
const openPath = (plan: LocalPlan) => `/tools/talents/${plan.classSlug}${planHash(plan.code, plan.code2, plan.order, plan.order2)}`;

/** What each set's token says about its spend order. The calculator checks the order against the tree on opening. */
function setsLine(codes: [string, string | null], orders: [string | null, string | null]): string {
  return codes.flatMap((code, i) => {
    if (!code) return [];
    const state = orderState(code, orders[i]);
    const order = state.known ? `${state.origin} order`
      : state.reason === "none" ? "order unknown" : state.reason === "newer-version" ? "order from a newer version" : "order unreadable";
    return [`Set ${i + 1}: ${order}`];
  }).join(" · ");
}

/** Hands the browser one file, as Chat's export does; the file's link is let go once the download starts. */
function saveFile(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Takes the sent plan out of the address, leaving any other part there (a cookie choice) as it was. */
function dropSent() {
  const hash = replacePlanHash(window.location.hash, "");
  if (hash !== window.location.hash) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
}

export default function DevicePlans() {
  const [state, retry] = useWorkspaceOwner();
  const owner = state.status === "ready" ? state.owner : null;
  // The plan the calculator sent, read from the address once, and the owner it was first shown to. It is offered to
  // that owner only, after the check says who that is, and nothing is saved until Save is pressed. Another owner
  // withdraws it: what was typed for one owner is never saved for the next.
  const [sent, setSent] = useState<{ plan: PlanText; owner: Owner | null } | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  useEffect(() => {
    if (/[#&]plan2?=/.test(window.location.hash)) setSent({ plan: readPlanText(window.location.hash), owner: null });
  }, []);
  useEffect(() => {
    if (!owner || !sent) return;
    if (!sent.owner) setSent({ ...sent, owner });
    else if (!sameOwner(sent.owner, owner)) { setSent(null); setWithdrawn(true); dropSent(); }
  }, [owner, sent]);

  if (state.status === "checking") return <p role="status" className="text-sm text-muted">Checking who is signed in…</p>;
  if (state.status === "unavailable") {
    return (
      <Card>
        <p role="alert" className="text-fg">Your account could not be checked, so no plans are shown. This page shows the signed-in account&apos;s plans, or the signed-out ones, never a guess.</p>
        <button type="button" className="btn mt-4 text-sm" onClick={retry}>Try again</button>
      </Card>
    );
  }
  const offered = sent && (!sent.owner || sameOwner(sent.owner, state.owner)) ? sent.plan : null;
  // One bucket at a time. Another owner remounts everything below, so nothing begun for one bucket ends in another.
  return (
    <>
      {withdrawn && (
        <p role="status" className="mb-6 text-sm text-fg-2">
          Who is signed in here changed, so the plan from the calculator was not saved. To keep it, go back to the calculator and press Save on this device again.
        </p>
      )}
      <Bucket key={bucketKey(state.owner)} owner={state.owner} sent={offered} onSentDone={() => { setSent(null); dropSent(); }} />
    </>
  );
}

function Bucket({ owner, sent, onSentDone }: { owner: Owner; sent: PlanText | null; onSentDone: () => void }) {
  const [read, setRead] = useState<ReadResult | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ text: string; alert: boolean; inUse?: boolean } | null>(null);
  const reload = useCallback(() => {
    const storage = deviceStorage();
    const now = readWorkspace(storage, owner);
    setRead(now);
    setHidden(now.ok ? hiddenFrom(storage, owner, now.workspace) : new Set());
  }, [owner]);
  useEffect(() => {
    reload();
    // Another tab's change to this bucket shows here too. Signed out, so does one to an account's, which may take a plan.
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === bucketKey(owner) || owner.kind === "anonymous") reload(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [owner, reload]);

  if (!read) return null;
  const intro = (
    <p className="text-sm text-fg-2">
      {owner.kind === "anonymous"
        ? "Plans saved while signed out. Signed in, this page shows that account's plans instead, and these wait here for when you sign out."
        : "Plans saved on this device while signed in to this account. Signed out or under another account this page does not show them, but they are not encrypted: anyone using this browser can read its storage."}
    </p>
  );
  if (!read.ok) {
    const cleared = (refused: string | null) => { reload(); setMessage(refused ? { text: refused, alert: true } : null); };
    return <div className="space-y-6">{intro}<StoredProblem read={read} owner={owner} onCleared={cleared} /></div>;
  }

  /** Shows what a change did; the list is read back from storage, so it never shows a save that did not happen. */
  const after = (result: { ok: true } | Failure, done: string) => {
    reload();
    setMessage(result.ok ? { text: done, alert: false } : { text: result.message, alert: true, inUse: result.error === "referenced" });
    return result.ok;
  };
  const shown = read.workspace.plans.filter((p) => !hidden.has(p.id));
  const plans = [...shown].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="space-y-8">
      {intro}
      {sent && (sent.ok
        ? <SaveSent found={sent} plans={shown} owner={owner} onDone={(saved) => { onSentDone(); if (saved) after({ ok: true }, saved); }} />
        : <SentProblem message={sent.message} onClose={onSentDone} />)}
      <SaveFromLink owner={owner} onSaved={(text) => after({ ok: true }, text)} />
      <section aria-labelledby="device-plans">
        <SectionHeading id="device-plans" note={`${plans.length} of ${WORKSPACE_LIMITS.plans}, newest first. ${UNCHECKED}`}>Your plans</SectionHeading>
        <p role="status" className="mb-3 text-sm text-fg-2 empty:hidden">{message && !message.alert ? message.text : ""}</p>
        {message?.alert && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {message.text}
            {message.inUse && <> See <a href="/tools/alts" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Alts on this device</a> to let go of it there first.</>}
          </p>
        )}
        {plans.length === 0 ? (
          // EmptyState's meter counts agreeing installs, which a device's own plans have nothing to do with.
          <Card>
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
              <p className="min-w-0 flex-1 text-fg-2">No plans on this device yet. Paste a talent link above to keep one here by name.</p>
              <a href="/tools/talents" className="btn shrink-0">Open the calculator</a>
            </div>
          </Card>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {plans.map((plan) => (
              <PlanItem
                key={plan.id}
                plan={plan}
                onEdit={async (edit) => {
                  const result = await withWorkspaceLock(() => editPlan(deviceStorage(), owner, plan.id, edit));
                  if (result.ok) { after(result, `Saved "${result.plan.name}".`); return null; }
                  // A plan deleted in another tab leaves the list, and its form with it: say so above the list.
                  if (result.error === "missing") { after(result, ""); return null; }
                  return result.message;
                }}
                onCopy={async () => { const result = await withWorkspaceLock(() => copyPlan(deviceStorage(), owner, plan.id)); after(result, result.ok ? `Made "${result.plan.name}".` : ""); }}
                onDelete={async () => after(await withWorkspaceLock(() => deletePlan(deviceStorage(), owner, plan.id)), `Deleted "${plan.name}" from this device.`)}
                onCopied={(ok) => setMessage(ok
                  ? { text: "Link copied. It opens the plan in the talent calculator.", alert: false }
                  : { text: "Copy failed. Use Open, then copy the address.", alert: true })}
              />
            ))}
          </ul>
        )}
      </section>
      <Backup owner={owner} onRestored={(result, done) => after(result, done)} />
    </div>
  );
}

function PlanItem({ plan, onEdit, onCopy, onDelete, onCopied }: {
  plan: LocalPlan;
  /** Null when it saved, else why not. */
  onEdit: (edit: { name: string; notes: string }) => Promise<string | null>;
  onCopy: () => void;
  onDelete: () => void;
  onCopied: (ok: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="min-w-0 font-semibold text-fg [overflow-wrap:anywhere]">{plan.name}</h3>
        <span className="text-meta text-muted">{className(plan.classSlug)} · updated {day(plan.updatedAt)}</span>
      </div>
      <p className="text-sm text-fg-2">{setsLine([plan.code, plan.code2], [plan.order, plan.order2])}</p>
      {plan.notes && <p className="whitespace-pre-line text-sm text-fg-2 [overflow-wrap:anywhere]">{plan.notes}</p>}
      <div className="flex flex-wrap items-center gap-x-1">
        <a href={openPath(plan)} className={action}>Open</a>
        <CopyButton className={action} text={() => new URL(openPath(plan), window.location.origin).href} label="Copy link" onResult={onCopied} />
        <button type="button" className={action} aria-expanded={editing} onClick={() => setEditing(!editing)}>Edit</button>
        <button type="button" className={action} onClick={onCopy}>Make a copy</button>
        {confirming ? (
          <button type="button" className={`${action} text-fg`} onClick={onDelete}>Delete for good</button>
        ) : (
          <button type="button" className={action} onClick={() => setConfirming(true)}>Delete</button>
        )}
      </div>
      {editing && <EditForm plan={plan} onSave={async (edit) => { const error = await onEdit(edit); if (!error) setEditing(false); return error; }} onCancel={() => setEditing(false)} />}
    </li>
  );
}

function EditForm({ plan, onSave, onCancel }: { plan: LocalPlan; onSave: (edit: { name: string; notes: string }) => Promise<string | null>; onCancel: () => void }) {
  const [form, setForm] = useState({ name: plan.name, notes: plan.notes });
  const [error, setError] = useState<string | null>(null);
  return (
    <form aria-label={`Edit ${plan.name}`} onSubmit={async (e) => { e.preventDefault(); setError(await onSave(form)); }}
      className="grid gap-3 rounded-control border border-line bg-canvas p-3 sm:grid-cols-2">
      <Field label="Name" required maxLength={WORKSPACE_LIMITS.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label className="block space-y-1 text-sm sm:col-span-2">
        <span className="block text-muted">Notes (optional)</span>
        <textarea maxLength={WORKSPACE_LIMITS.notes} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={textarea} />
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" className="btn btn-primary text-sm">Save</button>
        <button type="button" className="btn text-sm" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
    </form>
  );
}

/** A plan from a pasted calculator link or share code, named here and saved on this device. */
function SaveFromLink({ owner, onSaved }: { owner: Owner; onSaved: (text: string) => void }) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<Extract<PlanText, { ok: true }> | null>(null);
  const [form, setForm] = useState({ name: "", notes: "" });
  const [error, setError] = useState<string | null>(null);

  function read(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = readPlanText(text);
    setFound(result.ok ? result : null);
    setError(result.ok ? null : result.message);
    if (result.ok) setForm({ name: `${className(result.classSlug)} plan`, notes: "" });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!found) return;
    const input = { ...form, classSlug: found.classSlug, codes: found.codes, orders: found.orders };
    const result = await withWorkspaceLock(() => savePlan(deviceStorage(), owner, input));
    if (!result.ok) { setError(result.message); return; }
    setFound(null);
    setText("");
    setError(null);
    onSaved(`Saved "${result.plan.name}" on this device.`);
  }

  return (
    <Card as="section" aria-labelledby="device-plans-add">
      <SectionHeading id="device-plans-add" note="Paste a link from the talent calculator, or a share code, to keep that plan here by name.">Save a plan from a link</SectionHeading>
      <form onSubmit={read} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <Field label="Talent link or share code" mono value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button type="submit" className="btn text-sm">Read the link</button>
      </form>
      {found && (
        <form aria-label="Name the plan" onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2">
          <p className="text-sm text-fg-2 sm:col-span-2">{className(found.classSlug)} · {setsLine(found.codes, found.orders)}</p>
          <p className="text-sm text-muted sm:col-span-2">{UNCHECKED}</p>
          <Field label="Name" required maxLength={WORKSPACE_LIMITS.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="block text-muted">Notes (optional)</span>
            <textarea maxLength={WORKSPACE_LIMITS.notes} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={textarea} />
          </label>
          <div className="sm:col-span-2"><button type="submit" className="btn btn-primary text-sm">Save plan</button></div>
        </form>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Card>
  );
}

/** The plan Save on this device sent from the calculator: saved here by name, as a new plan or in place of one of this
 *  class's plans, only when Save is pressed. */
function SaveSent({ found, plans, owner, onDone }: {
  found: Extract<PlanText, { ok: true }>;
  plans: LocalPlan[];
  owner: Owner;
  /** What was saved, to say so; null when the plan was let go unsaved. */
  onDone: (saved: string | null) => void;
}) {
  const fresh = `${className(found.classSlug)} plan`;
  const same = plans.filter((p) => p.classSlug === found.classSlug);
  const [form, setForm] = useState({ target: "", name: fresh, notes: "" });
  const [error, setError] = useState<string | null>(null);

  function pick(target: string) {
    const plan = same.find((p) => p.id === target);
    setForm({ target: plan?.id ?? "", name: plan?.name ?? fresh, notes: plan?.notes ?? "" });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { id: form.target || null, name: form.name, notes: form.notes, classSlug: found.classSlug, codes: found.codes, orders: found.orders };
    const result = await withWorkspaceLock(() => savePlan(deviceStorage(), owner, input));
    if (!result.ok) { setError(result.message); return; }
    onDone(`${form.target ? "Updated" : "Saved"} "${result.plan.name}" on this device.`);
  }

  return (
    <Card as="section" aria-labelledby="device-plans-sent">
      <SectionHeading id="device-plans-sent" note="Sent from the talent calculator. Nothing is saved until you press Save.">Save the plan from the calculator</SectionHeading>
      <form aria-label="Save the plan from the calculator" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <p className="text-sm text-fg-2 sm:col-span-2">{className(found.classSlug)} · {setsLine(found.codes, found.orders)}</p>
        <p className="text-sm text-muted sm:col-span-2">{UNCHECKED}</p>
        <label className="block space-y-1 text-sm">
          <span className="block text-muted">Save as</span>
          <select value={form.target} onChange={(e) => pick(e.target.value)} className="min-h-11 w-full rounded-control border border-edge bg-canvas px-3 text-base text-fg">
            <option value="">A new plan</option>
            {same.map((p) => <option key={p.id} value={p.id}>Replace {p.name}</option>)}
          </select>
        </label>
        <Field label="Name" required maxLength={WORKSPACE_LIMITS.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label className="block space-y-1 text-sm sm:col-span-2">
          <span className="block text-muted">Notes (optional)</span>
          <textarea maxLength={WORKSPACE_LIMITS.notes} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={textarea} />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" className="btn btn-primary text-sm">{form.target ? "Replace plan" : "Save plan"}</button>
          <button type="button" className="btn text-sm" onClick={() => onDone(null)}>Cancel</button>
        </div>
        {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      </form>
    </Card>
  );
}

/** A plan the calculator sent that does not read: why, and nothing saved. */
function SentProblem({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Card as="section" aria-labelledby="device-plans-sent">
      <SectionHeading id="device-plans-sent">Save the plan from the calculator</SectionHeading>
      <p role="alert" className="text-sm text-danger">{message} Nothing was saved.</p>
      <button type="button" className="btn mt-3 text-sm" onClick={onClose}>Close</button>
    </Card>
  );
}

function previewLine(p: ImportPreview): string {
  const parts = [
    p.added > 0 ? `adds ${plural(p.added, "plan")}` : "",
    p.updated > 0 ? `updates ${plural(p.updated, "plan")} with the backup's newer copy` : "",
    p.others > 0 ? `restores ${plural(p.others, "alt or watch", "alts and watches")}` : "",
  ].filter(Boolean);
  const kept = p.kept > 0 ? ` ${plural(p.kept, "plan")} here ${p.kept === 1 ? "is" : "are"} newer than the backup's copy and ${p.kept === 1 ? "stays" : "stay"} as ${p.kept === 1 ? "it is" : "they are"}.` : "";
  if (parts.length === 0) return `Nothing to restore: this device already has everything in that backup.${kept}`;
  const said = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Restoring ${said}.${kept}`;
}

/** Download a backup of this bucket, or restore one after seeing what it would do. */
function Backup({ owner, onRestored }: { owner: Owner; onRestored: (result: { ok: true } | Failure, done: string) => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  // Alt by alt, what the restore adds or replaces, as Alts on this device shows it: a backup holds the alts too.
  const [altLines, setAltLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // Gone with its bucket: a file still being read when the account changes is not previewed for the next one.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function download() {
    // This bucket as stored now, so a change another tab made is in the file too.
    const now = readWorkspace(deviceStorage(), owner);
    const backup = now.ok ? exportBackup(now.workspace, new Date(), hiddenFrom(deviceStorage(), owner, now.workspace)) : now;
    if (!backup.ok) { setError(backup.message); return; }
    setError(null);
    saveFile(backup.text, backup.fileName);
  }

  async function choose(file: File) {
    setError(null);
    setPreview(null);
    if (file.size > WORKSPACE_LIMITS.bytes) { setError(BACKUP_TOO_LARGE); return; }
    setReading(true);
    let text: string;
    try {
      text = await file.text();
    } catch {
      if (alive.current) { setReading(false); setError("That file could not be read. Nothing was changed."); }
      return;
    }
    if (!alive.current) return;
    setReading(false);
    // Previewed against the bucket as stored now, not as this page last showed it.
    const now = readWorkspace(deviceStorage(), owner);
    if (!now.ok) { setError(now.message); return; }
    const result = previewImport(text, now.workspace, sentPlans(deviceStorage()));
    if (!result.ok) { setError(result.message); return; }
    setPreview(result.preview);
    setAltLines(restoreLines(now.workspace, result.preview));
  }

  async function restore() {
    if (!preview) return;
    const shown = preview;
    setPreview(null);
    const result = await withWorkspaceLock(() => applyImport(deviceStorage(), owner, shown));
    onRestored(result, `Restored the backup: ${plural(shown.added, "plan")} added and ${shown.updated.toLocaleString("en-US")} updated.`);
  }

  const changes = preview ? preview.added + preview.updated + preview.others : 0;
  return (
    <Card as="section" aria-labelledby="device-plans-backup">
      <SectionHeading id="device-plans-backup" note="A backup holds the plans this page shows. It restores only here, never into another account's plans or the signed-out ones.">Back up and restore</SectionHeading>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn text-sm" onClick={download}>Download backup</button>
        {/* The input inside is hidden, so the label shows the site's focus ring while it has focus. */}
        <label className="btn cursor-pointer text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">Restore from a backup
          <input aria-label="Choose a backup file" type="file" accept=".json,application/json" className="sr-only" disabled={reading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); e.target.value = ""; }} />
        </label>
      </div>
      {reading && <p className="mt-3 text-sm text-muted" role="status">Reading the backup…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {preview && (
        <div role="group" aria-label="What the restore would do" className="mt-4 space-y-3 rounded-control border border-line bg-canvas p-3">
          <p className="text-sm text-fg">{previewLine(preview)}</p>
          {/* Two alts of one name read alike here, so a line is known by its place. */}
          {altLines.map((line, i) => <p key={i} className="text-sm text-fg">{line}</p>)}
          {preview.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          <div className="flex flex-wrap gap-2">
            {changes > 0 && <button type="button" className="btn btn-primary text-sm" onClick={restore}>Restore</button>}
            <button type="button" className="btn text-sm" onClick={() => setPreview(null)}>{changes > 0 ? "Cancel" : "Close"}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Said when the stored text changed between Clear being confirmed and done. */
const NOT_CLEARED = "What is stored here changed in another tab, so nothing was cleared.";

/** Stored plans that do not read: kept as they are, with their text to download. Damaged ones can be cleared,
 *  after saying everything that deletes and offering the download again, and only as they were when that was said;
 *  a newer version's are left for that version to open. `onCleared` is told why nothing was cleared, if it was not. */
function StoredProblem({ read, owner, onCleared }: { read: Extract<ReadResult, { ok: false }>; owner: Owner; onCleared: (refused: string | null) => void }) {
  /** The stored text the player is asked to clear, as shown: other text needs asking of its own. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const raw = read.raw;
  async function clear(confirmed: string) {
    // Under the lock, and only the text confirmed: text another tab changed, or repaired, while this waited stays.
    const cleared = await withWorkspaceLock(() => {
      try {
        const storage = deviceStorage();
        if (storage?.getItem(bucketKey(owner)) !== confirmed) return false;
        storage.removeItem(bucketKey(owner));
      } catch { /* the read that follows says what is still there */ }
      return true;
    });
    setConfirming(null);
    setRefused(!cleared);
    onCleared(cleared ? null : NOT_CLEARED);
  }
  const download = (text: string) => saveFile(text, `everloot-plans-stored-${new Date().toISOString().slice(0, 10)}.txt`);
  return (
    <Card>
      <p role="alert" className="text-fg">{read.message}</p>
      {refused && <p role="alert" className="mt-3 text-sm text-danger">{NOT_CLEARED}</p>}
      {raw !== null && confirming !== raw && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn text-sm" onClick={() => download(raw)}>Download what is stored</button>
          {read.error === "corrupt" && <button type="button" className="btn text-sm" onClick={() => { setRefused(false); setConfirming(raw); }}>Clear stored plans</button>}
        </div>
      )}
      {raw !== null && read.error === "corrupt" && confirming === raw && (
        <div role="group" aria-label="Clear what is stored" className="mt-4 space-y-3 rounded-control border border-line bg-canvas p-3">
          <p className="text-sm text-fg">{clearingLine(raw, owner)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn text-sm" onClick={() => download(raw)}>Download what is stored</button>
            <button type="button" className="btn text-sm" onClick={() => clear(raw)}>Clear for good</button>
            <button type="button" className="btn text-sm" onClick={() => setConfirming(null)}>Cancel</button>
          </div>
        </div>
      )}
      {read.error === "corrupt" && confirming !== raw && <p className="mt-3 text-sm text-muted">Clearing removes it from this browser for good. Download it first to keep a copy.</p>}
    </Card>
  );
}

/** Everything clearing a damaged bucket deletes, counted where the stored text allows: the bucket holds alts and
 *  watches as well as plans, so all of them are named. */
function clearingLine(raw: string, owner: Owner): string {
  const whose = owner.kind === "account" ? "this account" : "this browser while signed out";
  const counts = storedCounts(raw);
  const held = counts
    ? `Here that is ${plural(counts.plans, "plan")}, ${plural(counts.alts, "alt")} and ${plural(counts.watches, "watch", "watches")}${counts.notes > 0 ? `, with notes on ${counts.notes.toLocaleString("en-US")} of them` : ""}.`
    : "It could not be read, so they cannot be counted.";
  return `Clearing deletes everything stored on this device for ${whose}: its plans, alts and watches, and their notes. ${held} This cannot be undone, so download it first to keep a copy.`;
}
