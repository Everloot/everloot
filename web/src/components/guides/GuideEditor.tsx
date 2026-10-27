"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui";
import type { GuideAuthor, GuideDraft, GuideEditorOptions, GuideLimits, GuideSource } from "@/lib/guide-submissions";
import { ACCOUNT_MISMATCH, EXPECTED_OWNER_HEADER } from "@/lib/saved-builds";

// The writer's side of a community guide: the guide's fields and text as a private draft, saved to the account the page
// was made for (EXPECTED_OWNER_HEADER), so a draft is never filed under an account signed in later in another tab.
// Submitting shows the name the guide will carry before anything is sent, and sends the words exactly as they are then.
// Every field is a plain form control: nothing typed here is ever drawn as HTML. The preview below the editor is the
// page's, drawn on the server by the guides' own renderer from the saved draft, so saving refreshes it.

const API = "/api/me/guides";
const PAGE = "/guides/write";
const TRY_AGAIN = "That did not work. Try again.";
const OTHER_ACCOUNT = "You are signed in to another account now. Nothing was saved. Reload the page to go on.";
const label = "block space-y-1 text-sm";
const caption = "block text-muted";
const select = "min-h-11 w-full rounded-control border border-edge bg-canvas px-2 text-fg focus:border-accent";
const box = "h-4 w-4 accent-accent";
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const quiet = "btn min-h-11 px-4 text-sm";

export interface GuideEditorProps {
  /** The signed-in account the page shows: every write names it. */
  ownerId: string;
  /** The guide being written, or null for a new one. */
  guideId: string | null;
  /** What the editor opens with: the draft, or the words of the last revision sent, to start the next one from. */
  draft: GuideDraft;
  /** The revision a save writes and a submission sends. */
  revision: number;
  /** The revision waiting for review, if one is. */
  waiting: number | null;
  author: GuideAuthor;
  options: GuideEditorOptions;
  limits: GuideLimits;
}

interface Fields {
  title: string; summary: string; classSlug: string; activity: string; roles: string[]; from: string; to: string;
  code: string; order: string; code2: string; order2: string; body: string;
}
interface SourceRow extends GuideSource { key: number }
interface Failure { message: string; problems?: string[]; signIn?: string; settings?: string }

const fieldsOf = (d: GuideDraft): Fields => ({
  title: d.title, summary: d.summary, classSlug: d.classSlug ?? "", activity: d.activity ?? "", roles: d.roles,
  from: d.levels ? String(d.levels.from) : "", to: d.levels ? String(d.levels.to) : "",
  code: d.code ?? "", order: d.order ?? "", code2: d.code2 ?? "", order2: d.order2 ?? "", body: d.body,
});

export default function GuideEditor({ ownerId, guideId, draft, revision, waiting, author, options, limits }: GuideEditorProps) {
  const router = useRouter();
  const [fields, setFields] = useState(() => fieldsOf(draft));
  const [sources, setSources] = useState<SourceRow[]>(() => draft.sources.map((s, key) => ({ ...s, key })));
  const [nextKey, setNextKey] = useState(draft.sources.length);
  const [waitingNow, setWaitingNow] = useState(waiting);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const set = (change: Partial<Fields>) => setFields((f) => ({ ...f, ...change }));
  const setSource = (key: number, change: Partial<GuideSource>) => setSources((rows) => rows.map((s) => (s.key === key ? { ...s, ...change } : s)));
  const toggleRole = (role: string) => set({ roles: fields.roles.includes(role) ? fields.roles.filter((r) => r !== role) : [...fields.roles, role] });

  /** The draft as the form holds it now. An empty box is no value; both level boxes empty are no levels. */
  const current = (): GuideDraft => ({
    title: fields.title, summary: fields.summary,
    classSlug: (fields.classSlug || null) as GuideDraft["classSlug"], activity: (fields.activity || null) as GuideDraft["activity"],
    roles: options.roles.map((r) => r.value).filter((r) => fields.roles.includes(r)) as GuideDraft["roles"],
    levels: fields.from === "" && fields.to === "" ? null : { from: Number(fields.from), to: Number(fields.to) },
    code: fields.code.trim() || null, order: fields.order.trim() || null, code2: fields.code2.trim() || null, order2: fields.order2.trim() || null,
    sources: sources.map(({ title, url, checkedOn }) => ({ title, url, checkedOn })), body: fields.body,
  });

  /** One write, as this page's account. The answer's body when it worked, else null with the reason shown. */
  async function send(body: object): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setFailure(null);
    setNote(null);
    try {
      const response = await fetch(API, {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json", [EXPECTED_OWNER_HEADER]: ownerId }, body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) return result;
      if (response.status === 409 && result.code === ACCOUNT_MISMATCH) setFailure({ message: OTHER_ACCOUNT });
      else {
        setFailure({
          message: typeof result.error === "string" ? result.error : TRY_AGAIN,
          ...(Array.isArray(result.problems) ? { problems: result.problems.map(String) } : {}),
          ...(typeof result.signIn === "string" ? { signIn: result.signIn } : {}),
          ...(typeof result.settings === "string" ? { settings: result.settings } : {}),
        });
      }
      return null;
    } catch {
      setFailure({ message: TRY_AGAIN });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await send({ action: "save", guideId, draft: current() });
    if (!result) return;
    setNote("Saved.");
    if (guideId === null && typeof result.guideId === "string") router.push(`${PAGE}?guide=${result.guideId}`);
    else router.refresh();
  }

  async function submit() {
    if (guideId === null || !author.handle) return;
    const result = await send({ action: "submit", guideId, draft: current(), alias: author.handle });
    if (!result) return;
    setConfirming(false);
    setWaitingNow(typeof result.revision === "number" ? result.revision : revision);
    router.refresh();
  }

  async function withdraw() {
    if (guideId === null || waitingNow === null) return;
    const result = await send({ action: "withdraw", guideId, revision: waitingNow });
    if (!result) return;
    setNote(`Revision ${waitingNow} was taken back from review.`);
    setWaitingNow(null);
    router.refresh();
  }

  return (
    <form onSubmit={save} aria-label="Guide draft" className="max-w-3xl space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}>
          <span className={caption}>Title</span>
          <Input aria-label="Title" maxLength={limits.title} value={fields.title} onChange={(e) => set({ title: e.target.value })} autoComplete="off" />
        </label>
        <label className={`${label} sm:col-span-2`}>
          <span className={caption}>Summary: the line under the title</span>
          <Input aria-label="Summary" maxLength={limits.summary} value={fields.summary} onChange={(e) => set({ summary: e.target.value })} autoComplete="off" />
        </label>
        <label className={label}>
          <span className={caption}>Class</span>
          <select aria-label="Class" className={select} value={fields.classSlug} onChange={(e) => set({ classSlug: e.target.value })}>
            <option value="">Pick a class</option>
            {options.classes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className={label}>
          <span className={caption}>Activity</span>
          <select aria-label="Activity" className={select} value={fields.activity} onChange={(e) => set({ activity: e.target.value })}>
            <option value="">Pick an activity</option>
            {options.activities.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <fieldset className="space-y-2 text-sm">
          <legend className="text-muted">Roles</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {options.roles.map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-fg">
                <input type="checkbox" aria-label={r.label} className={box} checked={fields.roles.includes(r.value)} onChange={() => toggleRole(r.value)} />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-3 text-sm">
          <legend className="col-span-2 text-muted">Levels it covers</legend>
          <Input type="number" aria-label="From level" min={1} max={limits.level} value={fields.from} onChange={(e) => set({ from: e.target.value })} />
          <Input type="number" aria-label="To level" min={1} max={limits.level} value={fields.to} onChange={(e) => set({ to: e.target.value })} />
        </fieldset>
        <label className={label}>
          <span className={caption}>Share code, from the talent calculator</span>
          <Input mono aria-label="Share code" maxLength={limits.code} value={fields.code} onChange={(e) => set({ code: e.target.value })} spellCheck={false} />
        </label>
        <label className={label}>
          <span className={caption}>Spend order (optional, one you planned)</span>
          <Input mono aria-label="Spend order" value={fields.order} onChange={(e) => set({ order: e.target.value })} spellCheck={false} />
        </label>
        <label className={label}>
          <span className={caption}>Second set&apos;s share code (optional)</span>
          <Input mono aria-label="Second set's share code" maxLength={limits.code} value={fields.code2} onChange={(e) => set({ code2: e.target.value })} spellCheck={false} />
        </label>
        <label className={label}>
          <span className={caption}>Second set&apos;s spend order (optional)</span>
          <Input mono aria-label="Second set's spend order" value={fields.order2} onChange={(e) => set({ order2: e.target.value })} spellCheck={false} />
        </label>
      </div>

      <fieldset className="space-y-2 text-sm">
        <legend className="text-muted">Sources</legend>
        <p className="text-xs text-muted">Blizzard&apos;s own posts only, each linked in the text where the claim it supports is made.</p>
        {sources.map((s, i) => (
          <div key={s.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]">
            <Input aria-label={`Source ${i + 1} title`} maxLength={limits.sourceTitle} value={s.title} onChange={(e) => setSource(s.key, { title: e.target.value })} />
            <Input mono type="url" aria-label={`Source ${i + 1} address`} maxLength={limits.sourceUrl} value={s.url} onChange={(e) => setSource(s.key, { url: e.target.value })} />
            <Input type="date" aria-label={`Source ${i + 1} checked on`} value={s.checkedOn} onChange={(e) => setSource(s.key, { checkedOn: e.target.value })} />
            <button type="button" className={quiet} onClick={() => setSources((rows) => rows.filter((r) => r.key !== s.key))}>Remove source {i + 1}</button>
          </div>
        ))}
        {sources.length < limits.sources && (
          <button type="button" className={quiet} onClick={() => { setSources((rows) => [...rows, { title: "", url: "", checkedOn: "", key: nextKey }]); setNextKey((k) => k + 1); }}>
            Add a source
          </button>
        )}
      </fieldset>

      <label className={label}>
        <span className={caption}>Text</span>
        <textarea aria-label="Text" maxLength={limits.body} rows={20} value={fields.body} onChange={(e) => set({ body: e.target.value })}
          className="w-full rounded-control border border-edge bg-canvas px-3 py-2 font-mono text-sm text-fg focus:border-accent" spellCheck />
        <span className="block text-xs text-muted">
          Four ## sections, in order: {options.sections.join(", ")}. Plain text with **bold**, *emphasis*, [words](/path) links, {"{item:N}"} tokens
          and [[wiki]] links. No HTML.
        </span>
      </label>

      {waitingNow !== null && (
        <p className="text-sm text-fg-2">
          Revision {waitingNow} is waiting for review.{" "}
          <button type="button" className={quiet} disabled={busy} onClick={() => void withdraw()}>Withdraw revision {waitingNow} from review</button>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary min-h-11 px-4 text-sm" disabled={busy} aria-busy={busy}>Save draft</button>
        {guideId !== null
          ? <button type="button" className={quiet} disabled={busy} onClick={() => setConfirming(true)}>Submit for review…</button>
          : <p className="text-sm text-fg-2">Save the draft before you submit it.</p>}
        <p className="text-sm text-muted">Your drafts are private: only you can read them. Saving shows the preview below.</p>
        {note && <p role="status" className="text-sm text-fg-2">{note}</p>}
      </div>

      {confirming && (
        <section aria-label="Submit for review" className="space-y-2 rounded-card border border-line bg-canvas p-4 text-sm text-fg-2">
          {author.handle ? (
            <>
              <p className="text-fg">This guide will name you as @{author.handle}, never by your BattleTag.</p>
              <p>{author.publicProfile
                ? `While your profile is public, the name links to /u/${author.handle}.`
                : "Your profile stays private: the name is shown without a link to it."}</p>
              <p>It sends revision {revision} exactly as it is now. Nothing is published yet: community guides wait for review.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary min-h-11 px-4 text-sm" disabled={busy} onClick={() => void submit()}>Submit revision {revision}</button>
                <button type="button" className={quiet} onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-fg">Choose a handle on <Link href="/settings" className={link}>Settings</Link> first: a guide names its author by handle, never by BattleTag.</p>
              <button type="button" className={quiet} onClick={() => setConfirming(false)}>Cancel</button>
            </>
          )}
        </section>
      )}

      {failure && (
        <div role="alert" className="text-sm text-fg">
          {failure.message}
          {failure.signIn && <> <a href={failure.signIn} className={link}>Sign in</a></>}
          {failure.settings && <> <Link href={failure.settings} className={link}>Settings</Link></>}
          {failure.problems && <ul className="mt-2 list-disc space-y-1 pl-5">{failure.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
        </div>
      )}
    </form>
  );
}
