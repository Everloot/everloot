"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Card, Field, SectionHeading } from "@/components/ui";
import { useWorkspaceOwner } from "@/components/workspace/LocalPlanSave";
import {
  DETAIL_WORDS, FIELD_WORDS, altFailure, copyNumbers, deleteAlt, detailsLine, listOf, restoreLines, saveAlt, type AltField, type AltInput,
} from "@/lib/alt-workspace";
import {
  ALT_PROFESSIONS, BACKUP_TOO_LARGE, WORKSPACE_LIMITS, applyImport, bucketKey, deviceStorage, exportBackup, hiddenFrom, newFormatOverflow, previewImport,
  readWorkspace, sentPlans, type Failure, type ImportPreview, type LocalAlt, type LocalPlan, type Owner, type ReadResult,
} from "@/lib/player-workspace";
import { TALENT_CLASSES } from "@/lib/talents/catalogs";
import { planHash } from "@/lib/talents/import";
import ReadSaveFile from "./ReadSaveFile";

// /tools/alts: the player's characters in this browser's PlayerWorkspace (lib/player-workspace.ts), the same buckets
// as Plans on this device: for whoever is signed in now, or for the browser signed out. An alt is added by hand or
// from the player's own Everloot.lua (ReadSaveFile), edited, deleted once a backup is offered, backed up and restored.
// The page asks the network who is signed in and nothing else; what is typed here and what the file holds stay here.

const action = "inline-flex min-h-8 items-center px-1.5 text-cell text-fg-2 hover:text-accent disabled:opacity-60";
const control = "min-h-11 w-full rounded-control border border-edge bg-canvas px-3 text-base text-fg";
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const day = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The calculator's address for a plan: both sets, each with its order, in the fragment that never reaches the server. */
const openPath = (plan: LocalPlan) => `/tools/talents/${plan.classSlug}${planHash(plan.code, plan.code2, plan.order, plan.order2)}`;

/** Hands the browser one file, as Plans on this device does; the file's link is let go once the download starts. */
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

/** "Added by hand.", or from the file, and which details still hold the file's values, as of its newest record. */
function sourceLine({ provenance: { source, fileRecordAt, fileDetails } }: LocalAlt): string {
  const how = source === "manual" ? "Added by hand." : "Added from your Everloot.lua.";
  if (fileRecordAt === null) return how;
  const what = fileDetails.length > 0 ? `${titleCase(listOf(fileDetails.map((d) => DETAIL_WORDS[d])))} from` : "Matched to";
  return `${how} ${what} its Everloot.lua records up to ${day(fileRecordAt)}.`;
}

export default function AltPlanner() {
  const [state, retry] = useWorkspaceOwner();
  if (state.status === "checking") return <p role="status" className="text-sm text-muted">Checking who is signed in…</p>;
  if (state.status === "unavailable") {
    return (
      <Card>
        <p role="alert" className="text-fg">Your account could not be checked, so no alts are shown. This page shows the signed-in account&apos;s alts, or the signed-out ones, never a guess.</p>
        <button type="button" className="btn mt-4 text-sm" onClick={retry}>Try again</button>
      </Card>
    );
  }
  // One bucket at a time. Another owner remounts everything below, so nothing begun for one bucket ends in another.
  return <Bucket key={bucketKey(state.owner)} owner={state.owner} />;
}

function Bucket({ owner }: { owner: Owner }) {
  const [read, setRead] = useState<ReadResult | null>(null);
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const reload = useCallback(() => setRead(readWorkspace(deviceStorage(), owner)), [owner]);
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
        ? "Alts kept while signed out. Signed in, this page shows that account's alts instead, and these wait here for when you sign out."
        : "Alts kept on this device while signed in to this account. Signed out or under another account this page does not show them, but they are not encrypted: anyone using this browser can read its storage."}
    </p>
  );
  if (!read.ok) return <div className="space-y-6">{intro}<StoredProblem read={read} /></div>;

  /** Shows what a change did; the list is read back from storage, so it never shows a change that did not happen. */
  const after = (result: { ok: true } | Failure, done: string) => {
    reload();
    setMessage(result.ok ? { text: done, alert: false } : { text: result.message, alert: true });
  };
  /** A backup of this bucket as stored now, so a change another tab made is in it too. Null when it downloaded. */
  const download = (): string | null => {
    const now = readWorkspace(deviceStorage(), owner);
    const backup = now.ok ? exportBackup(now.workspace, new Date(), hiddenFrom(deviceStorage(), owner, now.workspace)) : now;
    if (!backup.ok) return altFailure(backup.error).message;
    saveFile(backup.text, backup.fileName);
    return null;
  };
  const storage = deviceStorage();
  const { alts } = read.workspace;
  // A signed-out plan an account has now is that account's: not offered or shown here (hiddenFrom). Its alt keeps it.
  const hidden = hiddenFrom(storage, owner, read.workspace);
  const plans = read.workspace.plans.filter((p) => !hidden.has(p.id));
  const copies = copyNumbers(alts);
  // Said before anything is tried: in the newer format the same alts take more room than this device has left.
  const overflow = newFormatOverflow(read.workspace);

  return (
    <div className="space-y-8">
      {intro}
      {overflow !== null && (
        <p role="note" className="rounded-control border border-line bg-canvas p-3 text-sm text-fg">
          Your plans and alts here are saved in an older format. Alt details (realm, class, faction, level and professions, and
          those read from your Everloot.lua) need the newer one, which takes more room for the same alts: {overflow.toLocaleString("en-US")} bytes
          here, more than the 1 MiB this device keeps. A name, notes and plans still save as they are. Download a backup first
          (it keeps the older format), then delete a plan or an alt, or shorten some notes, to make room for details.
        </p>
      )}
      <Card as="section" aria-labelledby="alts-add">
        <SectionHeading id="alts-add" note="A name is all an alt needs. Leave out what you do not know: nothing is filled in for you.">Add an alt</SectionHeading>
        <AltForm label="Add an alt" alt={null} plans={plans} submit="Add alt" onSave={(input) => {
          const result = saveAlt(storage, owner, input);
          if (!result.ok) return { message: result.message };
          after(result, `Added "${result.alt.name}" to this device.`);
          return null;
        }} />
      </Card>
      <ReadSaveFile owner={owner} onApplied={(done) => after({ ok: true }, done)} />
      <section aria-labelledby="alts-list">
        <SectionHeading id="alts-list" note={`${alts.length} of ${WORKSPACE_LIMITS.alts}. Kept in this browser only.`}>Your alts</SectionHeading>
        <p role="status" className="mb-3 text-sm text-fg-2 empty:hidden">{message && !message.alert ? message.text : ""}</p>
        {message?.alert && <p role="alert" className="mb-3 text-sm text-danger">{message.text}</p>}
        {alts.length === 0 ? (
          <Card><p className="text-fg-2">No alts on this device yet. Add one above, or read your Everloot.lua.</p></Card>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {alts.map((alt) => (
              <AltItem
                key={alt.id}
                alt={alt}
                copy={copies.get(alt.id) ?? null}
                plans={plans}
                onSave={(input) => {
                  const result = saveAlt(storage, owner, input);
                  if (result.ok) { after(result, `Saved "${result.alt.name}".`); return null; }
                  // An alt deleted in another tab leaves the list, and its form with it: say so above the list.
                  if (result.error === "missing") { after(result, ""); return null; }
                  // Changed in another tab: the list shows it as it is now, and the form says what changed.
                  if (result.current) reload();
                  return { message: result.message, current: result.current, changed: result.changed };
                }}
                onBackup={() => { const problem = download(); setMessage(problem ? { text: problem, alert: true } : null); }}
                onDelete={() => after(deleteAlt(storage, owner, alt.id), `Deleted "${alt.name}" from this device.`)}
              />
            ))}
          </ul>
        )}
      </section>
      <Backup owner={owner} download={download} onRestored={after} />
    </div>
  );
}

interface FormState { name: string; realm: string; classSlug: string; faction: string; level: string; professions: string[]; notes: string; planIds: string[] }
const BLANK: FormState = { name: "", realm: "", classSlug: "", faction: "", level: "", professions: [], notes: "", planIds: [] };
const formOf = (alt: LocalAlt): FormState => ({
  name: alt.name, realm: alt.realm ?? "", classSlug: alt.classSlug ?? "", faction: alt.faction ?? "",
  level: alt.level === null ? "" : String(alt.level), professions: alt.professions, notes: alt.notes, planIds: alt.planIds,
});
const toggled = (list: string[], value: string, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Why a save did not happen; for an alt changed in another tab, the alt as it is now and what changed. */
type SaveProblem = { message: string; current?: LocalAlt; changed?: AltField[] } | null;

/** A form field's value as the conflict lines show it. */
function shownValue(field: keyof FormState, value: string | string[], plans: LocalPlan[]): string {
  if (Array.isArray(value)) {
    const names = field === "planIds" ? value.map((id) => plans.find((p) => p.id === id)?.name ?? "a plan no longer here") : value;
    return names.length > 0 ? listOf(names) : "none";
  }
  if (value === "") return field === "notes" ? "empty" : "not set";
  return field === "classSlug" || field === "faction" ? titleCase(value) : field === "level" ? value : `“${value}”`;
}

/**
 * After a change elsewhere, the form with that change taken in wherever the player left the field as it was, and the
 * player's value kept wherever they changed it too; and a line for each changed field saying which.
 */
function reconcile(form: FormState, was: FormState, now: FormState, changed: AltField[], plans: LocalPlan[]): { form: FormState; lines: string[] } {
  const next = { ...form };
  const lines: string[] = [];
  for (const field of changed) {
    const word = titleCase(FIELD_WORDS[field]);
    if (field === "provenance") { lines.push(`${word}: updated, as the details it covers came in elsewhere.`); continue; }
    if (same(form[field], was[field])) {
      Object.assign(next, { [field]: now[field] });
      lines.push(`${word}: now ${shownValue(field, now[field], plans)}.`);
    } else {
      lines.push(`${word}: you set ${shownValue(field, form[field], plans)} here; it is now ${shownValue(field, now[field], plans)}. Yours is kept in the form.`);
    }
  }
  return { form: next, lines };
}

/** An alt's details as a form. The checks are the workspace's, said in the form, so a browser's own checks are off. */
function AltForm({ label, alt, plans, submit, onSave, onCancel }: {
  label: string;
  alt: LocalAlt | null;
  plans: LocalPlan[];
  submit: string;
  onSave: (input: AltInput) => SaveProblem;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(alt ? formOf(alt) : BLANK);
  // The alt as this edit began, or as it was found when a save met a change from elsewhere: the next save is checked
  // against it, so what another tab saved since is never written over unseen.
  const [base, setBase] = useState<LocalAlt | null>(alt);
  const [error, setError] = useState<string[] | null>(null);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const level = form.level.trim();
    const problem = onSave({
      id: alt?.id ?? null, name: form.name, realm: form.realm, classSlug: form.classSlug || null, faction: form.faction || null,
      level: level === "" ? null : Number(level), professions: form.professions, notes: form.notes, planIds: form.planIds, base,
    });
    if (problem?.current && problem.changed && base) {
      const merged = reconcile(form, formOf(base), formOf(problem.current), problem.changed, plans);
      setForm(merged.form);
      setBase(problem.current);
      setError([`${base.name} was changed somewhere else while you were editing it, so nothing was saved yet.`, ...merged.lines, "Check the form, then save again."]);
      return;
    }
    setError(problem ? [problem.message] : null);
    if (!problem && !alt) setForm(BLANK);
  }

  return (
    <form aria-label={label} noValidate onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" required maxLength={WORKSPACE_LIMITS.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Field label="Realm (optional)" maxLength={WORKSPACE_LIMITS.realm} value={form.realm} onChange={(e) => setForm({ ...form, realm: e.target.value })} />
      <label className="block space-y-1 text-sm">
        <span className="block text-muted">Class</span>
        <select value={form.classSlug} onChange={(e) => setForm({ ...form, classSlug: e.target.value })} className={control}>
          <option value="">Not known</option>
          {TALENT_CLASSES.map((slug) => <option key={slug} value={slug}>{titleCase(slug)}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="block text-muted">Faction</span>
        <select value={form.faction} onChange={(e) => setForm({ ...form, faction: e.target.value })} className={control}>
          <option value="">Not known</option>
          <option value="alliance">Alliance</option>
          <option value="horde">Horde</option>
        </select>
      </label>
      <Field label="Level (optional)" type="number" inputMode="numeric" min={1} max={WORKSPACE_LIMITS.level} step={1}
        value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} />
      <fieldset className="sm:col-span-2">
        <legend className="text-sm text-muted">Professions</legend>
        <div className="mt-1 flex flex-wrap gap-x-4">
          {ALT_PROFESSIONS.map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-2 text-sm text-fg-2">
              <input type="checkbox" checked={form.professions.includes(p)} onChange={(e) => setForm({ ...form, professions: toggled(form.professions, p, e.target.checked) })} />
              {p}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm text-muted">Plans it uses, up to {WORKSPACE_LIMITS.altPlans}</legend>
        {plans.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No plans on this device yet. <a href="/tools/builds" className={link}>Plans on this device</a> keeps them by name.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-x-4">
            {plans.map((plan) => (
              <label key={plan.id} className="flex min-h-11 items-center gap-2 text-sm text-fg-2 [overflow-wrap:anywhere]">
                <input type="checkbox" checked={form.planIds.includes(plan.id)} onChange={(e) => setForm({ ...form, planIds: toggled(form.planIds, plan.id, e.target.checked) })} />
                {plan.name} · {titleCase(plan.classSlug)}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <label className="block space-y-1 text-sm sm:col-span-2">
        <span className="block text-muted">Notes (optional)</span>
        <textarea maxLength={WORKSPACE_LIMITS.notes} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="w-full rounded-control border border-edge bg-canvas px-3 py-2 text-base text-fg" />
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" className="btn btn-primary text-sm">{submit}</button>
        {onCancel && <button type="button" className="btn text-sm" onClick={onCancel}>Cancel</button>}
      </div>
      {error && <div role="alert" className="space-y-1 text-sm text-danger sm:col-span-2">{error.map((line) => <p key={line}>{line}</p>)}</div>}
    </form>
  );
}

function AltItem({ alt, copy, plans, onSave, onBackup, onDelete }: {
  alt: LocalAlt;
  /** Its number among alts that read alike (copyNumbers), null when it reads like no other. */
  copy: number | null;
  plans: LocalPlan[];
  onSave: (input: AltInput) => SaveProblem;
  onBackup: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const used = alt.planIds.flatMap((id) => plans.filter((p) => p.id === id));
  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="min-w-0 font-semibold text-fg [overflow-wrap:anywhere]">{alt.name}</h3>
        <span className="text-meta text-muted [overflow-wrap:anywhere]">{[copy === null ? "" : `Copy ${copy}`, alt.realm ?? "Realm not set", detailsLine(alt)].filter(Boolean).join(" · ")}</span>
      </div>
      {alt.professions.length > 0 && <p className="text-sm text-fg-2">Professions: {alt.professions.join(", ")}</p>}
      {alt.notes && <p className="whitespace-pre-line text-sm text-fg-2 [overflow-wrap:anywhere]">{alt.notes}</p>}
      {used.length > 0 && (
        <p className="text-sm text-fg-2 [overflow-wrap:anywhere]">
          Plans: {used.map((plan, i) => <span key={plan.id}>{i > 0 && ", "}<a href={openPath(plan)} className={link}>{plan.name}</a></span>)}
        </p>
      )}
      <p className="text-meta text-muted">{sourceLine(alt)}</p>
      <div className="flex flex-wrap items-center gap-x-1">
        <button type="button" className={action} aria-expanded={editing} onClick={() => setEditing(!editing)}>Edit</button>
        <button type="button" className={action} aria-expanded={confirming} onClick={() => setConfirming(true)}>Delete</button>
      </div>
      {confirming && (
        <div role="group" aria-label={`Delete ${alt.name}`} className="space-y-3 rounded-control border border-line bg-canvas p-3">
          <p className="text-sm text-fg">Delete {alt.name} from this device for good? Its plans stay. Download a backup first to keep a copy you can restore.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn text-sm" onClick={onBackup}>Download a backup first</button>
            <button type="button" className="btn text-sm" onClick={onDelete}>Delete for good</button>
            <button type="button" className="btn text-sm" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {editing && (
        <AltForm label={`Edit ${alt.name}`} alt={alt} plans={plans} submit="Save" onCancel={() => setEditing(false)}
          onSave={(input) => { const error = onSave(input); if (!error) setEditing(false); return error; }} />
      )}
    </li>
  );
}

/** Download a backup of this bucket, or restore one after seeing what it would do to each alt. */
function Backup({ owner, download, onRestored }: {
  owner: Owner;
  download: () => string | null;
  onRestored: (result: { ok: true } | Failure, done: string) => void;
}) {
  const [preview, setPreview] = useState<{ preview: ImportPreview; lines: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // Gone with its bucket: a file still being read when the account changes is not previewed for the next one.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

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
    if (!now.ok) { setError(altFailure(now.error).message); return; }
    const result = previewImport(text, now.workspace, sentPlans(deviceStorage()));
    if (!result.ok) { setError(result.message); return; }
    setPreview({ preview: result.preview, lines: restoreLines(now.workspace, result.preview) });
  }

  function restore() {
    if (!preview) return;
    const result = applyImport(deviceStorage(), owner, preview.preview);
    setPreview(null);
    onRestored(result.ok ? result : altFailure(result.error), "Restored the backup.");
  }

  const p = preview?.preview;
  const changes = p ? p.added + p.updated + p.others : 0;
  const plansLine = p && p.added + p.updated > 0
    ? `It also ${listOf([p.added > 0 ? `adds ${plural(p.added, "plan")}` : "", p.updated > 0 ? `updates ${plural(p.updated, "plan")} with the backup's newer copy` : ""].filter(Boolean))}.`
    : null;
  return (
    <Card as="section" aria-labelledby="alts-backup">
      <SectionHeading id="alts-backup" note="A backup holds the alts and plans this page shows. It restores only here, never into another account's or the signed-out ones.">Back up and restore</SectionHeading>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn text-sm" onClick={() => setError(download())}>Download backup</button>
        {/* The input inside is hidden, so the label shows the site's focus ring while it has focus. */}
        <label className="btn cursor-pointer text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">Restore from a backup
          <input aria-label="Choose a backup file" type="file" accept=".json,application/json" className="sr-only" disabled={reading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); e.target.value = ""; }} />
        </label>
      </div>
      {reading && <p className="mt-3 text-sm text-muted" role="status">Reading the backup…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {preview && p && (
        <div role="group" aria-label="What the restore would do" className="mt-4 space-y-2 rounded-control border border-line bg-canvas p-3">
          {changes === 0 && <p className="text-sm text-fg">Nothing to restore: this device already has everything in that backup.</p>}
          {preview.lines.map((line) => <p key={line} className="text-sm text-fg">{line}</p>)}
          {plansLine && <p className="text-sm text-fg-2">{plansLine}</p>}
          {changes > 0 && preview.lines.length === 0 && !plansLine && <p className="text-sm text-fg-2">Restoring brings back the backup&apos;s newer copies.</p>}
          {p.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          <div className="flex flex-wrap gap-2 pt-1">
            {changes > 0 && <button type="button" className="btn btn-primary text-sm" onClick={restore}>Restore</button>}
            <button type="button" className="btn text-sm" onClick={() => setPreview(null)}>{changes > 0 ? "Cancel" : "Close"}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Stored data that does not read: kept as it is, with its text to download. Plans on this device can clear it. */
function StoredProblem({ read }: { read: Extract<ReadResult, { ok: false }> }) {
  const raw = read.raw;
  return (
    <Card>
      <p role="alert" className="text-fg">{altFailure(read.error).message}</p>
      {raw !== null && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn text-sm" onClick={() => saveFile(raw, `everloot-plans-stored-${new Date().toISOString().slice(0, 10)}.txt`)}>Download what is stored</button>
        </div>
      )}
      {read.error === "corrupt" && (
        <p className="mt-3 text-sm text-muted">To start over, download it first, then clear it on <a href="/tools/builds" className={link}>Plans on this device</a>.</p>
      )}
    </Card>
  );
}
