// The window's pages as HTML strings: what app.ts puts on screen. Nothing here touches the DOM, so each page can be
// built from an AppState and a View in a test. The event wiring and the state the View is made from stay in app.ts.
import type { ReportInfo } from "../shared/reports";
import { accountOf as account } from "../main/engine";
import { ago, clock, companionStatus, copyLabel, esc, gold, kb, JOB_NAMES, restartWait, setupAddonLine, sparkline, statusText, when, type CompanionState } from "./format";
import { JOBS, NO_SOURCED_ANSWER, type AddonInfo, type AppState, type AskInfo, type BackupInfo, type ChangeItem, type CharacterRow, type CharactersInfo, type ChatInfo, type ChatProgress, type DataPart, type DataUsage, type PriceLookup, type FileSummary, type GameFolderCandidate, type Job, type JobStatus, type MarketInfo, type MoneyDay } from "../shared/types";
import { PROVIDER_PRESETS, assistantSource, keptModelPick, manualModelShown, presetFor, type ModelChoice, type ProviderKind } from "../shared/providers";
import { LOCAL_ONLY_CATEGORIES } from "../shared/ledger";
import { websiteUrl } from "../shared/website";
import { emptyCause, emptyState, ghostProfile, jobOfLine, ownedLockouts, threadLines, workingStrip } from "./parts";

/** What the pages fetched from the main side, by page; a field is missing until its page has loaded. */
export type PageData = { reports?: ReportInfo; upload?: FileSummary[]; backups?: BackupInfo[]; market?: MarketInfo; ask?: AskInfo; addon?: AddonInfo; changes?: ChangeItem[]; changesError?: string; characters?: CharactersInfo; chat?: ChatInfo; usage?: DataUsage };
/** The welcome screen's addon check for the picked folder: the installed version (null: not there) and what Install did ("!" starts an error). */
export type SetupAddon = { folder: string; installed: string | null; note: string };
/** What was typed in the open provider form, kept in memory only (never saved or logged) so a redraw does not eat it. Same provider only. */
export type ProviderDraft = { kind: ProviderKind; key: string; baseUrl: string; model: string | null; modelText: string };
/** Delete my local data: asking, deleting, or showing what another program kept open. */
export type Wipe = { stage: "ask" | "deleting" | "left"; left: string[]; error: string };

/** What the pages read besides the state: the window's own choices, drafts and fetched data, as app.ts holds them now. */
export interface View {
  state: AppState | null;
  data: PageData;
  candidates: GameFolderCandidate[];
  chosenFolder: string | null;
  censusChoice: boolean;
  playersChoice: boolean;
  setupAddon: SetupAddon | null;
  agreed: boolean;
  connecting: boolean;
  busy: string;
  flash: string;
  pickKind: ProviderKind;
  pickOpen: boolean;
  providerDraft: ProviderDraft | null;
  setupNote: string;
  advancedOpen: boolean | null;
  liveModels: Partial<Record<ProviderKind, ModelChoice[]>>;
  live: ChatProgress | null;
  copied: { index: number; label: string } | null;
  priceLookup: PriceLookup | null;
  charPick: string | null;
  wipe: Wipe;
}

/** The Assistant panel's markup as last drawn; a background update that would draw the same leaves an unsaved page's DOM alone. */
export const drawn = { assistant: "" };

const ext = (url: string, text: string) => `<button type="button" class="link" data-open="${esc(url)}">${esc(text)}</button>`;

const dot = (j: JobStatus) => `<span class="dot dot-${j.state}" aria-hidden="true"></span>`;

const onOff = (job: Job, s: AppState) => (job === "ask" ? s.settings.ask.enabled : s.settings[job]);

const jobSwitch = (job: Job, s: AppState) => `<label class="switch"><input type="checkbox" data-toggle="${job}" ${onOff(job, s) ? "checked" : ""}><span>${onOff(job, s) ? "On" : "Off"}</span></label>`;

/** The inline icon set: one 24-unit grid and one stroke, painted by `.ico`. Always decorative; the label beside it names the control. */
const ICONS: Record<string, string> = {
  reports: '<path d="M4 20V10m8 10V4m8 16v-7M2 21h20"/>',
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chat: '<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>',
  characters: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  market: '<path d="M4 20V10m8 10V4m8 16v-7M2 21h20"/>',
  ask: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 8 3 4-3 4m6 0h4"/>',
  addon: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10L3 8m9 5 9-5m-9 5v9"/>',
  changes: '<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  log: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6"/>',
  settings: '<path d="M10.3 3h3.4l.5 2.4 1.7.9 2.3-.8 1.7 2.9-1.8 1.7v1.8l1.8 1.7-1.7 2.9-2.3-.8-1.7.9-.5 2.4h-3.4l-.5-2.4-1.7-.9-2.3.8-1.7-2.9 1.8-1.7v-1.8L4.1 8.4l1.7-2.9 2.3.8 1.7-.9Z"/><circle cx="12" cy="12" r="2.6"/>',
  account: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="10" r="3.2"/><path d="M6.4 18.6a6.5 6.5 0 0 1 11.2 0"/>',
  bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8V7a3 3 0 0 1 6 0v1M12 12v8M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  alert: '<path d="M12 9v4m0 3.5v.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  /** The app itself, for thread lines no job wrote: the mark's diamond. */
  app: '<path d="M12 3 21 12 12 21 3 12Z"/>',
};

export const icon = (name: string, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;

const runBtn = (job: Job, s: AppState, label = "Run now", primary = false) => `<button type="button" class="btn${primary ? " btn-primary" : ""}" data-run="${job}" ${onOff(job, s) && s.engine.files.length && !s.engine.paused && s.engine.jobs[job].state !== "running" ? "" : "disabled"}>${label}</button>`;

/** A button that opens Chat with a question ready; the click handler sends it. */
const askChip = (question: string, label = question) => `<button type="button" class="chip ask" data-ask="${esc(question)}">${esc(label)}</button>`;

/** The question to put to the chat about a job that failed. */
const whyQuestion = (job: Job, s: AppState) => `Why did ${job === "ask" ? "the /ask answers" : job} fail? The app says: ${s.engine.jobs[job].message}`;

/** One question per failed job, in job order. */
const whyFailed = (s: AppState): string[] => (["upload", "prices", "ask"] as Job[]).filter((j) => s.engine.jobs[j].state === "error").map((j) => whyQuestion(j, s));

/** The "ask why" link under a stat whose job failed; nothing otherwise. */
const askWhy = (job: Job, s: AppState) => (s.engine.jobs[job].state === "error" ? ` · <button type="button" class="link" data-ask="${esc(whyQuestion(job, s))}">ask why</button>` : "");

/** The newest log line a job wrote, for its page's strip; null before it wrote one. */
const lastLineOf = (job: Job, s: AppState) => [...s.engine.log].reverse().find((l) => jobOfLine(l.text) === job) ?? null;

const logLines = (s: AppState, n: number) => s.engine.log.slice(-n).reverse().map((l) => `<div><time>${clock(l.at)}</time><span class="${l.level}">${esc(l.text)}</span></div>`).join("") || '<span class="muted">Nothing yet.</span>';

export function welcome(v: View): string {
  const { state, candidates, chosenFolder, setupAddon, busy, connecting, flash, censusChoice, playersChoice, agreed } = v;
  const list = candidates.length
    ? `<div class="choices">${candidates.map((c) => `
        <label class="choice"><input type="radio" name="folder" value="${esc(c.folder)}" ${chosenFolder === c.folder ? "checked" : ""}>
          <span class="grow"><span class="mono">${esc(c.product)}</span> <span class="muted">${c.files ? `${c.files} account file(s) with Everloot data` : c.hasAccounts ? "no Everloot data yet" : "never played here yet"}</span><br><span class="muted mono small">${esc(c.folder)}</span></span></label>`).join("")}</div>`
    : `<p class="muted">No World of Warcraft folder was found in the usual places. Browse to the folder that holds <code>WTF</code>, for example <code>${state?.platform === "win32" ? "World of Warcraft\\_forever_" : "World of Warcraft/_forever_"}</code>.</p>`;
  const custom = chosenFolder && !candidates.some((c) => c.folder === chosenFolder) ? `<p class="mono fg2">${esc(chosenFolder)}</p>` : "";
  const a = setupAddon?.folder === chosenFolder ? setupAddon : null;
  const line = setupAddonLine(a?.installed);
  const addon = (line ? `<p class="fg2 small">${esc(line)} <button type="button" class="btn small" id="setupInstallAddon" ${busy ? "disabled" : ""}>${busy === "setupAddon" ? "Installing…" : "Install the addon"}</button></p>` : "")
    + (a?.note ? `<p role="status" class="${a.note.startsWith("!") ? "error" : "ok"} small">${esc(a.note.replace(/^!/, ""))}</p>` : "");
  const signedIn = state?.account.signedIn;
  return `<div class="welcome">
    <div class="brand"><img src="logo.png" alt=""><h1>Set up Everloot</h1></div>
    <section class="panel signin" aria-label="Your everloot.app account">
      ${signedIn
        ? `<p class="ok">Signed in to everloot.app <span class="muted small">key …${esc(state?.account.hint ?? "")}</span></p>`
        : connecting
          ? `<p class="fg2">Finish in your browser: sign in with Battle.net, then press <b>Connect</b>.</p><div class="row center"><button type="button" class="btn" id="connect">Open the browser again</button><button type="button" class="btn" id="connectCancel">Cancel</button></div>`
          : `<button type="button" class="btn btn-primary btn-block" id="connect">Sign in with everloot.app</button>
            <p class="muted small">Opens everloot.app in your browser. Sign in with Battle.net, press Connect, and you're back here. The app never sees your password.</p>`}
      ${flash ? `<p role="status" class="${flash.startsWith("!") ? "error" : "ok"} small">${esc(flash.replace(/^!/, ""))}</p>` : ""}
      <div class="or">or</div>
      <p class="muted small">Continue without an account below: uploads and prices work either way. Signing in raises the Chat and <code>/ask</code> limits and brings your saved talent builds into the game.</p>
    </section>
    <div>
      <p class="lead">It runs in the tray beside the game: uploads what the addon recorded after every logout, keeps market prices in your tooltips, installs addon updates, carries the site's tools and a chat over Everloot's data, and, if you turn it on, answers <code>/ask</code>.</p></div>
    <section class="panel">
      <h2>What leaves this computer</h2>
      <ul class="plain fg2">
        <li>Anonymous observations from <code>Everloot.lua</code>: drops, vendors, recipes, spawns, auction scans. No character or account name.</li>
        <li><label class="switch"><input type="checkbox" id="censusConsent" ${censusChoice ? "checked" : ""}> Census: the race, class, level and faction of your characters and of players the addon sees. Never names, guilds, gear or places; the site shows only totals.</label></li>
        <li><label class="switch"><input type="checkbox" id="playersConsent" ${playersChoice ? "checked" : ""}> Player pages, on in a new install: the name, realm, race, class, level and guild of the players the addon saw, so a page can be found by name. Anyone can hide a character at everloot.app/players/opt-out; <code>/everloot players off</code> in the game stops recording and deletes them.</label></li>
        <li>The uploader keeps guild, gold, collection and installed-addon rows here. If you configure a model for Chat, it receives your questions and any local character details it uses to answer.</li>
      </ul>
      <p class="small fg2">Uploaded observations are published under CC BY-SA 4.0, credited to Everloot contributors. Source: ${ext("https://github.com/Everloot/everloot", "github.com/Everloot/everloot")} · Rules: ${ext("https://everloot.app/privacy", "everloot.app/privacy")}</p>
    </section>
    <section class="panel">
      <h2>Which game folder?</h2>
      ${list}${custom}${addon}
      <div class="row"><button type="button" class="btn" id="browse">Browse…</button><button type="button" class="btn" id="redetect">Look again</button></div>
    </section>
    <label class="agree"><input type="checkbox" id="agree" ${agreed ? "checked" : ""}> I agree to the ${ext("https://everloot.app/terms", "Terms of Use")} and ${ext("https://everloot.app/privacy", "Privacy Policy")}.</label>
    <div class="row"><button type="button" class="btn btn-primary btn-lg" id="start" ${chosenFolder && agreed ? "" : "disabled"}>Start</button><span class="muted">Nothing runs before you press Start.</span></div>
  </div>`;
}

const STATE_LABEL: Record<CompanionState, string> = { setup: "Setup", paused: "Paused", error: "Error", running: "Running", off: "Off", idle: "Waiting" };

/** The whole app's state as a pill kind, for the Overview's status line. */
const STATE_PILL: Record<CompanionState, string> = { setup: "off", paused: "paused", error: "failed", running: "working", off: "off", idle: "waiting" };

export function overview(s: AppState, v: View): string {
  const { data } = v;
  const e = s.engine;
  const up = e.jobs.upload, pr = e.jobs.prices, ask = e.jobs.ask;
  const addon = data.addon;
  const status = companionStatus(s);
  const addonLine = !addon ? "…" : addon.installed
    ? (addon.newer && addon.latest ? `${addon.installed} <span class="warn">→ ${addon.latest.version} available</span>` : `${addon.installed}${addon.latest ? ' <span class="ok">up to date</span>' : ""}`)
    : '<span class="warn">not installed</span>';
  const changes = (data.changes ?? []).slice(0, 5);
  // The first action fits the state; Upload now and Refresh prices follow whenever the jobs can run at all.
  const lead = status.state === "setup" ? `<button type="button" class="btn btn-primary" data-page="settings">Open Settings</button>`
    : status.state === "off" ? `<button type="button" class="btn btn-primary" data-page="settings">Choose what runs</button>`
    : status.state === "paused" ? `<button type="button" class="btn btn-primary" id="pause">Resume</button>`
    : status.state === "error" ? `<button type="button" class="btn btn-primary" data-page="log">Open the log</button>` : "";
  const runs = status.state === "setup" || status.state === "off" ? "" : `${runBtn("upload", s, "Upload now", !lead)}${runBtn("prices", s, "Refresh prices")}`;
  const failed = status.state === "error" ? status.jobs.map((j) => `<p class="hero-failed small"><b>${esc(JOB_NAMES[j])}:</b> ${esc(statusText(e.jobs[j]))}</p>`).join("") : "";
  // One cell per job in the status strip: a label, the state in a word, and one line of detail under it.
  const cell = (ico: string, name: string, dotHtml: string, state: string, sub: string) => `<div class="stat"><div class="k">${icon(ico, "ico ico-k")}${name}</div><div class="v">${dotHtml}<span>${state}</span></div><div class="s">${sub}</div></div>`;
  const last = (j: JobStatus) => (j.at ? `last run ${ago(j.at)}` : "not run yet");
  const kind = STATE_PILL[status.state];
  const ring = kind === "working" ? '<i class="pill-ring" aria-hidden="true"></i>' : "";
  const thread = threadLines(e.log, 12, { upload: icon("upload"), prices: icon("market"), ask: icon("ask"), app: icon("app") });
  return `<div class="page">
    <div class="head"><h1>Overview</h1></div>
    ${s.notice ? `<p class="callout error">${icon("alert")}<span>${esc(s.notice)}</span></p>` : ""}
    ${foreverCallout(s)}
    ${updateCallout(s)}
    ${dataNotice(data)}
    <section class="status-line" data-state="${status.state}" aria-labelledby="heroTitle">
      <span class="pill-s pill-${kind}">${ring}${STATE_LABEL[status.state]}</span>
      <div class="status-text"><b id="heroTitle">${esc(status.headline)}</b><span class="muted">${esc(status.detail)}</span></div>
      <div class="status-actions">${lead}${runs}</div>
      ${failed ? `<div class="status-failed">${failed}</div>` : ""}
    </section>
    <div class="stats">
      ${cell("upload", "Upload", dot(up), up.state === "ok" ? "OK" : up.state === "error" ? "Failed" : up.state === "off" ? "Off" : up.state === "running" ? "Running" : "Waiting", `${last(up)}${askWhy("upload", s)}`)}
      ${cell("market", "Market prices", dot(pr), data.market ? `${new Set(data.market.last.map((r) => r.realm.toLowerCase())).size} realm(s)` : pr.state === "off" ? "Off" : pr.state === "running" ? "Running" : "Waiting", `${data.market?.scans[0] ? `your last scan ${ago(data.market.scans[0].at)}` : last(pr)}${suggestionLine(data.market)}${askWhy("prices", s)}`)}
      ${cell("ask", "/ask", dot(ask), ask.state === "off" ? "Off" : ask.state === "error" ? "Failed" : ask.state === "running" ? "Running" : "On", `${ask.at ? last(ask) : s.settings.ask.enabled ? "waiting" : 'answers <code>/ask</code> in game · <button type="button" class="link" data-page="ask">turn on in Ask</button>'}${askWhy("ask", s)}`)}
      ${cell("addon", "Addon", "", addonLine, `${addon?.slots.prices ? "prices file in game" : "no prices file yet"}${addon && (!addon.installed || addon.newer) ? ` · <button type="button" class="link" data-page="addon">${addon.installed ? "update" : "install"}</button>` : ""}`)}
    </div>
    <div class="overview-grid">
      <div>
        <div class="sec-head"><h2>What Everloot did</h2><button type="button" class="link" data-page="log">open the log</button></div>
        ${thread ? `<div class="thread-steps">${thread}</div>` : emptyState(emptyCause("log", s), icon("log"))}
      </div>
      <div>
        <div class="sec-head"><h2>Latest changes</h2><button type="button" class="link" data-page="changes">all</button></div>
        <div class="list">${changes.length ? changes.map((c) => `<div class="item"><div class="t">${c.link ? ext(c.link, c.title) : esc(c.title)}</div><div class="muted small">${when(c.date)}</div></div>`).join("") : data.changesError ? emptyState(emptyCause("changes", s, { error: data.changesError }), icon("changes")) : `<span class="muted">Loading…</span>`}</div>
      </div>
    </div>
  </div>`;
}

export function chat(v: View): string {
  const { data, copied, flash } = v;
  const c = data.chat;
  const thread = (c?.messages ?? []).map((m, i) => {
    // Search alone found nothing and no model is set up: say what would answer it.
    const nudge = !m.model && m.text === NO_SOURCED_ANSWER && !c?.providers.length && c?.mode === "plain search"
      ? `<br>Search alone only matches names in Everloot's data. A model reads the question, fixes the spelling and looks it up for you. <button type="button" class="link" data-addmodel>Assistant setup</button> is optional.`
      : "";
    const meta = m.role === "assistant"
      ? `<div class="meta"><button type="button" class="link copy" data-copy="${i}">${esc(copyLabel(i, copied))}</button>${m.model ? `<b>${esc(m.model)}</b>` : m.stopped ? "" : "<b>search only</b>"}${m.stopped ? `${m.model ? " · " : ""}Stopped` : ""}${m.steps.length ? ` · ${m.steps.length} tool call(s): ${esc(m.steps.map((st) => st.tool).join(", "))}` : ""}${m.sources.length ? `<br>Sources: ${m.sources.map((x) => esc(x)).join(" · ")}` : m.model && !m.stopped && m.text !== NO_SOURCED_ANSWER ? "<br>No source in Everloot's data; the model's own knowledge" : ""}${nudge}</div>`
      : `<div class="meta">${clock(m.at)}</div>`;
    return `<div class="msg msg-${m.role}">${esc(m.text)}${meta}</div>`;
  }).join("");
  return `<div class="page chat"><div class="chat-top">
    <div class="head"><h1>Chat</h1><span class="sub">${c ? `${esc(c.mode)} · ${c.withToken ? "your MCP token" : c.withAccountKey ? "public MCP, your account's limits" : "public MCP, rate limited"}` : ""} <button type="button" class="link" id="chatClear" ${c?.busy ? "disabled" : ""}>clear</button></span></div>
    <p class="muted small">Ask anything about the game. The model looks it up in Everloot's own MCP tools first and names the sources; when they have nothing it says the answer is its own knowledge. The transcript is saved in your data folder. Your selected model provider receives your questions, conversation history and any local character details the model uses, including names, gold, gear and progress.</p>
    ${assistant(c, "chat", v)}
    ${flash ? `<p class="${flash.startsWith("!") ? "error" : "ok"} small">${esc(flash.replace(/^!/, ""))}</p>` : ""}
    </div>
    <div class="thread" id="thread">${thread || `<div class="chat-empty"><svg class="mark-lg" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 6 34 20 20 34 6 20Z"/></svg><p class="empty-lead">Ask anything about WoW: Forever: a drop, a vendor, a recipe, a price, a quest.</p><div class="chips">${starters(c).map((q) => askChip(q)).join("")}</div></div>`}${c?.busy ? `<div class="msg msg-assistant" id="chatLive">${liveAnswer(v.live)}</div>` : ""}${c?.error ? `<div class="msg msg-assistant error">${esc(c.error)}</div>` : ""}</div>
    <form id="chatForm" class="composer"><textarea id="chatText" rows="2" aria-label="Your question" placeholder="Ask about Forever. Enter sends, Shift+Enter is a new line." ${c?.busy ? "disabled" : ""}></textarea>
      <div class="composer-bar">${c ? modelMenu(c, v.liveModels) : ""}${c?.busy ? `<button type="button" class="btn" id="chatStop">Stop</button>` : ""}<button type="submit" class="btn btn-primary" ${c?.busy ? "disabled" : ""}>Send</button></div></form>
  </div>`;
}

/**
 * The model menu under the question box, as in other chat apps: every model of every provider saved
 * here, the one in use selected; picking one switches Chat and the in-game /ask. The last entries
 * add a key or manage the saved ones.
 */
export function modelMenu(c: ChatInfo, liveModels: View["liveModels"]): string {
  const groups = c.providers.map((p) => {
    const preset = presetFor(p.kind);
    const models = modelsOf(p.kind, liveModels).map((m) => ({ id: m.id, label: m.label }));
    if (!models.some((m) => m.id === p.model)) models.unshift({ id: p.model, label: p.model });
    const on = (id: string) => c.provider?.kind === p.kind && c.provider.model === id;
    return `<optgroup label="${esc(preset?.name ?? p.kind)}">${models.map((m) => `<option value="${esc(`${p.kind}|${m.id}`)}" ${on(m.id) ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</optgroup>`;
  }).join("");
  const current = c.provider ? "" : `<option value="" selected>${c.mode === "plain search" ? "Search only, no model" : esc(`config.json: ${c.mode}`)}</option>`;
  return `<select id="modelPick" class="model-pick" aria-label="Model" ${c.busy ? "disabled" : ""}>${current}${groups}<option value="add">Assistant setup…</option>${c.providers.length ? `<option value="manage">Assistant setup: saved providers…</option>` : ""}</select>`;
}

/** The answer so far, and what the model is doing while there is no text or it is running a tool. */
export function liveAnswer(live: ChatProgress | null): string {
  const doing = live?.tool ? `Looking up ${esc(live.tool)}…` : live?.text ? "" : "Answering…";
  return `${live?.text ? esc(live.text) : ""}${doing ? `<div class="meta">${doing}</div>` : ""}`;
}

/** A provider's monogram tile on its own colour; render() paints it, since the page's CSP allows no inline styles. */
function tile(kind: ProviderKind, small = false): string {
  const p = presetFor(kind);
  return p ? `<span class="tile${small ? " tile-sm" : ""}" aria-hidden="true" data-tile="${esc(p.colour)}">${esc(p.mark)}</span>` : "";
}

const modelsOf = (kind: ProviderKind, liveModels: View["liveModels"]): ModelChoice[] => liveModels[kind] ?? presetFor(kind)?.models ?? [];

/** The provider form's model list, the pick kept when the new list still has it. An empty `picked` is the player's "Another model id…" choice and stays; leaving it out takes the first model. */
function modelSelect(kind: ProviderKind, liveModels: View["liveModels"], picked?: string): string {
  const models = modelsOf(kind, liveModels);
  if (!models.length) return "";
  const on = keptModelPick(models, picked);
  return `<select name="model" id="providerModelPick" class="grow">${models.map((m) => `<option value="${esc(m.id)}" ${m.id === on ? "selected" : ""}>${esc(m.label)}${m.note ? ` · ${esc(m.note)}` : ""}</option>`).join("")}<option value="" ${on === "" ? "selected" : ""}>Another model id…</option></select>`;
}

/** Questions to start with: about the game always; about the player's own data when a model can call the local tools. */
function starters(c: ChatInfo | null | undefined): string[] {
  const game = ["What drops the Bindings of the Windseeker?", "Where do I learn Enchanting past 225?"];
  if (!c || c.mode === "plain search") return game;
  return ["How much gold do my characters have?", "When did I last scan my realms?", "Is my data uploading?", ...game];
}

/** The provider picker: one preset, its get-key page, its key, a model from the list or typed, and a custom server address; and the keys already saved. */
function providerForm(c: ChatInfo, v: View, note = ""): string {
  const { pickKind, providerDraft, liveModels } = v;
  const preset = presetFor(pickKind) ?? PROVIDER_PRESETS[0];
  const saved = c.providers.some((p) => p.kind === preset.kind);
  const kinds = PROVIDER_PRESETS.map((p) => `<option value="${p.kind}" ${p.kind === preset.kind ? "selected" : ""}>${esc(p.label)}${c.providers.some((s) => s.kind === p.kind) ? " · saved" : ""}</option>`).join("");
  const name = (kind: ProviderKind) => esc(presetFor(kind)?.name ?? kind);
  const list = c.providers.length
    ? `<div class="saved-keys"><span class="muted small">Saved here:</span>${c.providers.map((p) => `<span class="chip chip-key">${tile(p.kind, true)}${name(p.kind)} <button type="button" class="link" data-removekind="${p.kind}" aria-label="Remove ${name(p.kind)}" ${c.busy ? "disabled" : ""}>remove</button></span>`).join("")}</div>`
    : "";
  // The pick is read from the held draft, so a redraw shows the manual box exactly when the player chose it.
  const picked = providerDraft?.kind === preset.kind ? providerDraft.model ?? undefined : undefined;
  const choices = modelsOf(preset.kind, liveModels);
  const manual = manualModelShown(choices, picked);
  const getKey = preset.getKey ? `<p class="small">${ext(preset.getKey.href, preset.getKey.text)} <span class="muted">· opens your browser</span></p>` : "";
  return `<form id="providerForm" class="panel" autocomplete="off" aria-label="Assistant setup">
    ${list}
    <div class="field"><label for="providerKind">Provider</label><div class="tile-row">${tile(preset.kind)}<select name="kind" id="providerKind">${kinds}</select></div>${getKey}</div>
    ${preset.kind === "custom" ? `<div class="field"><label for="providerUrl">Server</label><input type="text" name="baseUrl" id="providerUrl" placeholder="https://host/v1" spellcheck="false"></div>` : ""}
    ${preset.keyFile ? `<div class="field"><label for="providerKey">Key</label><input type="password" name="key" id="providerKey" placeholder="${saved ? "saved; paste a new one to replace it" : preset.kind === "custom" ? "optional" : "paste the key"}" spellcheck="false"><span class="hint">${esc(preset.keyHint)}</span></div>` : ""}
    ${choices.length ? `<div class="field"><label for="providerModelPick">Model</label>${modelSelect(preset.kind, liveModels, picked)}</div>` : ""}
    <div class="field" id="providerModelField" ${manual ? "" : "hidden"}><label for="providerModel">${choices.length ? "Model id" : "Model"}</label><input type="text" name="modelText" id="providerModel" ${manual ? "" : "disabled"} placeholder="${choices.length ? "a model id from the provider" : preset.kind === "ollama" ? "the model you pulled, like qwen3:4b" : "model id"}" spellcheck="false"></div>
    <p class="muted small">${esc(preset.dataNote)} The key is written to a file in your data folder and named from <code>config.json</code>; it goes to that provider only, with your questions and the tool results.</p>
    <p class="muted small">Save and use makes this the model for Chat and puts it first for <code>/ask</code>. It may refresh the model list, but does not test the key with a completion or send your questions.</p>
    ${note}
    <div class="row"><button type="submit" class="btn btn-primary" id="providerSave" ${c.busy ? "disabled" : ""}>Save and use</button><button type="button" class="btn" id="cancelProvider">Cancel</button>${c.busy ? '<span class="muted small">Chat is answering; wait or press Stop.</span>' : ""}</div>
  </form>`;
}

const ASSISTANT_COST = "Everloot search is free. A model you add uses your own provider account, so that provider's pricing and limits apply; some have a limited free tier. A ChatGPT or Claude subscription is not an API key. The website keeps its own keys in your browser tab; setting one up there does not set up this app.";

/**
 * Assistant setup, the same panel on Chat, Ask and Settings: what answers now, the saved providers, and the one provider
 * form. Search needs no key; a model is optional and its cost is the player's own provider account.
 */
export function assistantSetup(c: ChatInfo | undefined, where: "chat" | "ask" | "settings", v: View): string {
  const { data, setupNote, pickOpen, state } = v;
  const a = data.ask;
  const note = `<p id="assistantNote" role="status" class="${setupNote.startsWith("!") ? "error" : "ok"} small">${esc(setupNote.replace(/^!/, ""))}</p>`;
  const source = c ? assistantSource(c) : null;
  const chatLine = !c ? "Loading…"
    : source === "search" ? "Chat answers recorded item-price questions and shows <b>Everloot search</b> results: no AI key or token file needed. A model is optional and uses your own provider account, so its pricing applies."
    : source === "app" ? `Recorded item-price questions use market data directly. Other Chat questions are answered by <b>${esc(c.provider!.model)}</b>, which looks things up in Everloot's data first; with no source there, the answer says it is the model's own knowledge.`
    : `Recorded item-price questions use market data directly. Other Chat questions use the first entry in <code>config.json</code>: <code>${esc(c.mode)}</code>. Setup keeps your hand-written entries as they are.`;
  const askLine = !a ? "Loading…"
    : a.providerError ? `<span class="error">${esc(a.providerError)}</span>`
    : a.providers.length ? `Recorded item-price questions use market data directly, without a model. For other questions, <b>Everloot search</b> finds the sources, then <b>${esc(a.providers.join(" > "))}</b> writes at most two sentences from the top three. If one fails in a way that allows it, the next one listed is tried; Chat uses only the first. No search sources means no model answer.`
    : "<code>/ask</code> answers recorded item-price questions and shows the top <b>Everloot search</b> result: no model or key needed. If an item or realm is unclear, it asks you to specify it.";
  const rows = where === "settings" && c?.providers.length
    ? c.providers.map((p) => {
      const inUse = c.provider?.kind === p.kind;
      return `<div class="set-row">${tile(p.kind)}<div class="grow"><b>${esc(presetFor(p.kind)?.name ?? p.kind)}</b><div class="muted small">${esc(p.model)}${inUse ? ' · <span class="ok">in use</span>' : ""}</div></div>
        ${inUse ? "" : `<button type="button" class="btn" data-usekind="${p.kind}" data-usemodel="${esc(p.model)}" ${c.busy ? "disabled" : ""}>Use</button>`}<button type="button" class="btn" data-removekind="${p.kind}" ${c.busy ? "disabled" : ""}>Remove</button></div>`;
    }).join("")
    : "";
  const opener = pickOpen ? "" : `<button type="button" class="btn" id="assistantOpen" data-addmodel ${c ? "" : "disabled"}>Assistant setup</button>`;
  const jobLine = state ? `<p class="${state.engine.jobs.ask.state === "error" ? "error" : "fg2"} small">${esc(statusText(state.engine.jobs.ask))}</p>` : "";
  const body = `${where === "ask" ? `<p>${askLine}</p>${jobLine}` : `<p>${chatLine}</p>`}
    ${rows}
    ${where === "settings" ? `<p class="muted small">Chat uses the first model only; the in-game <code>/ask</code> goes down the list. The private server and token file are under <button type="button" class="link" data-advanced>Advanced on the Ask page</button>.</p>` : ""}
    ${where === "chat" ? "" : `<p class="muted small">${ASSISTANT_COST}</p>`}
    ${c && pickOpen ? providerForm(c, v, note) : note}`;
  return where === "settings"
    ? `<section class="panel set-sec" id="assistant" aria-labelledby="assistantTitle"><div class="set-lead"><h2 id="assistantTitle">Assistant</h2>${opener}</div><div class="set-body">${body}</div></section>`
    : `<section class="panel assistant" id="assistant" aria-labelledby="assistantTitle"><div class="row between"><h2 id="assistantTitle">Assistant</h2>${opener}</div>${body}</section>`;
}

/** The panel as the page being built shows it; what it drew is kept so a later background update can tell whether anything changed. */
const assistant = (c: ChatInfo | undefined, where: "chat" | "ask" | "settings", v: View): string => (drawn.assistant = assistantSetup(c, where, v));

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

const totals = (days: MoneyDay[]) => days.reduce((a, d) => ({ earned: a.earned + d.earned, spent: a.spent + d.spent }), { earned: 0, spent: 0 });

const netOf = (m: { earned: number; spent: number }) => m.earned - m.spent;

const signed = (copper: number) => `${copper >= 0 ? "+" : "−"}${gold(Math.abs(copper))}`;

/** The 30-day cumulative net line and its area from the zero line; the page's signature element. */
function moneyRiver(days: MoneyDay[]): string {
  const w = 560, h = 96, pad = 6;
  let net = 0;
  const pts = [0, ...days.map((d) => (net += d.earned - d.spent))];
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), span = hi - lo || 1;
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => (pad + (1 - (v - lo) / span) * (h - pad * 2)).toFixed(1);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v)}`).join(" ");
  return `<svg class="river" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Cumulative net gold over the last thirty days"><path class="river-area" d="${line} L${w},${y(0)} L0,${y(0)} Z"/><line class="river-zero" x1="0" y1="${y(0)}" x2="${w}" y2="${y(0)}"/><path class="river-line" d="${line}"/></svg>`;
}

/** A 30-day area of a series, for the drawer's gold history. */
function goldChart(points: { at: string; copper: number }[]): string {
  if (points.length < 2) return `<p class="muted small">One gold snapshot so far; a chart needs two.</p>`;
  const w = 560, h = 110, pad = 6;
  const lo = Math.min(...points.map((p) => p.copper)), hi = Math.max(...points.map((p) => p.copper)), span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => (pad + (1 - (v - lo) / span) * (h - pad * 2)).toFixed(1);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.copper)}`).join(" ");
  const first = esc(points[0].at.slice(0, 10)), last = esc(points[points.length - 1].at.slice(0, 10));
  return `<svg class="river" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Gold from ${first} to ${last}"><path class="river-area" d="${line} L${w},${y(lo)} L0,${y(lo)} Z"/><path class="river-line" d="${line}"/></svg>`;
}

/** Earned above the line, spent below, one column a day for the last seven. */
function weekBars(days: MoneyDay[]): string {
  const week = days.slice(-7);
  const max = Math.max(1, ...week.map((d) => Math.max(d.earned, d.spent)));
  const cols = week.map((d) => {
    const letter = DAY_LETTERS[new Date(`${d.date}T00:00:00Z`).getUTCDay()];
    return `<div class="wk-col" title="${d.date}: +${gold(d.earned)} in, −${gold(d.spent)} out"><div class="wk-up"><i data-h="${Math.round((d.earned / max) * 100)}"></i></div><div class="wk-down"><i data-h="${Math.round((d.spent / max) * 100)}"></i></div><span class="wk-d">${letter}</span></div>`;
  }).join("");
  return `<div class="week-bars" role="img" aria-label="Money earned above the line and spent below, one column a day">${cols}</div>`;
}

/**
 * One keyed progress row set, listed apart from the named characters by design. A key a `/everloot link` row in the file
 * names gets that character's name and its page on the site; every row links the site's collections tool.
 */
function keyedRows(c: CharactersInfo | undefined, endpoint: string): string {
  const collections = websiteUrl(endpoint, "/tools/collections");
  return (c?.progress ?? []).map((p) => {
    const who = p.linkedAs ? `<div class="muted small">linked as ${esc(p.linkedAs.name)} of ${esc(p.linkedAs.realm)}</div>` : "";
    const page = p.linkedAs ? ` · ${ext(websiteUrl(endpoint, p.linkedAs.path), "Character page ↗")}` : "";
    const missing = p.missingTitles === null ? "–" : `${p.missingTitles} title${p.missingTitles === 1 ? "" : "s"}`;
    return `<tr><td><span class="mono">${esc(p.key)}</span>${who}</td><td>${esc(p.class.toLowerCase())} ${p.level}</td><td class="num">${p.titles}</td><td class="num">${missing}</td><td>${ownedLockouts(p.lockouts)}</td><td>${ext(collections, "Collections ↗")}${page}</td></tr>`;
  }).join("");
}

/** The private sync's categories as the page names them: the achievements category carries titles only now. */
const SYNC_CATEGORY: Record<string, string> = { raids: "raid lockouts", achievements: "titles", boss_kills: "boss kills" };

/** The character links and private sync the upload job runs: which characters are linked, the last sync and the last problem. */
function linkedCharacters(s: AppState): string {
  const all = s.links ?? [];
  const linked = [...new Set(all.flatMap((l) => l.linked))];
  const frozen = [...new Set(all.flatMap((l) => l.frozen))];
  const last = all.filter((l) => l.syncedAt).sort((a, b) => (b.syncedAt ?? "").localeCompare(a.syncedAt ?? ""))[0];
  const errors = all.flatMap((l) => [l.linkError, l.syncError].filter((e): e is string => !!e).map((e) => (all.length > 1 ? `${account(l.file)}: ${e}` : e)));
  const names = linked.length
    ? `<ul class="plain">${linked.map((n) => `<li><b>${esc(n)}</b></li>`).join("")}</ul>`
    : `<p class="muted small" role="status">Nothing linked yet. Type <code>/everloot link &lt;code&gt;</code> in game.</p>`;
  const froze = frozen.length ? `<p class="warn small">${esc(frozen.join(", "))} frozen: another account linked ${frozen.length === 1 ? "it" : "them"} too.</p>` : "";
  const synced = last ? `<p class="fg2">Last synced ${esc(when(last.syncedAt))}: ${esc(last.synced.join(", "))}${last.categories.length ? ` (${esc(last.categories.map((x) => SYNC_CATEGORY[x] ?? x).join(", "))})` : ""}</p>` : "";
  const line = errors.length ? `<p class="error small" role="status">${esc(errors.join("; "))}</p>` : "";
  return `<section class="panel" id="linked"><h2>Linked characters</h2>
      <p class="fg2">Characters you linked to your everloot.app account with a code from the site. After each upload their titles, raid lockouts and boss kills go to your account's private sync, only for the categories you switched on there.</p>
      ${names}${froze}${synced}${line}
    </section>`;
}

export function characters(v: View): string {
  const { data, charPick, state } = v;
  const c = data.characters;
  const named = c?.characters ?? [];
  const selected = named.find((r) => r.id === charPick) ?? named[0] ?? null;
  const t = selected ? totals(selected.days) : { earned: 0, spent: 0 };
  const net30 = netOf(t), week = selected ? netOf(selected.week) : 0;
  const rows = named.map((r, i) => {
    const w = netOf(r.week), at = r.history[r.history.length - 1]?.at;
    return `<tr class="roster-row${r === selected ? " sel" : ""}" data-char="${i}" tabindex="0" aria-haspopup="dialog">
      <td><b>${esc(r.character)}</b><div class="muted small">${esc(r.realm)}</div></td>
      <td class="num">${gold(r.gold)}${sparkline(r.history)}</td>
      <td class="num ${w >= 0 ? "ok" : "warn"}">${r.week.earned || r.week.spent ? signed(w) : "–"}</td>
      <td class="num muted small">${at ? ago(at) : "–"}</td>
    </tr>`;
  }).join("");
  const hero = selected ? `
    <div class="char-hero">
      <section class="panel river-card">
        <div class="row between"><h2>30-day money river</h2><span class="muted small">+${gold(t.earned)} in · −${gold(t.spent)} out · <b class="${net30 >= 0 ? "ok" : "warn"}">${signed(net30)}</b> net</span></div>
        ${moneyRiver(selected.days)}
        <div class="row between muted small"><span>${selected.days[0]?.date ?? ""}</span><span>${selected.days[selected.days.length - 1]?.date ?? ""}</span></div>
      </section>
      <section class="panel week-card">
        <div class="row between"><h2>This week</h2><span class="muted small">earned above · spent below</span></div>
        ${weekBars(selected.days)}
        <div class="week-foot"><span class="muted small">+${gold(selected.week.earned)}</span><span class="${week >= 0 ? "ok" : "warn"}"><b>${signed(week)}</b> net</span><span class="muted small">−${gold(selected.week.spent)}</span></div>
      </section>
    </div>` : "";
  const prog = keyedRows(c, state?.settings.endpoint ?? "https://everloot.app");
  return `<div class="page char-page">
    <div class="head">
      <div>
        <div class="mono muted small">${selected ? `${esc(selected.realm.toUpperCase())} · from the addon's save file` : "from the addon's save file"}</div>
        <h1 class="${selected ? "char-name" : ""}">${selected ? esc(selected.character) : "Characters"}</h1>
      </div>
      <div class="row"><span class="sub">Stored locally. Asking the assistant may send character details to your selected model provider.</span>${named.length && data.chat?.mode !== "plain search" ? askChip(`How is ${selected?.character ?? "my main"} doing: gold this week and progress?`, "Ask the assistant") : ""}</div>
    </div>
    <p class="fg2">What the addon recorded about your own characters. Gold carries the name; progress rows carry an opaque key the addon derives per character, so they are listed apart. Sharing any of this with the site is a choice you make on the upload page with a verified grant, never here. Gear, talents, professions, achievements and reputations are not recorded: everloot.app reads them from Blizzard's API.</p>
    ${named.length ? `${hero}
    <section class="panel profile" aria-label="${esc(selected?.character ?? "")}: gold and money by category">${selected ? drawerOverview(selected, true) : ""}</section>
    <section class="panel"><div class="row between"><h2>Roster</h2><span class="muted small">click a character, or press Enter, for history and sharing</span></div>
      <div class="tablewrap"><table class="roster"><thead><tr><th>Character</th><th class="num">Gold</th><th class="num">7 days</th><th class="num">Last seen</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>` : c ? `${emptyState(emptyCause("characters", state!), icon("characters"))}${ghostProfile()}` : `<section class="panel"><p class="muted">Loading…</p></section>`}
    <section class="panel" id="keyed" tabindex="-1"><h2>Progress · keyed</h2>
      ${prog ? `<div class="tablewrap"><table><thead><tr><th>Key</th><th>Class</th><th class="num">Titles</th><th class="num">Missing</th><th>Raid lockouts</th><th>On everloot.app</th></tr></thead><tbody>${prog}</tbody></table></div>
        <p class="muted small">Raid lockouts never go in an upload, and Chat does not read them. Private sync sends them only for a character you linked, and everloot.app keeps only the categories you switched on.</p>` : `<p class="muted">${c ? "Nothing yet. The completion tracker is off until <code>/everloot completion on</code> in game." : "Loading…"}</p>`}
    </section>
    ${state ? linkedCharacters(state) : ""}
  </div>
  <div class="drawer-layer" id="drawerLayer" hidden aria-hidden="true">
    <div class="drawer-scrim" data-dwclose></div>
    <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="dwTitle">
      <div class="drawer-head">
        <div class="grow"><div class="mono muted small" id="dwRealm"></div><h2 class="dw-name" id="dwTitle"></h2></div>
        <button type="button" class="drawer-close" data-dwclose aria-label="Close details">×</button>
      </div>
      <div class="drawer-tabs" role="tablist" aria-label="Character details">
        <button type="button" role="tab" data-dwtab="overview" aria-selected="true">Overview</button>
        <button type="button" role="tab" data-dwtab="history" aria-selected="false">History</button>
        <button type="button" role="tab" data-dwtab="share" aria-selected="false">Sharing</button>
      </div>
      <div class="drawer-body" id="dwBody"></div>
    </div>
  </div>`;
}

/** The character's profile: gold now and at its peak, the week, money by category. On the page it skips the pointer to the keyed rows, which sit right under it there. */
export function drawerOverview(c: CharacterRow, onPage = false): string {
  const week = netOf(c.week);
  const catCol = (dir: "in" | "out") => {
    const rows = Object.entries(dir === "in" ? c.earned : c.spent).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return rows.length ? rows.map(([k, v]) => `<div class="cat"><span>${esc(k.replace(/_/g, " "))}${LOCAL_ONLY_CATEGORIES.includes(k) ? ' <span class="muted small">local only</span>' : ""}</span><span class="num">${gold(v)}</span></div>`).join("") : '<p class="muted small">Nothing recorded.</p>';
  };
  return `
    <div class="dw-stats">
      <div class="dw-stat"><span class="k">Gold now</span><b>${gold(c.gold)}</b></div>
      <div class="dw-stat"><span class="k">Peak</span><b>${gold(c.peakGold)}</b></div>
      <div class="dw-stat"><span class="k">7-day net</span><b class="${week >= 0 ? "ok" : "warn"}">${signed(week)}</b></div>
    </div>
    <section class="dw-sec"><div class="row between"><h3>Money by category</h3><span class="muted small">all time in this file</span></div>
      <div class="cat-cols"><div><h4>Earned</h4>${catCol("in")}</div><div><h4>Spent</h4>${catCol("out")}</div></div>
      <p class="muted small">Repairs, trades and mail are read from the local ledger and are never uploaded.</p>
    </section>
    ${onPage ? "" : `<section class="dw-sec"><h3>Progress</h3>
      <p class="muted small">Titles and raid lockouts are keyed by an opaque identifier, never a name, so they stay listed apart from this character. <button type="button" class="link" id="gotoKeyed">Show the keyed rows</button></p>
    </section>`}`;
}

export function drawerHistory(c: CharacterRow): string {
  const first = c.history[0], last = c.history[c.history.length - 1];
  const receipts = c.receipts.length
    ? c.receipts.map((r) => `<div class="rc"><span class="rc-at muted small">${when(r.at)}</span><span class="rc-cat">${esc(r.category.replace(/_/g, " "))}</span><span class="rc-v ${r.direction === "in" ? "ok" : "out"}">${r.direction === "in" ? "+" : "−"}${gold(r.copper)}</span></div>`).join("")
    : '<p class="muted small">No money events in the last thirty days.</p>';
  return `
    <section class="dw-sec"><div class="row between"><h3>Gold this file kept</h3><span class="muted small">${c.history.length} snapshot${c.history.length === 1 ? "" : "s"}</span></div>
      ${goldChart(c.history)}
      ${first && last && c.history.length > 1 ? `<div class="row between muted small"><span>${esc(first.at.slice(0, 10))}</span><span>${esc(last.at.slice(0, 10))}</span></div>` : ""}
      <p class="muted small">Peak ${gold(c.peakGold)}${c.gold !== null && c.peakGold !== null && c.peakGold > c.gold ? `, ${gold(c.peakGold - c.gold)} above today` : ""}.</p>
    </section>
    <section class="dw-sec"><div class="row between"><h3>Receipts</h3><span class="muted small">newest first, up to twelve</span></div>
      <div class="receipts">${receipts}</div>
    </section>`;
}

export function drawerShare(c: CharacterRow): string {
  const activeDays = c.days.filter((d) => d.earned || d.spent).length;
  return `
    <section class="dw-sec"><div class="row between"><h3>Sharing stays on the website</h3><span class="muted small">off by default</span></div>
      <p class="fg2">The automatic uploader keeps <b>${esc(c.character)}</b>'s gold and progress on this computer. On everloot.app/upload you choose, per character, to include gold; a verified grant authorizes it, and the same page revokes the grant or opts the character out at any time.</p>
      <p class="muted small">Progress rows carry an opaque key, never a name, so they cannot be included in that upload. Separately, Chat may send character names, gold and progress to your selected model provider when it uses local tools to answer.</p>
      <button type="button" class="btn btn-primary" data-open="https://everloot.app/upload">Open the upload page</button>
    </section>
    <section class="dw-sec"><h3>What is on this machine</h3>
      <div class="cat"><span>Gold snapshots</span><span class="num">${c.history.length}</span></div>
      <div class="cat"><span>Days with money events, last 30</span><span class="num">${activeDays}</span></div>
    </section>`;
}

export function upload(s: AppState, v: View): string {
  const { data, busy, flash } = v;
  const j = s.engine.jobs.upload;
  const files = data.upload ?? [];
  const rows = files.map((f) => `<tr>
      <td><span class="mono">${esc(account(f.file))}</span>${f.ok ? "" : `<div class="error small">${esc(f.error ?? "unreadable")}</div>`}</td>
      <td>${when(f.writtenAt)}<div class="muted small">${kb(f.bytes)}</div></td>
      <td>${f.addonVersion ? esc(f.addonVersion) : "–"}<div class="muted small">${f.clientBuild ? esc(f.clientBuild) : ""}</div></td>
      <td class="num">${f.records}</td><td class="num">${f.confirmed}</td>
      <td><div class="chips">${f.kinds.slice(0, 12).map((k) => `<span class="chip"><b>${k.count}</b> ${esc(k.kind)}</span>`).join("")}${f.kinds.length > 12 ? `<span class="chip">+${f.kinds.length - 12} more</span>` : ""}</div></td>
    </tr>`).join("");
  const backups = (data.backups ?? []).map((b) => `<tr><td><span class="mono">${esc(b.account)}</span></td><td>${when(b.at)}</td><td class="num">${kb(b.bytes)}</td><td><button type="button" class="btn small" data-restore="${esc(b.file)}" ${busy ? "disabled" : ""}>${busy === b.file ? "Restoring…" : "Restore"}</button></td></tr>`).join("");
  return `<div class="page">
    <div class="head"><h1>Upload</h1><div class="row">${jobSwitch("upload", s)}${runBtn("upload", s)}</div></div>
    <p class="fg2">After every logout or <code>/reload</code> the game rewrites <code>Everloot.lua</code>; once the write settles, the events the site has not confirmed are sent. Named data (guild, gear, gold, collection) and your installed addon list stay here.</p>
    ${workingStrip("upload", s, statusText(j), lastLineOf("upload", s))}
    <section class="panel"><h2>Account files</h2>
      ${files.length ? `<div class="tablewrap"><table><thead><tr><th>Account</th><th>Written</th><th>Addon</th><th class="num">Records</th><th class="num">Confirmed</th><th>What it holds</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState(emptyCause("upload", s), icon("upload"))}
      <p class="muted small">Records are what the addon has on disk; confirmed is how many of them the site has accepted from this install. The site states a fact once three installs agree.</p>
    </section>
    <section class="panel"><div class="row between"><h2>Backups</h2><button type="button" class="btn" id="openBackups" ${(data.backups ?? []).length ? "" : "disabled"}>Open folder</button></div>
      ${backups.length ? `<div class="tablewrap"><table><thead><tr><th>Account</th><th>Taken</th><th class="num">Size</th><th></th></tr></thead><tbody>${backups}</tbody></table></div>` : emptyState({ cause: "No backup yet", step: "One is kept after each upload" }, icon("upload"))}
      <p class="muted small">A copy of <code>Everloot.lua</code> as it was uploaded, the newest ten per account. Restore with the game closed; the file you replace is backed up first.</p>
      ${flash ? `<p class="${flash.startsWith("!") ? "error" : "ok"} small">${esc(flash.replace(/^!/, ""))}</p>` : ""}
    </section>
  </div>`;
}

export function market(s: AppState, v: View): string {
  const { data } = v;
  const j = s.engine.jobs.prices;
  const m = data.market;
  const followed = new Set((m?.followed ?? s.settings.market.realms).map((r) => r.toLowerCase()));
  const own = new Set((m?.own ?? []).map((r) => r.toLowerCase()));
  const known = m?.known ?? [];
  const checks = known.length
    ? `<div class="checks">${known.map((r) => `<label class="check"><input type="checkbox" data-realm="${esc(r)}" ${followed.has(r.toLowerCase()) ? "checked" : ""} ${own.has(r.toLowerCase()) ? "disabled checked" : ""}> ${esc(r)}${own.has(r.toLowerCase()) ? ' <span class="muted small">(your scans)</span>' : ""}</label>`).join("")}</div>`
    : `<p class="muted">${m?.error ? esc(m.error) : m ? "The site has no public values yet. A realm appears once three reporters scanned it." : "Loading…"}</p>`;
  const extra = [...followed].filter((r) => !known.some((k) => k.toLowerCase() === r));
  const last = m?.last ?? [];
  const stale = (at: string | null) => !at || Date.now() - new Date(at).getTime() > 24 * 3600 * 1000;
  const scans = (m?.scans ?? []).map((sc) => `<tr><td>${esc(sc.realm)}</td><td>${sc.at ? ago(sc.at) : "unknown"}</td><td class="${stale(sc.at) ? "warn" : "ok"}">${stale(sc.at) ? "scan again next time you are at the auction house" : "fresh"}</td></tr>`).join("");
  // The panel above already shows the no-folder, no-file and paused causes; this one only adds what is its own.
  const w = emptyCause("market", s, { written: false });
  const marketWritten = w.action?.run === "prices" || w.cause === "Market prices are off"
    ? w
    : { cause: "Nothing written into the game yet", step: "Prices are written at the next refresh; /reload in game to see them" };
  return `<div class="page">
    <div class="head"><h1>Market</h1><div class="row">${jobSwitch("prices", s)}${runBtn("prices", s, "Refresh now")}</div></div>
    ${workingStrip("prices", s, statusText(j), lastLineOf("prices", s))}
    <section class="panel"><div class="row between"><h2>Look up a price</h2>${ext(websiteUrl(s.settings.endpoint, "/tools/auctions"), "Auction prices on everloot.app ↗")}</div>
      <form id="priceForm" class="row" autocomplete="off"><input type="text" id="priceItem" name="priceItem" class="grow" aria-label="Item id or link" placeholder="Item id, or an item link pasted from game chat" maxlength="500"><button type="submit" class="btn">Look up</button></form>
      ${priceResult(s, v.priceLookup)}
      <p class="muted small">From the prices file in your game, the same numbers your tooltips show. In game, <code>/everloot price [item]</code> prints them in chat, anywhere in the world. Charts, every realm and item names are on the site.</p>
    </section>
    <p class="fg2">Community market values written into <code>EverlootPrices</code> so item tooltips show them after <code>/reload</code>. Realms from your own auction scans are always included; pick more below, the way TSM lets you pick realms, except the values are Everloot's own: a day counts once three reporters scanned it. Refreshed after each upload and every hour.</p>
    ${realmSuggestion(m)}
    <section class="panel"><div class="row between"><h2>Realms to carry into the game</h2><span class="muted small">${m?.dataAsOf ? `site data as of ${when(m.dataAsOf)}` : ""}</span></div>
      ${checks}
      <div class="row"><input type="text" id="realmAdd" class="grow" placeholder="Add a realm by name" maxlength="60"><button type="button" class="btn" id="realmAddBtn">Follow</button></div>
      ${extra.length ? `<div class="chips">${extra.map((r) => `<span class="chip">${esc(r)} <button type="button" class="link" data-unfollow="${esc(r)}">remove</button></span>`).join("")}</div>` : ""}
      <p class="muted small">At most 20 realms in one prices file; your scans come first. The full tables and 60-day charts are on the Auction prices tool in the sidebar.</p>
    </section>
    <section class="panel"><h2>Your scans</h2>
      ${scans ? `<div class="tablewrap"><table><thead><tr><th>Realm</th><th>Last full scan</th><th>Status</th></tr></thead><tbody>${scans}</tbody></table></div>` : emptyState(emptyCause("market", s), icon("market"))}
      <p class="muted small">Every scan you upload is one of the three reporters a day needs before a price is published. A realm is only as fresh as its last scans.</p>
    </section>
    <section class="panel"><div class="row between"><h2>Written into the game</h2><span class="muted small">${j.at ? when(j.at) : ""}</span></div>
      ${j.state === "error" ? `<p class="error">${esc(j.message)}</p>` : ""}
      ${last.length ? `<div class="tablewrap"><table><thead><tr><th>Realm</th><th>House</th><th class="num">Items</th><th>Data as of</th><th>Why</th></tr></thead><tbody>${last.map((r) => `<tr><td>${esc(r.realm)}</td><td>${esc(r.house)}</td><td class="num">${r.items}</td><td>${r.dataAsOf ? when(r.dataAsOf) : "–"}</td><td class="muted">${r.source === "scan" ? "your scans" : "followed"}</td></tr>`).join("")}</tbody></table></div>`
        : m?.inGame?.length ? `<div class="tablewrap"><table><thead><tr><th>Realm</th><th>House</th><th class="num">Items</th><th>Data as of</th></tr></thead><tbody>${m.inGame.map((r) => `<tr><td>${esc(r.realm)}</td><td>${houseCell(r.house)}</td><td class="num">${r.items}</td><td>${r.dataAsOf ? when(r.dataAsOf) : "–"}</td></tr>`).join("")}</tbody></table></div><p class="muted small">The file in the game now; not refreshed yet this session.</p>`
        : emptyState(marketWritten, icon("market"))}
    </section>
  </div>`;
}

/** The Market page's offer to follow the player's character realms. Nothing is fetched for them before Follow. */
function realmSuggestion(m: MarketInfo | undefined): string {
  if (!m?.suggested.length) return "";
  return `<p class="callout fg2">${icon("market")}<span>Follow your characters' realms: <b>${esc(m.suggested.join(", "))}</b>. Their community prices then go into your tooltips like any realm you follow; nothing is asked of everloot.app for them until you press Follow. <button type="button" class="btn btn-primary" data-suggestion="follow">Follow</button> <button type="button" class="link" data-suggestion="dismiss">No thanks</button></span></p>`;
}

/** The Overview's short version, only while the game has no prices at all. */
function suggestionLine(m: MarketInfo | undefined): string {
  if (!m?.suggested.length || m.last.length || m.inGame?.length) return "";
  return ` · no prices yet; follow your characters' realms (${esc(m.suggested.join(", "))}) <button type="button" class="link" data-suggestion="follow">Follow</button>`;
}

/** A price's auction house; an older file's realm-only block says its values may mix both factions. */
function houseCell(house: string | null): string {
  return house ? esc(house) : '<span class="muted">older file, both factions</span>';
}

/** The last lookup on the Market page: each realm and house's row from the game's prices file, and the site's full history. */
function priceResult(s: AppState, priceLookup: PriceLookup | null): string {
  const p = priceLookup;
  if (!p) return "";
  if (!p.rows.length) return `<p class="muted">${esc(p.note ?? "Nothing found.")}</p>`;
  const site = (realm: string) => websiteUrl(s.settings.endpoint, `/tools/auctions?realm=${encodeURIComponent(realm)}&item=${p.itemId}`);
  return `<div class="tablewrap"><table><thead><tr><th>Realm</th><th>House</th><th class="num">Market</th><th class="num">Min</th><th class="num">Historical</th><th class="num">Up</th><th class="num">Reporters</th><th>Day</th><th></th></tr></thead><tbody>${p.rows.map((r) =>
    `<tr><td>${esc(r.realm)}</td><td>${houseCell(r.house)}</td><td class="num">${r.market === null ? '<span class="muted">unrecorded</span>' : gold(r.market)}</td><td class="num">${gold(r.min)}</td><td class="num">${gold(r.historical)}</td><td class="num">${r.quantity}</td><td class="num">${r.reporters}</td><td>${esc(r.day)}</td><td>${ext(site(r.realm), "history ↗")}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted small">Item ${p.itemId}. Market weighs the last 14 public days, historical is the 60-day median, min is the lowest buyout per unit. Each auction house is its own market; the game shows the one your character uses.</p>`;
}

export function ask(s: AppState, v: View): string {
  const { data, flash, advancedOpen } = v;
  const a = data.ask;
  const st = s.settings.ask;
  const pending = (a?.pending ?? []).flatMap((p) => p.asks.map((q) => ({ ...q, account: account(p.file) })));
  // A saved token file or a private address starts the disclosure open; once the player toggles it their choice holds.
  const usualUrl = st.mcpUrl === `${s.settings.endpoint}/mcp` || st.mcpUrl === "https://everloot.app/mcp";
  const configured = Boolean(st.tokenFile) || !usualUrl;
  return `<div class="page">
    <div class="head"><h1>Ask</h1><div class="row">${jobSwitch("ask", s)}${runBtn("ask", s, "Answer now")}</div></div>
    ${workingStrip("ask", s, statusText(s.engine.jobs.ask), lastLineOf("ask", s))}
    ${flash ? `<p role="status" class="${flash.startsWith("!") ? "error" : "ok"} small">${esc(flash.replace(/^!/, ""))}</p>` : ""}
    <p class="fg2">Ask in game with <code>/ask</code>, then <code>/reload</code> to save your question. Keep this app running while it answers, then <code>/reload</code> again to read the answer. Answers arrive through saved files, not live.</p>
    <p class="fg2 small">Item prices come from recorded scans, not live listings. Price and search results include their source. The time beside an answer is when it was written; price answers also show the observation day.</p>
    ${assistant(data.chat, "ask", v)}
    <details id="askAdvanced" class="panel adv" ${(advancedOpen ?? configured) ? "open" : ""}>
      <summary>Advanced: private MCP server${configured ? ' <span class="muted">· private configuration saved</span>' : ""}</summary>
      <form id="askForm" autocomplete="off">
        <div class="grid2">
          <div class="field"><label for="mcpUrl">Private MCP server <span class="hint">used only with a token file</span></label><input type="url" id="mcpUrl" name="mcpUrl" value="${esc(st.mcpUrl)}"></div>
          <div class="field"><label for="tokenFile">Token file <span class="hint">for a private Everloot server; leave empty to use the public one. The token is never typed here</span></label>
            <div class="row"><input class="grow" type="text" id="tokenFile" name="tokenFile" value="${esc(st.tokenFile ?? "")}"><button type="button" class="btn" id="pickToken">Choose…</button></div></div>
        </div>
        ${!usualUrl && !st.tokenFile ? '<p class="muted small">This address is saved but not used: with no token file, /ask and Chat go to the public server.</p>' : ""}
        <div class="row"><button type="submit" class="btn btn-primary">Save</button><span class="muted" id="saved"></span></div>
      </form>
      <p class="muted small">Models are in Assistant setup above; <code>config.json</code> in the data folder is only for what that form cannot say (any OpenAI-compatible server, keys from a file). <button type="button" class="link" id="openConfig">Open config.json</button></p>
    </details>
    <section class="panel"><h2>Pending in game</h2>
      ${pending.length ? `<div class="list">${pending.map((q) => `<div class="item"><div class="t">${esc(q.question)}</div><div class="muted small">${esc(q.account)} · ${when(q.askedAt)}</div></div>`).join("")}</div>` : emptyState(emptyCause("ask", s), icon("ask"))}
    </section>
    <section class="panel"><h2>Recent answers</h2>
      ${a?.answers.length ? `<div class="list">${a.answers.slice(0, 20).map((x) => `<div class="item"><div>${esc(x.answer)}</div><div class="muted small">${esc(x.source)} · answered ${when(x.answeredAt)}</div></div>`).join("")}</div>` : emptyState({ cause: "Nothing answered yet", step: "Answers to /ask questions appear here once written" }, icon("ask"))}
    </section>
  </div>`;
}

export function addon(s: AppState, v: View): string {
  const { data, busy, flash } = v;
  const a = data.addon;
  const newer = Boolean(a?.newer);
  // Up to date means no button in the main place: a second install changes nothing, so it moves to a small repair link.
  const upToDate = Boolean(a?.installed && a.latest && !newer);
  return `<div class="page">
    <div class="head"><h1>Addon</h1><span class="sub">${a?.addonsDir ? `<span class="mono">${esc(a.addonsDir)}</span>` : "no game folder"}</span></div>
    <div class="stats">
      <div class="stat"><div class="k">Installed</div><div class="v">${a ? (a.installed ? esc(a.installed) : '<span class="warn">not installed</span>') : "…"}</div></div>
      <div class="stat"><div class="k">Latest release</div><div class="v">${a ? (a.latest ? esc(a.latest.version) : "–") : "…"}</div><div class="s">${a?.error ? `<span class="error">${esc(a.error)}</span>` : a?.latest ? ext(a.latest.url, "release notes") : ""}</div></div>
      <div class="stat"><div class="k">Prices file</div><div class="v">${a?.slots.prices ? '<span class="ok">present</span>' : "none"}</div><div class="s">EverlootPrices</div></div>
      <div class="stat"><div class="k">Answers file</div><div class="v">${a?.slots.answers ? '<span class="ok">present</span>' : "none"}</div><div class="s">EverlootAnswers</div></div>
      <div class="stat"><div class="k">Builds file</div><div class="v">${a?.slots.builds ? '<span class="ok">present</span>' : "none"}</div><div class="s">EverlootBuilds</div></div>
    </div>
    <section class="panel">
      ${!s.settings.gameFolder ? `${emptyState(emptyCause("addon", s), icon("addon"))}<p class="muted small">${ext("https://everloot.app/upload", "manual install steps")}</p>` : `
      ${upToDate
        ? `<h2>Up to date</h2><p class="fg2">${a!.installed === a!.latest!.version ? `You have the newest Everloot addon, ${esc(a!.installed!)}.` : `You have ${esc(a!.installed!)}, newer than the latest release ${esc(a!.latest!.version)}.`} Nothing to do.</p>`
        : `<h2>${a?.installed ? "Update" : "Install"}</h2><p class="fg2">Downloads <code>Everloot-${esc(a?.latest?.version ?? "x.y.z")}.zip</code> from the site, checks it against the checksum published with the GitHub release, and replaces <code>Interface/AddOns/Everloot</code> in one swap. Close the game first, or <code>/reload</code> after.</p>`}
      <div class="row">
        ${upToDate ? "" : `<button type="button" class="btn btn-primary" id="installAddon" ${a?.latest && s.settings.gameFolder && !busy ? "" : "disabled"}>${busy === "install" ? "Installing…" : a?.installed ? `Update to ${esc(a.latest?.version ?? "")}` : "Install"}</button>`}
        ${ext("https://everloot.app/upload", "manual install steps")}
        ${a?.addonsDir ? '<button type="button" class="link" id="openAddons">open the AddOns folder</button>' : ""}
        <span class="${flash.startsWith("!") ? "error" : "ok"} small" role="status">${esc(flash.replace(/^!/, ""))}</span>
      </div>
      ${upToDate ? `<p class="muted small">Addon acting up? <button type="button" class="link" id="installAddon" ${s.settings.gameFolder && !busy ? "" : "disabled"}>${busy === "install" ? "Reinstalling…" : a!.installed === a!.latest!.version ? `Reinstall ${esc(a!.installed!)}` : `Install release ${esc(a!.latest!.version)}`}</button> puts a clean copy of the release back${a!.installed === a!.latest!.version ? "" : " in place of this build"}. Only needed when files are broken or missing.</p>` : ""}`}
    </section>
    ${savedBuilds(s)}
    <section class="panel"><h2>In game</h2>
      <ul class="plain fg2">
        <li><code>/everloot status</code> shows what the addon is recording; <code>/everloot addons on</code> shares your addon list on the upload page only.</li>
        <li><code>/everloot plan</code> lists your saved builds after a sync; <code>/everloot plan 2</code> loads the second one.</li>
        <li><code>/ask &lt;question&gt;</code> queues a question; this app answers it after the game writes the file.</li>
        <li>The addon only reads the game's own API and writes its own save file. It never acts for you.</li>
      </ul>
    </section>
  </div>`;
}

/** The saved-builds sync: the builds saved on everloot.app, written into EverlootBuilds for /everloot plan. */
function savedBuilds(s: AppState): string {
  const b = s.builds;
  const keys = websiteUrl(s.settings.endpoint, "/docs/api/keys#your-keys");
  const line = !s.account.signedIn
    ? `<p class="muted small">Sign in under <button type="button" class="link" data-account>Settings &gt; Account</button> with a key that has the "Read my saved builds" permission.</p>`
    : b.state === "forbidden"
      ? `<p class="error small" role="status">This key can't read your saved builds. ${ext(keys, "Make a key with \"Read my saved builds\" on everloot.app ↗")}</p>`
      : b.state === "unavailable" ? `<p class="muted small" role="status">Saved builds aren't available yet.</p>`
        : b.state === "error" ? `<p class="error small" role="status">${esc(b.message)}</p>`
          : b.state === "running" ? `<p class="muted small" role="status">Syncing…</p>` : "";
  const last = b.syncedAt ? `<p class="fg2">Last synced ${esc(when(b.syncedAt))}${b.builds !== null ? ` (${b.builds} build${b.builds === 1 ? "" : "s"})` : ""} · <code>/reload</code> in game to see them</p>` : "";
  const can = s.account.signedIn && s.settings.gameFolder && b.state !== "running";
  return `<section class="panel"><h2>Saved builds</h2>
      <p class="fg2">The talent builds you saved on everloot.app, written into <code>EverlootBuilds</code> so <code>/everloot plan</code> lists them in game. Synced after you sign in and every 15 minutes; nothing goes back.</p>
      ${last}${line}
      <div class="row"><button type="button" class="btn" id="buildsSync" ${can ? "" : "disabled"}>${b.state === "running" ? "Syncing…" : "Sync builds"}</button></div>
    </section>`;
}

export function changes(v: View): string {
  const { data, state } = v;
  const list = data.changes;
  return `<div class="page">
    <div class="head"><h1>Changes</h1><span class="sub">Blizzard posts, hotfixes and builds, newest first · ${ext("https://everloot.app/changes", "everloot.app/changes")}</span></div>
    <section class="panel"><div class="list">${list ? (list.length ? list.map((c) => `<div class="item"><div class="t">${c.link ? ext(c.link, c.title) : esc(c.title)}</div>${c.summary ? `<div class="fg2 small">${esc(c.summary)}</div>` : ""}<div class="muted small">${when(c.date)}</div></div>`).join("") : emptyState(emptyCause("changes", state!), icon("changes"))) : data.changesError ? emptyState(emptyCause("changes", state!, { error: data.changesError }), icon("changes")) : '<p class="muted">Loading…</p>'}</div></section>
  </div>`;
}

export function log(s: AppState, v: View): string {
  const { flash } = v;
  return `<div class="page">
    <div class="head"><h1>Log</h1><div class="row">${whyFailed(s).map((q) => askChip(q, "Ask the assistant why it failed")).join("")}<button type="button" class="btn" id="copyDiag">Copy diagnostics</button><button type="button" class="btn" id="pause">${s.engine.paused ? "Resume" : "Pause"}</button></div></div>
    ${flash ? `<p class="${flash.startsWith("!") ? "error" : "ok"} small">${esc(flash.replace(/^!/, ""))}</p>` : ""}
    ${s.engine.log.length ? `<section class="panel"><div class="log">${logLines(s, 200)}</div></section>` : emptyState(emptyCause("log", s), icon("log"))}
    <p class="muted small">Copy diagnostics puts the version, your settings (where the token file is, never the token), the files watched, each job's last state and the last hundred lines on the clipboard, with your user folder hidden, for a bug report.</p>
  </div>`;
}

const JOB_ROWS: { job: Job; label: string; what: string }[] = [
  { job: "upload", label: "Upload", what: "Send what the addon recorded after every logout or /reload" },
  { job: "prices", label: "Market prices", what: "Keep community prices in your item tooltips, refreshed hourly" },
  { job: "ask", label: "In-game /ask", what: "Answer /ask questions from the game with the model below" },
];

/** The everloot.app account: a free key made after Battle.net sign-in on /docs/api/keys, pasted here. */
function accountPanel(s: AppState, connecting: boolean): string {
  const keys = websiteUrl(s.settings.endpoint, "/docs/api/keys#your-keys");
  const what = "Chat and the in-game /ask send it to everloot.app's public server, which then counts their requests against your account instead of this internet address, with a higher limit. A key with the \"Read my saved builds\" permission also brings your saved talent builds into the game. Uploads never carry it.";
  return s.account.signedIn
    ? `<section class="panel set-sec" id="account" tabindex="-1"><div class="set-lead"><h2>Account</h2></div><div class="set-body">
      <p class="fg2">Signed in to everloot.app with the key ending <b class="mono">…${esc(s.account.hint ?? "")}</b>.</p>
      <p class="muted small">${what}</p>
      <div class="row"><button type="button" class="btn" data-open="${esc(keys)}">Manage keys on everloot.app ↗</button><button type="button" class="btn" id="accountSignOut">Sign out</button></div>
    </div></section>`
    : `<section class="panel set-sec" id="account" tabindex="-1"><div class="set-lead"><h2>Account</h2></div><div class="set-body">
      <p class="fg2">Sign in through your browser: everloot.app opens, you sign in with Battle.net and press Connect, and the app gets its own key. It never sees your password.</p>
      <div class="row">${connecting ? `<button type="button" class="btn" id="connect">Open the browser again</button><button type="button" class="btn" id="connectCancel">Cancel</button><span class="muted small">Waiting for the browser…</span>` : `<button type="button" class="btn btn-primary" id="connect">Sign in with everloot.app</button>`}</div>
      <p class="muted small">${what} The key is kept in a file in your data folder and goes only to everloot.app.</p>
      <p class="muted small">Or make a key on ${ext(keys, "everloot.app")} and paste it:</p>
      <form id="accountForm" class="row" autocomplete="off"><input class="grow mono" type="password" name="key" placeholder="evl_…" aria-label="Everloot key" spellcheck="false"><button type="submit" class="btn btn-primary">Sign in</button></form>
    </div></section>`;
}

/** Everything the app can be set to, on one page: what runs, the Assistant, the game folder, startup, the app itself. */
export function settings(s: AppState, v: View): string {
  const { data, flash } = v;
  const st = s.settings;
  const c = data.chat;
  const jobs = JOB_ROWS.map((r) => `<div class="set-row"><div class="grow"><b>${r.label}</b><div class="muted small">${esc(r.what)} · <button type="button" class="link" data-page="${r.job}">details</button></div></div>${jobSwitch(r.job, s)}</div>`).join("");
  return `<div class="page settings">
    <div class="head"><h1>Settings</h1></div>
    ${flash ? `<p role="status" class="${flash.startsWith("!") ? "error" : "ok"} small">${esc(flash.replace(/^!/, ""))}</p>` : ""}
    ${accountPanel(s, v.connecting)}
    <section class="panel set-sec"><div class="set-lead"><h2>What runs</h2></div><div class="set-body">${jobs}</div></section>
    ${assistant(c, "settings", v)}
    <form id="settings" autocomplete="off">
      <section class="panel set-sec"><div class="set-lead"><h2>Game</h2></div><div class="set-body">
        <div class="field"><label for="gameFolder">Game folder <span class="hint">the product folder that holds <code>WTF</code>: for WoW: Forever, <code>World of Warcraft\\_forever_</code></span></label>
          ${foreverCallout(s)}
          <div class="row"><input class="grow" type="text" id="gameFolder" name="gameFolder" value="${esc(st.gameFolder ?? "")}"><button type="button" class="btn" id="browse">Browse…</button></div></div>
        <label class="switch"><input type="checkbox" name="autoUpdateAddon" ${st.autoUpdateAddon ? "checked" : ""}> Keep the addon up to date</label>
        <p class="muted small">New versions of the Everloot addon install on their own and load at the next <code>/reload</code> or login.</p>
      </div></section>
      <section class="panel set-sec"><div class="set-lead"><h2>Startup</h2></div><div class="set-body">
        ${s.platform === "linux" ? "" : `<label class="switch"><input type="checkbox" name="launchAtLogin" ${st.launchAtLogin ? "checked" : ""}> Start when I sign in</label>`}
        <label class="switch"><input type="checkbox" name="startInTray" ${st.startInTray ? "checked" : ""}> Start in the tray without a window</label>
      </div></section>
      <section class="panel set-sec"><div class="set-lead"><h2>Census</h2></div><div class="set-body">
        <label class="switch"><input type="checkbox" name="census" ${st.census ? "checked" : ""}> Send census counts with the uploads</label>
        <p class="muted small">The race, class, level and faction of your characters and of players the addon sees. Never names, guilds, gear or places; the site shows only totals. Off keeps them in <code>Everloot.lua</code>; <code>/everloot census off</code> in the game stops recording and deletes them.</p>
      </div></section>
      <section class="panel set-sec"><div class="set-lead"><h2>Player pages</h2></div><div class="set-body">
        <label class="switch"><input type="checkbox" name="players" ${st.players ? "checked" : ""}> Send the player pages with the uploads</label>
        <p class="muted small">The name, realm, race, class, level and guild of the players the addon saw, so a page can be found by name. On in a new install; an install from before keeps its choice. Off keeps them in <code>Everloot.lua</code>; <code>/everloot players off</code> in the game stops recording and deletes them, and anyone can hide a character at everloot.app/players/opt-out.</p>
      </div></section>
      ${s.runRecords ? `<section class="panel set-sec"><div class="set-lead"><h2>Boss pulls</h2></div><div class="set-body">
        <p class="muted small">After each boss pull, the names, realms, classes and roles of your group and the damage meter's totals. They go with the uploads; the site keeps them privately for a year, shows them nowhere and deletes any character someone hides. <code>/everloot pulls off</code> in the game stops recording and deletes them.</p>
      </div></section>` : ""}
      <details class="panel set-sec"><summary><h2>Advanced</h2></summary>
        <div class="field"><label for="endpoint">Site <span class="hint">change only to test against another deployment</span></label><input type="url" id="endpoint" name="endpoint" value="${esc(st.endpoint)}"></div>
      </details>
      <div class="row set-save"><button type="submit" class="btn btn-primary">Save</button><span class="muted" id="saved"></span></div>
    </form>
    <section class="panel set-sec"><div class="set-lead"><h2>This app</h2></div><div class="set-body">
      <p class="fg2">Everloot ${esc(s.version)} · AGPL-3.0-only · ${ext("https://github.com/Everloot/everloot/tree/main/desktop", "source")} · ${ext("https://discord.gg/9CKsbHTRu3", "Discord")}</p>
      <div class="row"><button type="button" class="btn" id="updates">Check for updates</button></div>
    </div></section>
    ${dataPanel(s, data)}
  </div>`;
}

const DATA_PARTS: { part: DataPart; label: string; what: string }[] = [
  { part: "backups", label: "Backups", what: "a copy of each account's Everloot.lua before an upload; the oldest go first" },
  { part: "updates", label: "Update downloads", what: "deleted once the update is installed" },
  { part: "chat", label: "Chat history", what: "Chat's conversation and the in-game /ask answers; older messages are dropped" },
  { part: "uploads", label: "Upload history", what: "which events the site has confirmed, for the rows still in Everloot.lua" },
  { part: "settings", label: "Settings and keys", what: "these settings, your everloot.app key and the model keys you added" },
  { part: "other", label: "Other", what: "files from an interrupted write, or kept from a damaged one" },
];

/** What the data folder holds and what leaves this computer, with the button that empties the folder. */
function dataPanel(s: AppState, data: PageData): string {
  const u = data.usage;
  const rows = DATA_PARTS.map((r) => `<tr><td><b>${r.label}</b><div class="muted small">${esc(r.what)}</div></td><td class="num">${u ? kb(u.parts[r.part]) : "…"}</td></tr>`).join("");
  const st = s.settings;
  return `<section class="panel set-sec" id="data" tabindex="-1"><div class="set-lead"><h2>Data on this computer</h2></div><div class="set-body">
      <p class="fg2">The data folder holds <b>${u ? kb(u.total) : "…"}</b>: <span class="mono">${esc(s.dataFolder)}</span> <button type="button" class="link" id="openData">Open data folder</button></p>
      <div class="tablewrap"><table><tbody>${rows}</tbody></table></div>
      <h3>What goes to everloot.app</h3>
      <ul class="plain fg2 small">
        <li>Anonymous observations from <code>Everloot.lua</code>: drops, vendors, recipes, spawns, auction scans. No character or account name.</li>
        <li>${st.census ? "Census counts: the race, class, level and faction of your characters and of players the addon sees. Never names, guilds, gear or places; the site shows only totals." : "Census counts are off; they stay in <code>Everloot.lua</code>."}</li>
        ${st.players ? "<li>Player pages: the name, realm, race, class, level and guild of the players the addon saw.</li>" : ""}
        <li>Your everloot.app key, when you are signed in, goes with Chat and the in-game <code>/ask</code>. Uploads never carry it.</li>
      </ul>
      <h3>What stays here</h3>
      <ul class="plain fg2 small">
        <li>Guild, gold, collection and your installed addon list.</li>
        <li>Your raid lockouts and boss kills. No upload sends them.</li>
        <li>Your settings, chat, upload history and backups, in the data folder.</li>
      </ul>
      <p class="small fg2">If you configure a model for Chat, it receives your questions and any local character details it uses to answer. Rules: ${ext("https://everloot.app/privacy", "everloot.app/privacy")}</p>
      <p class="muted small">Uninstalling keeps this folder, with your keys, chat and save backups in it. Delete my local data empties it; the command-line tool uses the same folder.</p>
      <div class="row"><button type="button" class="btn btn-danger" id="wipeOpen">Delete my local data…</button></div>
    </div></section>`;
}

/** Shown once on the Overview when the data folder passes DATA_NOTICE_BYTES (main/data-folder.ts); dismissing it is kept in settings. */
function dataNotice(data: PageData): string {
  const u = data.usage;
  if (!u?.notice) return "";
  return `<p class="callout fg2">${icon("alert")}<span>The app's data folder holds ${kb(u.total)}. The largest part is ${esc(biggestPart(u))}. <button type="button" class="link" id="dataNoticeOpen">See what is in it</button> · <button type="button" class="link" id="dataNoticeDismiss">Dismiss</button></span></p>`;
}

const biggestPart = (u: DataUsage) => {
  const top = DATA_PARTS.reduce((a, b) => (u.parts[b.part] > u.parts[a.part] ? b : a));
  return top.label.toLowerCase();
};

/** The download fills its row as it goes; the width is set from data-w after render (the CSP allows no inline styles). */
function downloadBar(v: string, percent: number): string {
  return `<div class="dl-bar" role="progressbar" aria-label="Downloading ${v}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span class="dl-fill" data-w="${percent}"></span><span class="dl-text">Downloading ${v}</span><span class="dl-pct">${percent}%</span></div>`;
}

/** Restart runs the update once it is downloaded and checked. */
export const updateReady = (s: AppState) => Boolean(s.update?.newer && s.update.installable && s.updateProgress.stage === "ready");

/**
 * The one update control, beside Settings. While an update is out, the arrow opens what the new version changed and
 * its download; a ring fills around it while it downloads; once the download is checked, it turns into a restart,
 * which opens the restart dialog. It keeps one id, so a re-render keeps the focus on it.
 */
export function updateButton(s: AppState, updateOpen: boolean): string {
  const up = s.update?.newer ? s.update : null;
  if (!up) return "";
  const p = s.updateProgress;
  const v = esc(up.latest ?? "");
  if (updateReady(s)) return `<button type="button" class="update-btn ready" id="updateBtn" aria-haspopup="dialog" aria-label="Restart to install ${v}" title="Restart to install ${v}">${RESTART}</button>`;
  const downloading = up.installable && p.stage === "downloading";
  const label = downloading ? `Downloading ${v}, ${p.percent}%` : p.stage === "failed" ? `The update to ${v} failed. Open it to try again` : `What's new in ${v}`;
  // The ring is drawn with SVG attributes, not inline styles, which the CSP refuses.
  const ring = downloading ? `<svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="ring-track" cx="18" cy="18" r="16" pathLength="100"/><circle class="ring-fill" cx="18" cy="18" r="16" pathLength="100" stroke-dasharray="${p.percent} 100"/></svg>` : "";
  const cls = downloading ? " downloading" : p.stage === "failed" ? " failed" : "";
  return `<button type="button" class="update-btn${cls}" id="updateBtn" aria-expanded="${updateOpen}" aria-controls="updatePop" aria-label="${label}" title="${label}">${ring}${ARROW}</button>`;
}

/** The Overview says so too, with the same one-click update. */
function updateCallout(s: AppState): string {
  const up = s.update?.newer ? s.update : null;
  if (!up || !(up.installable || up.url)) return "";
  const p = s.updateProgress;
  const action = !up.installable ? `${ext(up.downloadUrl ?? up.url!, "Download it")} and install over this one`
    : p.stage === "ready" ? `<button type="button" class="link" id="updateRestartCallout">Restart to update</button>`
      : p.stage === "downloading" ? `Downloading, ${p.percent}%`
        : `<button type="button" class="link" id="updateNowCallout">Update now</button>`;
  return `<p class="callout fg2">${icon("upload")}<span>Everloot ${esc(up.latest ?? "")} is out; you run ${esc(s.version)}. ${action}; your settings stay.</span></p>`;
}

const ARROW = `<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const RESTART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.6h-4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The Everloot mark, as the sidebar draws it. */
const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" class="mark-bg"/><path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/></svg>`;

const NOTES_SHOWN = 8;

/** The update popover: the new version, what its release lists as changed, and this system's download. */
export function updatePopover(u: NonNullable<AppState["update"]>, p: AppState["updateProgress"]): string {
  const notes = u.notes.slice(0, NOTES_SHOWN).map((n) => `<li><span class="note" title="${esc(n.text)}">${esc(n.text)}${n.author ? ` <span class="muted">by @${esc(n.author)}${n.pr ? ` in #${n.pr}` : ""}</span>` : ""}</span></li>`).join("");
  const more = u.notes.length > NOTES_SHOWN ? `${u.notes.length - NOTES_SHOWN} more changes on GitHub ↗` : "Release notes on GitHub ↗";
  const title = !u.installable ? "Update available" : p.stage === "ready" ? "Update ready to install" : p.stage === "downloading" ? "Downloading the update" : "Update available";
  return `<div class="pop-head"><h2 id="updTitle">${title}</h2><div class="muted small">${esc(u.latest ?? "")} · you run ${esc(u.current)}${u.publishedAt ? ` · released ${when(u.publishedAt)}` : ""}</div></div>
    <div class="pop-body"><h3>What's changed</h3>${notes ? `<ul>${notes}</ul>` : '<p class="muted small">This release lists no changes.</p>'}${u.url ? ext(u.url, more) : ""}</div>
    ${p.stage === "failed" ? `<p class="error small">The update failed: ${esc(p.error ?? "")}</p>` : ""}
    <div class="pop-foot">${updatePrimary(u, p)}<button type="button" class="btn" id="updateLater">Later</button></div>
    <p class="muted small">${u.installable
      ? "The update is checked against the release's published checksum before it installs. Your settings and data folder stay."
      : "Run the download to update; your settings and data folder stay. The app is not code-signed yet, so Windows asks once (More info, Run anyway)."}</p>`;
}

/** Download and install where this install can (the Windows installer), else the download in the browser. */
function updatePrimary(u: NonNullable<AppState["update"]>, p: AppState["updateProgress"]): string {
  if (!u.installable) return `<button type="button" class="btn btn-primary" data-open="${esc(u.downloadUrl ?? u.url ?? "")}">Download ${esc(u.latest ?? "")}</button>`;
  if (p.stage === "ready") return `<button type="button" class="btn btn-primary" id="updateRestartPop">Restart to update</button>`;
  if (p.stage === "downloading") return downloadBar(esc(u.latest ?? ""), p.percent);
  return `<button type="button" class="btn btn-primary" id="updateGet">${p.stage === "failed" ? "Try again" : `Download and install ${esc(u.latest ?? "")}`}</button>`;
}

/** Restart asks in the app's own dialog: what happens, what stays, and which running job it waits for. */
export function restartDialog(s: AppState, restarting: boolean): string {
  const off = restarting ? " disabled" : "";
  return `<div class="confirm-head brand-head">${MARK}<div><h2 id="rsTitle">Restart to update?</h2><div class="muted small">Everloot ${esc(s.update?.latest ?? "")} · you run ${esc(s.version)}</div></div></div>
    <div class="confirm-body"><p>The app closes, installs the update and opens again in a few seconds.</p><p class="fg2">Your settings, characters, chat and backups stay in the data folder. The game and its save files are not touched.</p></div>
    <div class="confirm-foot"><span class="muted small">${esc(restartWait(s.engine))}</span><div class="row"><button type="button" class="btn" id="restartCancel"${off}>Not now</button><button type="button" class="btn btn-primary btn-icon" id="restartGo"${off}>${RESTART}${restarting ? "Restarting…" : "Restart and update"}</button></div></div>`;
}

/** What Delete my local data removes, what it leaves, and what is running that it must wait for. */
export function wipeDialog(s: AppState, v: View): string {
  const { wipe, data } = v;
  const off = wipe.stage === "deleting" ? " disabled" : "";
  const keys = websiteUrl(s.settings.endpoint, "/docs/api/keys#your-keys");
  const key = s.account.signedIn
    ? `<li>Your everloot.app key on this computer (…${esc(s.account.hint ?? "")}). It still works until you revoke it on everloot.app: ${ext(keys, "manage keys")}.</li>`
    : "";
  if (wipe.stage === "left") {
    return `<div class="confirm-head"><h2 id="wpTitle">Some files were not deleted</h2><div class="muted small mono">${esc(s.dataFolder)}</div></div>
      <div class="confirm-body"><p>Another program has these open: <span class="mono">${esc(wipe.left.join(", "))}</span>. Close it and try again, or start over now and delete them yourself from the data folder.</p>
      <p class="fg2">Everything else is gone, and the app has stopped its jobs.</p>${wipe.error ? `<p class="error small">${esc(wipe.error)}</p>` : ""}</div>
      <div class="confirm-foot"><span></span><div class="row"><button type="button" class="btn" id="wipeRelaunch">Start over now</button><button type="button" class="btn btn-primary" id="wipeGo">Try again</button></div></div>`;
  }
  const running = JOBS.filter((j) => s.engine.jobs[j].state === "running");
  const busyLine = running.length ? `${running.map((j) => JOB_NAMES[j]).join(" and ")} ${running.length === 1 ? "is" : "are"} running; wait for ${running.length === 1 ? "it" : "them"} to finish.`
    : data.chat?.busy ? "Chat is answering; wait for it to finish."
      : s.updateProgress.stage === "downloading" ? "An update is downloading; wait for it to finish."
        : s.builds.state === "running" ? "Saved builds are syncing; wait a moment." : "";
  return `<div class="confirm-head"><h2 id="wpTitle">Delete your local data?</h2><div class="muted small mono">${esc(s.dataFolder)}${data.usage ? ` · ${kb(data.usage.total)}` : ""}</div></div>
    <div class="confirm-body"><p>The app empties its data folder and starts over on the setup screen. This goes:</p>
      <ul class="plain fg2">
        <li>Your settings, and the model keys you added for Chat</li>
        ${key}
        <li>Upload history: the next upload sends what is in <code>Everloot.lua</code> again, and the site skips what it already has</li>
        <li>Backups of <code>Everloot.lua</code></li>
        <li>Chat history and <code>/ask</code> answers</li>
        <li>Downloaded updates</li>
      </ul>
      <p class="fg2">The command-line tool uses the same folder, so it loses its upload history and settings too. The game folder, the addon and your <code>Everloot.lua</code> files are not touched.</p>
      ${wipe.error ? `<p class="error small">${esc(wipe.error)}</p>` : ""}</div>
    <div class="confirm-foot"><span class="muted small">${esc(busyLine)}</span><div class="row"><button type="button" class="btn" id="wipeCancel"${off}>Cancel</button><button type="button" class="btn btn-danger-fill" id="wipeGo"${off || (busyLine ? " disabled" : "")}>${wipe.stage === "deleting" ? "Deleting…" : "Delete and start over"}</button></div></div>`;
}

/** Offers WoW: Forever's folder when the game folder is another client beside it (the closed beta, a classic realm). */
function foreverCallout(s: AppState): string {
  if (!s.foreverFolder || !s.settings.gameFolder) return "";
  return `<p class="callout fg2">${icon("alert")}<span>Everloot is built for WoW: Forever, and it is installed at <span class="mono">${esc(s.foreverFolder)}</span>. The app reads <span class="mono">${esc(s.settings.gameFolder)}</span> now. <button type="button" class="btn btn-primary" id="useForever">Use Forever</button> <button type="button" class="link" id="keepFolder">Keep this folder</button></span></p>`;
}
