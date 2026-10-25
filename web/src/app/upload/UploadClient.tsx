"use client";
import { useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics/track";
import { parseEverlootLua, parsePolestarTable } from "@/lib/sv-parse";
import { convertRecorder, type RecorderPayload } from "@/lib/polestar-recorder";
import { censusSummary, prepareUpload, sendBatches, type SharingChoices, type UploadSession } from "@/lib/upload-batches";
import type { SharingCategory } from "../../../../kb/src/publication";
import { parseSettledList, settledSkip, type SettledList } from "../../../../kb/src/settled-list";
import Card from "@/components/ui/Card";
import SectionHeading from "@/components/ui/SectionHeading";

const categories: { key: SharingCategory; label: string }[] = [
  { key: "guild", label: "Guild roster, attendance, progression and loot" },
  { key: "gear", label: "My character's gear" },
  { key: "gold", label: "My character's gold and money events" },
  { key: "collection", label: "My collection ownership and completion progress" },
];
const button = "btn btn-primary disabled:opacity-50";
const outlineButton = "btn";
const input = "w-full rounded-control border border-edge bg-canvas p-3 text-base text-fg";

/** The settled list for the file's build, or null (nothing skipped) without a build or when the site does not answer. */
async function loadSettled(build: unknown): Promise<SettledList | null> {
  if (typeof build !== "string") return null;
  try {
    const response = await fetch(`/api/coverage/settled?build=${encodeURIComponent(build)}`, { signal: AbortSignal.timeout(5000) });
    return response.ok ? parseSettledList(await response.json()) : null;
  } catch { return null; }
}

/** `playerPages`: the site collects player rows. Off, the server drops them, and the preview says so. */
export default function UploadClient({ playerPages = false }: { playerPages?: boolean } = {}) {
  const [payload, setPayload] = useState<unknown>(null);
  const [settled, setSettled] = useState<SettledList | null>(null);
  const [choices, setChoices] = useState<SharingChoices>({});
  const [tokens, setTokens] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<UploadSession | null>(null);
  const [, refresh] = useState(0);
  const saved = useRef<UploadSession | null>(null);
  const loadId = useRef(0);
  const [withdrawToken, setWithdrawToken] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawStatus, setWithdrawStatus] = useState("");
  const prepared = useMemo(() => {
    if (!payload) return { value: null, error: null };
    const skip = settledSkip(settled, (payload as { clientBuild?: unknown }).clientBuild);
    try { return { value: prepareUpload(payload, choices, tokens.split(/\s+/).filter(Boolean), undefined, skip), error: null }; }
    catch (e) { return { value: null, error: e instanceof Error ? e.message : "Could not prepare this file." }; }
  }, [payload, choices, tokens, settled]);
  const busy = sending || loading;
  function resetSession() { saved.current = null; setSession(null); setError(null); }
  async function loadFile(file: File) {
    if (busy) return;
    const id = ++loadId.current;
    resetSession(); setPayload(null); setSettled(null); setChoices({}); setTokens(""); setLoading(true);
    try {
      if (file.size > 20_000_000) throw new Error("This file exceeds 20 MB. Keep the original and split it before uploading.");
      const text = await file.text();
      let value: unknown;
      // A Polestar Recorder file is converted here, in the browser; its names never leave this page.
      if (/PolestarRecorderDB\s*=/.test(text.slice(0, 500))) value = await convertRecorder(parsePolestarTable(text));
      else if (/\.lua$/i.test(file.name) || /EverlootDB\s*=/.test(text.slice(0, 500))) {
        const parsed = parseEverlootLua(text);
        value = { addonVersion: parsed.version, clientBuild: parsed.clientBuild, records: parsed.records };
      } else value = JSON.parse(text);
      prepareUpload(value, {}, []);
      const list = await loadSettled((value as { clientBuild?: unknown } | null)?.clientBuild);
      if (loadId.current === id) { setSettled(list); setPayload(value); }
    } catch (e) { if (loadId.current === id) setError(e instanceof Error ? e.message : "Could not read this file."); }
    finally { if (loadId.current === id) setLoading(false); }
  }
  function sample() {
    if (busy) return;
    resetSession(); setSettled(null); setChoices({}); setTokens("");
    const base = { installId: `sample-${crypto.randomUUID()}`, capturedAt: new Date().toISOString() };
    setPayload({ addonVersion: "0.2.0", records: [
      { ...base, eventId: "sample:1", kind: "npc_sighting", npcId: 1234, name: "Forest Spider", mapId: 141, x: 42.5, y: 61, level: 60, reaction: "hostile" },
      { ...base, eventId: "sample:2", kind: "loot", sourceNpcId: 1234, items: [{ itemId: 456, count: 2 }] },
    ] });
  }
  async function send() {
    if (!prepared.value || busy) return;
    const active = saved.current ?? prepared.value;
    saved.current = active; setSession(active); setSending(true); setError(null);
    try {
      await sendBatches(active, fetch, () => refresh((n) => n + 1));
      if (active.next === active.batches.length) track("upload_done", { batches: active.batches.length });
    }
    catch (e) { setError(e instanceof Error ? e.message : "Network error. Keep your file and retry."); }
    finally { setSending(false); refresh((n) => n + 1); }
  }
  async function withdraw(action: "revoke" | "opt-out") {
    setWithdrawing(true); setWithdrawStatus("");
    try {
      const response = await fetch(`/api/sharing/revoke?action=${action}`, { method: "POST", headers: { Authorization: `Bearer ${withdrawToken.trim()}` } });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Withdrawal was not confirmed.");
      setWithdrawStatus(action === "revoke" ? "Grant revoked. It no longer authorizes public records." : "Character opted out. Named records are withheld across guild and character views.");
      setWithdrawToken(""); resetSession();
    } catch (e) { setWithdrawStatus(e instanceof Error ? e.message : "Network error. Retry withdrawal."); }
    finally { setWithdrawing(false); }
  }
  const accepted = session?.receipts.reduce((n, receipt) => n + (receipt.accepted?.length ?? 0), 0) ?? 0;
  const rejected = session?.receipts.reduce((n, receipt) => n + (receipt.rejected?.length ?? 0), 0) ?? 0;
  const complete = !!session && session.next === session.batches.length;
  const recorder = (payload as Partial<RecorderPayload> | null)?.recorder;
  const skipped = recorder ? Object.entries(recorder.skipped).sort(([a], [b]) => a.localeCompare(b)) : [];
  const capped = recorder ? Object.entries(recorder.capped).sort(([a], [b]) => a.localeCompare(b)) : [];
  return (
    <div className="space-y-6">
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy && e.dataTransfer.files[0]) void loadFile(e.dataTransfer.files[0]); }}>
        <Card className="text-center">
        <p className="text-fg-2">Drop your Everloot.lua, Polestar_Recorder.lua or payload JSON here.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <label className={button}>Choose file
            <input aria-label="Choose Everloot file" type="file" accept="application/json,.json,.lua" className="sr-only" disabled={busy}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void loadFile(file); e.target.value = ""; }} />
          </label>
          <button className={outlineButton} disabled={busy} onClick={sample}>Load sample</button>
        </div>
        <p className="mt-4 text-sm text-muted">{loading ? "Reading your file…" : "Your original file stays on your computer. Reloading and reselecting it safely retries the same events."}</p>
        </Card>
      </div>
      <Card>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="mb-2 text-xl font-semibold tracking-tight text-fg">Named sharing choices</legend>
        <p className="text-sm text-fg-2">Anonymous sightings are included. Named categories start unchecked. Guild sharing requires verified officer authority; character sharing requires verified ownership.</p>
        {categories.map(({ key, label }) => <label key={key} className="flex gap-3 items-center text-sm text-fg">
          <input type="checkbox" checked={choices[key] === true} onChange={(e) => { resetSession(); setChoices({ ...choices, [key]: e.target.checked }); }} />{label}
        </label>)}
        <label className="block text-sm text-fg-2">Verification grants (separate multiple grants with spaces)
          <input type="password" autoComplete="off" className={input + " mt-2"} value={tokens}
            onChange={(e) => { resetSession(); setTokens(e.target.value); }} />
        </label>
        <p className="text-xs text-muted">Everloot issues scoped grants after reviewing officer or owner evidence. An addon claim token is not verification. No account credentials belong here.</p>
      </fieldset>
      </Card>
      {(error || prepared.error) && <p role="alert" className="text-sm text-danger">{error ?? prepared.error}</p>}
      {prepared.value && <Card>
        <SectionHeading>Preview — selected records to send</SectionHeading>
        <ul className="grid sm:grid-cols-2 gap-2 text-sm">
          {Object.entries(prepared.value.counts).map(([kind, count]) => <li key={kind} className="flex justify-between rounded-control bg-canvas/60 px-3 py-2">
            <span className="text-fg-2">{kind}</span><span className="text-accent font-semibold">{count}</span>
          </li>)}
        </ul>
        {recorder && <div className="mt-3 text-sm text-fg-2">
          {recorder.sessions === 0
            ? <p>This <a className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg" href="https://github.com/fitzforge/polestar" rel="noopener">Polestar Recorder</a> file holds nothing Everloot can use yet. The game can leave it empty after a restart: play a session with the Recorder on, log out, and choose it again.</p>
            : <p>From your <a className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg" href="https://github.com/fitzforge/polestar" rel="noopener">Polestar Recorder</a> file: {recorder.sessions} {recorder.sessions === 1 ? "session" : "sessions"} of {recorder.characters} {recorder.characters === 1 ? "character" : "characters"}, each sent as its own upload.</p>}
          {recorder.unread > 0 && <p className="mt-1 text-fg-2">{recorder.unread} {recorder.unread === 1 ? "session is" : "sessions are"} in a format Everloot does not read and stay out.</p>}
          <p className="mt-1 text-fg-2">What is sent: where you stood when an NPC&apos;s window was open (quest givers, vendors, trainers, flight masters), NPCs you killed or saw as rares (where you stood, never a map pin), rares and treasures your minimap showed (at their own place), the dungeons and raids you entered (where you stood before zoning in) and the bosses you fought there, the quests you accepted with their givers, turn-ins and rewards, and your loot windows (counted, not yet in the drop rates). Character names, realms, session names and your notes stay on this computer. The server gives each character its own install id, so a fact counts once three characters on three connections agree on it.</p>
          {skipped.length > 0 && <p className="mt-1 text-fg-2">Not converted: {skipped.map(([kind, n]) => `${kind} (${n.toLocaleString("en-US")})`).join(", ")}.</p>}
          {capped.length > 0 && <p className="mt-1 text-fg-2">The Recorder stopped recording some kinds at its limits: {capped.map(([kind, n]) => `${kind} (${n.toLocaleString("en-US")} not recorded)`).join(", ")}. Those sessions are missing events of that kind.</p>}
        </div>}
        {prepared.value.addons.length > 0 && <div className="mt-3 text-sm text-fg-2">
          <p>Installed addons in this upload ({prepared.value.addons.length}), recorded because you ran <code>/everloot addons on</code>:</p>
          <p className="mt-1 text-fg-2">{prepared.value.addons.join(", ")}</p>
          <p className="mt-1 text-fg-2">This list is never published row by row; the site shows only counts for addons that at least three installs report.</p>
        </div>}
        {censusSummary(prepared.value.census) && <div className="mt-3 text-sm text-fg-2">
          <p>Census in this upload: {censusSummary(prepared.value.census)}, recorded because the census is on in your addon (<code>/everloot census off</code> stops it).</p>
          <p className="mt-1 text-fg-2">Each row holds a character&apos;s game id, race, class, level and faction, never a name. The server replaces the id with a key before anything is stored, and the site shows only counts that cover at least 10 characters from at least three installs.</p>
        </div>}
        {(prepared.value.counts.player_seen ?? 0) > 0 && <div className="mt-3 text-sm text-fg-2">
          <p>Players in this upload: {prepared.value.counts.player_seen.toLocaleString("en-US")}, recorded because you ran <code>/everloot players on</code>.</p>
          {playerPages
            ? <p className="mt-1 text-fg-2">Each row holds a character&apos;s name, realm, race, class, level and guild, and the day it was seen, never where. Everloot keeps the newest row per character and shows it on a public player page with a link to hide it. Characters whose owners hid them are skipped.</p>
            : <p className="mt-1 text-fg-2">Everloot does not collect player rows yet, so the server drops these. They stay in your file.</p>}
        </div>}
        {prepared.value.skipped.length > 0 && <p className="mt-3 text-sm text-fg-2">
          Skipped {prepared.value.skipped.length.toLocaleString("en-US")} already settled: {prepared.value.skipped.length === 1 ? "this row repeats a fact" : "these rows repeat facts"} at least five installs agree on, with no other report for 14 days, so Everloot does not need {prepared.value.skipped.length === 1 ? "it" : "them"} again. {prepared.value.skipped.length === 1 ? "It stays" : "They stay"} in your file.
        </p>}
        <p className="mt-3 text-sm text-fg-2">{prepared.value.held.legacy} legacy records without event IDs, {prepared.value.held.named} unchecked named records, and {prepared.value.held.invalid} invalid records stay out of this upload. Keep your original file.</p>
        <p className="mt-2 text-sm text-fg-2">{prepared.value.batches.length} batches. Only a confirmed storage receipt advances progress. Named choices are checked against the grant on the server.</p>
        <button disabled={busy || !prepared.value.batches.length || complete} onClick={() => void send()} className={outlineButton + " mt-4"}>
          {sending ? "Sending…" : complete ? "Upload complete" : session?.next ? "Resume upload" : "Send upload"}
        </button>
      </Card>}
      {session && <div role="status"><Card className="text-sm text-fg-2">
        <p className={complete ? "text-q-uncommon font-semibold" : "font-semibold"}>{complete ? "Upload processed — thank you." : error ? "Upload paused — keep your file." : "Uploading…"}</p>
        <p className="mt-2">{session.next} of {session.batches.length} batches confirmed; {accepted} records saved{rejected ? `, ${rejected} records rejected` : ""}.</p>
        <progress aria-label="Confirmed upload batches" value={session.next} max={session.batches.length} className="mt-3 w-full" />
        {error && <p className="mt-2">Retry resumes at the first unconfirmed batch. Previously confirmed batches are retained.</p>}
        {!!rejected && <ul className="mt-2">{session.receipts.flatMap((receipt, batch) => (receipt.rejected ?? []).map((item) =>
          <li key={`${batch}-${item.index}`}>Batch {batch + 1}, record {item.index}: {item.reason}</li>))}</ul>}
      </Card></div>}
      <Card>
      <details className="text-sm text-fg-2">
        <summary className="cursor-pointer font-semibold">Withdraw named sharing</summary>
        <p className="mt-3">Revoke a grant to withdraw the records it authorized. A verified character owner can also opt out across guild rosters, attendance, loot, gear and gold. An opt-out stays in effect for later uploads.</p>
        <label className="block mt-3">Grant to withdraw
          <input type="password" autoComplete="off" className={input + " mt-2"} value={withdrawToken} onChange={(e) => setWithdrawToken(e.target.value)} disabled={withdrawing} />
        </label>
        <div className="mt-3 flex flex-wrap gap-3">
          <button className={outlineButton} disabled={withdrawing || !/^[a-f0-9]{64}$/.test(withdrawToken.trim())} onClick={() => void withdraw("revoke")}>Revoke grant</button>
          <button className={outlineButton} disabled={withdrawing || !/^[a-f0-9]{64}$/.test(withdrawToken.trim())} onClick={() => void withdraw("opt-out")}>Opt out character</button>
        </div>
        {withdrawStatus && <p role="status" className="mt-3">{withdrawStatus}</p>}
      </details>
      </Card>
    </div>
  );
}
