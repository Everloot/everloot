import { accountOf as account } from "../main/engine";
import { diagnostics } from "../shared/diagnostics";
import { ago, clock, copyLabel, esc, gold, kb, msg, sparkline, statusText, when } from "./format";
import { NO_SOURCED_ANSWER, type AddonInfo, type AppState, type AskInfo, type BackupInfo, type ChangeItem, type CharacterRow, type CharactersInfo, type ChatInfo, type ChatProgress, type EverlootApi, type PriceLookup, type FileSummary, type GameFolderCandidate, type Job, type JobStatus, type MarketInfo, type MoneyDay } from "../shared/types";
import { PROVIDER_PRESETS, presetFor, type ModelChoice, type ProviderKind } from "../shared/providers";
import { inkOn } from "../../../web/src/lib/chat/catalogue";
import { WEBSITE_LINKS, websiteUrl } from "../shared/website";

declare global { interface Window { everloot: EverlootApi } }
const api = window.everloot;

type Page = "overview" | "chat" | "characters" | "upload" | "market" | "ask" | "addon" | "changes" | "log" | "settings";
const PAGES: { id: Page; label: string; job?: Job }[] = [
  { id: "overview", label: "Overview" },
  { id: "chat", label: "Chat" },
  { id: "characters", label: "Characters" },
  { id: "upload", label: "Upload", job: "upload" },
  { id: "market", label: "Market", job: "prices" },
  { id: "ask", label: "Ask", job: "ask" },
  { id: "addon", label: "Addon" },
  { id: "changes", label: "Changes" },
  { id: "log", label: "Log" },
  { id: "settings", label: "Settings" },
];

let state: AppState | null = null;
let page: Page = "overview";
let candidates: GameFolderCandidate[] = [];
let chosenFolder: string | null = null;
/** The census line on the welcome screen, ticked until the player unticks it. */
let censusChoice = true;
/** The welcome screen's "I agree to the Terms of Use and Privacy Policy" box. */
let agreed = false;
/** A browser sign-in is waiting for everloot.app. */
let connecting = false;
/** Counts sign-in attempts, so only the newest one reports how it ended. */
let connectAttempt = 0;
let draftDirty = false;
let busy = "";
let flash = "";
/** The provider picked in the Chat page's form before it is saved; the form re-renders around it. */
let pickKind: ProviderKind = "anthropic";
let pickOpen = false;
/** Each provider's models as the provider listed them, once asked (api.chatModels); the catalogue's until then. */
const liveModels: Partial<Record<ProviderKind, ModelChoice[]>> = {};
const askedModels = new Set<ProviderKind>();
/** The answer being written while a chat question is out; null otherwise. */
let live: ChatProgress | null = null;
/** The Copy button just pressed and how it went, kept for its 1.5 s across a redraw of the thread. */
let copied: { index: number; label: string } | null = null;
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
/** The Market page's last price lookup; null before the first. */
let priceLookup: PriceLookup | null = null;
const data: { upload?: FileSummary[]; backups?: BackupInfo[]; market?: MarketInfo; ask?: AskInfo; addon?: AddonInfo; changes?: ChangeItem[]; changesError?: string; characters?: CharactersInfo; chat?: ChatInfo } = {};

const main = document.getElementById("app")!;
const side = document.getElementById("side")!;
const nav = document.getElementById("nav")!;
const sideFoot = document.getElementById("side-foot")!;
const updatePop = document.getElementById("updatePop")!;
/** Whether the update popover is open. */
let updateOpen = false;

const ext = (url: string, text: string) => `<button type="button" class="link" data-open="${esc(url)}">${esc(text)}</button>`;

const dot = (j: JobStatus) => `<span class="dot dot-${j.state}" aria-hidden="true"></span>`;
const onOff = (job: Job, s: AppState) => (job === "ask" ? s.settings.ask.enabled : s.settings[job]);
const jobSwitch = (job: Job, s: AppState) => `<label class="switch"><input type="checkbox" data-toggle="${job}" ${onOff(job, s) ? "checked" : ""}><span>${onOff(job, s) ? "On" : "Off"}</span></label>`;
const runBtn = (job: Job, s: AppState, label = "Run now") => `<button type="button" class="btn" data-run="${job}" ${onOff(job, s) && s.engine.files.length && !s.engine.paused && s.engine.jobs[job].state !== "running" ? "" : "disabled"}>${label}</button>`;
/** A button that opens Chat with a question ready; the click handler sends it. */
const askChip = (question: string, label = question) => `<button type="button" class="chip ask" data-ask="${esc(question)}">${esc(label)}</button>`;
/** The question to put to the chat about a job that failed. */
const whyQuestion = (job: Job, s: AppState) => `Why did ${job === "ask" ? "the /ask answers" : job} fail? The app says: ${s.engine.jobs[job].message}`;
/** One question per failed job, in job order. */
const whyFailed = (s: AppState): string[] => (["upload", "prices", "ask"] as Job[]).filter((j) => s.engine.jobs[j].state === "error").map((j) => whyQuestion(j, s));
/** The "ask why" link under a stat whose job failed; nothing otherwise. */
const askWhy = (job: Job, s: AppState) => (s.engine.jobs[job].state === "error" ? ` · <button type="button" class="link" data-ask="${esc(whyQuestion(job, s))}">ask why</button>` : "");
const logLines = (s: AppState, n: number) => s.engine.log.slice(-n).reverse().map((l) => `<div><time>${clock(l.at)}</time><span class="${l.level}">${esc(l.text)}</span></div>`).join("") || '<span class="muted">Nothing yet.</span>';

// ---------- screens ----------

function welcome(): string {
  const list = candidates.length
    ? `<div class="choices">${candidates.map((c) => `
        <label class="choice"><input type="radio" name="folder" value="${esc(c.folder)}" ${chosenFolder === c.folder ? "checked" : ""}>
          <span class="grow"><span class="mono">${esc(c.product)}</span> <span class="muted">${c.files ? `${c.files} account file(s) with Everloot data` : c.hasAccounts ? "no Everloot data yet" : "never played here yet"}</span><br><span class="muted mono small">${esc(c.folder)}</span></span></label>`).join("")}</div>`
    : `<p class="muted">No World of Warcraft folder was found in the usual places. Browse to the folder that holds <code>WTF</code>, for example <code>World of Warcraft\\_classic_era_</code>.</p>`;
  const custom = chosenFolder && !candidates.some((c) => c.folder === chosenFolder) ? `<p class="mono fg2">${esc(chosenFolder)}</p>` : "";
  const signedIn = state?.account.signedIn;
  return `<div class="welcome">
    <div class="brand"><img src="logo.png" alt=""><h1>Set up Everloot Desktop App</h1></div>
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
        <li>The uploader keeps guild, gear, gold, collection and installed-addon rows here. If you configure a model for Chat, it receives your questions and any local character details it uses to answer.</li>
      </ul>
      <p class="small fg2">Uploaded observations are published under CC BY-SA 4.0, credited to Everloot contributors. Source: ${ext("https://github.com/Everloot/everloot", "github.com/Everloot/everloot")} · Rules: ${ext("https://everloot.app/privacy", "everloot.app/privacy")}</p>
    </section>
    <section class="panel">
      <h2>Which game folder?</h2>
      ${list}${custom}
      <div class="row"><button type="button" class="btn" id="browse">Browse…</button><button type="button" class="btn" id="redetect">Look again</button></div>
    </section>
    <label class="agree"><input type="checkbox" id="agree" ${agreed ? "checked" : ""}> I agree to the ${ext("https://everloot.app/terms", "Terms of Use")} and ${ext("https://everloot.app/privacy", "Privacy Policy")}.</label>
    <div class="row"><button type="button" class="btn btn-primary btn-lg" id="start" ${chosenFolder && agreed ? "" : "disabled"}>Start</button><span class="muted">Nothing runs before you press Start.</span></div>
  </div>`;
}

function overview(s: AppState): string {
  const e = s.engine;
  const up = e.jobs.upload, pr = e.jobs.prices, ask = e.jobs.ask;
  const addon = data.addon;
  const addonLine = !addon ? "…" : addon.installed
    ? (addon.newer && addon.latest ? `${addon.installed} <span class="warn">→ ${addon.latest.version} available</span>` : `${addon.installed}${addon.latest ? ' <span class="ok">up to date</span>' : ""}`)
    : '<span class="warn">not installed</span>';
  const changes = (data.changes ?? []).slice(0, 5);
  return `<div class="page">
    <div class="head"><h1>Overview</h1><span class="sub">${e.files.length ? `Watching ${e.files.length} account file(s)` : "Not watching a game folder"}${e.paused ? " · paused" : ""}</span></div>
    ${s.notice ? `<p class="error">${esc(s.notice)}</p>` : ""}
    ${s.update?.newer && s.update.url ? `<p class="fg2">Everloot Desktop App ${esc(s.update.latest ?? "")} is out; you run ${esc(s.version)}. ${ext(s.update.url, "Download it")} and install over this one; your settings stay.</p>` : ""}
    ${!e.files.length && s.settings.gameFolder ? `<p class="fg2">No <code>Everloot.lua</code> under <span class="mono">${esc(s.settings.gameFolder)}</span> yet. Log out once in the game so it writes the file.</p>` : ""}
    <div class="stats">
      <div class="stat"><div class="k">Upload</div><div class="v">${dot(up)} ${up.state === "ok" ? "OK" : up.state === "error" ? "Failed" : up.state === "off" ? "Off" : "Waiting"}</div><div class="s">${up.at ? ago(up.at) : "never"}${askWhy("upload", s)}</div></div>
      <div class="stat"><div class="k">Market prices</div><div class="v">${dot(pr)} ${data.market ? `${data.market.last.length} realm(s)` : pr.state === "off" ? "Off" : "Waiting"}</div><div class="s">${data.market?.scans[0] ? `your last scan ${ago(data.market.scans[0].at)}` : pr.at ? ago(pr.at) : "never"}${askWhy("prices", s)}</div></div>
      <div class="stat"><div class="k">/ask</div><div class="v">${dot(ask)} ${ask.state === "off" ? "Off" : ask.state === "error" ? "Failed" : "On"}</div><div class="s">${ask.at ? ago(ask.at) : s.settings.ask.enabled ? "waiting" : "turn on in Ask"}${askWhy("ask", s)}</div></div>
      <div class="stat"><div class="k">Addon</div><div class="v">${addonLine}</div><div class="s">${addon?.slots.prices ? "prices file in game" : "no prices file yet"}${addon && (!addon.installed || addon.newer) ? ` · <button type="button" class="link" data-page="addon">${addon.installed ? "update" : "install"}</button>` : ""}</div></div>
    </div>
    <div class="grid2">
      <section class="panel"><div class="row between"><h2>Recent activity</h2><div class="row">${runBtn("upload", s, "Upload now")}${runBtn("prices", s, "Refresh prices")}</div></div><div class="log">${logLines(s, 8)}</div></section>
      <section class="panel"><div class="row between"><h2>Latest changes</h2><button type="button" class="link" data-page="changes">all</button></div>
        <div class="list">${changes.length ? changes.map((c) => `<div class="item"><div class="t">${c.link ? ext(c.link, c.title) : esc(c.title)}</div><div class="muted small">${when(c.date)}</div></div>`).join("") : `<span class="muted">${data.changesError ? esc(data.changesError) : "Loading…"}</span>`}</div></section>
    </div>
  </div>`;
}

function chat(): string {
  const c = data.chat;
  const thread = (c?.messages ?? []).map((m, i) => {
    // Search alone found nothing and no model is set up: say what would answer it.
    const nudge = !m.model && m.text === NO_SOURCED_ANSWER && !c?.providers.length && c?.mode === "plain search"
      ? `<br>Search alone only matches names in Everloot's data. A model reads the question, fixes the spelling and looks it up for you. <button type="button" class="link" data-addmodel>Add a key or a free model</button>`
      : "";
    const meta = m.role === "assistant"
      ? `<div class="meta"><button type="button" class="link copy" data-copy="${i}">${esc(copyLabel(i, copied))}</button>${m.model ? `<b>${esc(m.model)}</b>` : m.stopped ? "" : "<b>search only</b>"}${m.stopped ? `${m.model ? " · " : ""}Stopped` : ""}${m.steps.length ? ` · ${m.steps.length} tool call(s): ${esc(m.steps.map((st) => st.tool).join(", "))}` : ""}${m.sources.length ? `<br>Sources: ${m.sources.map((x) => esc(x)).join(" · ")}` : m.model && !m.stopped && m.text !== NO_SOURCED_ANSWER ? "<br>No source in Everloot's data; the model's own knowledge" : ""}${nudge}</div>`
      : `<div class="meta">${clock(m.at)}</div>`;
    return `<div class="msg msg-${m.role}">${esc(m.text)}${meta}</div>`;
  }).join("");
  return `<div class="page chat">
    <div class="head"><h1>Chat</h1><span class="sub">${c ? `${esc(c.mode)} · ${c.withToken ? "your MCP token" : c.withAccountKey ? "public MCP, your account's limits" : "public MCP, rate limited"}` : ""} <button type="button" class="link" id="chatClear" ${c?.busy ? "disabled" : ""}>clear</button></span></div>
    <p class="muted small">Ask anything about the game. The model looks it up in Everloot's own MCP tools first and names the sources; when they have nothing it says the answer is its own knowledge. The transcript is saved in your data folder. Your selected model provider receives your questions, conversation history and any local character details the model uses, including names, gold, gear and progress.</p>
    ${c && c.mode === "plain search" && !pickOpen ? `<p class="muted small">No model yet, so you get Everloot's search hits as they are. <button type="button" class="link" data-addmodel>Add your own key or a free model</button></p>` : ""}
    ${c && pickOpen ? providerForm(c) : ""}
    ${flash ? `<p class="${flash.startsWith("!") ? "error" : "ok"} small">${esc(flash.replace(/^!/, ""))}</p>` : ""}
    <div class="thread" id="thread">${thread || `<span class="muted">Ask anything about WoW: Forever: a drop, a vendor, a recipe, a price, a quest.</span><div class="chips">${starters(c).map((q) => askChip(q)).join("")}</div>`}${c?.busy ? `<div class="msg msg-assistant" id="chatLive">${liveAnswer()}</div>` : ""}${c?.error ? `<div class="msg msg-assistant error">${esc(c.error)}</div>` : ""}</div>
    <form id="chatForm"><textarea id="chatText" rows="2" aria-label="Your question" placeholder="Ask about Forever. Enter sends, Shift+Enter is a new line." ${c?.busy ? "disabled" : ""}></textarea>
      <div class="composer-bar">${c ? modelMenu(c) : ""}${c?.busy ? `<button type="button" class="btn" id="chatStop">Stop</button>` : ""}<button type="submit" class="btn btn-primary" ${c?.busy ? "disabled" : ""}>Send</button></div></form>
  </div>`;
}

/**
 * The model menu under the question box, as in other chat apps: every model of every provider saved
 * here, the one in use selected; picking one switches Chat and the in-game /ask. The last entries
 * add a key or manage the saved ones.
 */
function modelMenu(c: ChatInfo): string {
  const groups = c.providers.map((p) => {
    const preset = presetFor(p.kind);
    const models = modelsOf(p.kind).map((m) => ({ id: m.id, label: m.label }));
    if (!models.some((m) => m.id === p.model)) models.unshift({ id: p.model, label: p.model });
    const on = (id: string) => c.provider?.kind === p.kind && c.provider.model === id;
    return `<optgroup label="${esc(preset?.name ?? p.kind)}">${models.map((m) => `<option value="${esc(`${p.kind}|${m.id}`)}" ${on(m.id) ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</optgroup>`;
  }).join("");
  const current = c.provider ? "" : `<option value="" selected>${c.mode === "plain search" ? "Search only, no model" : esc(`config.json: ${c.mode}`)}</option>`;
  return `<select id="modelPick" class="model-pick" aria-label="Model" ${c.busy ? "disabled" : ""}>${current}${groups}<option value="add">Add a provider key…</option>${c.providers.length ? `<option value="manage">Manage saved keys…</option>` : ""}</select>`;
}

/** The answer so far, and what the model is doing while there is no text or it is running a tool. */
function liveAnswer(): string {
  const doing = live?.tool ? `Looking up ${esc(live.tool)}…` : live?.text ? "" : "Answering…";
  return `${live?.text ? esc(live.text) : ""}${doing ? `<div class="meta">${doing}</div>` : ""}`;
}

/** A provider's monogram tile on its own colour; render() paints it, since the page's CSP allows no inline styles. */
function tile(kind: ProviderKind, small = false): string {
  const p = presetFor(kind);
  return p ? `<span class="tile${small ? " tile-sm" : ""}" aria-hidden="true" data-tile="${esc(p.colour)}">${esc(p.mark)}</span>` : "";
}

const modelsOf = (kind: ProviderKind): ModelChoice[] => liveModels[kind] ?? presetFor(kind)?.models ?? [];

/** The provider form's model list, the pick kept when the new list still has it. */
function modelSelect(kind: ProviderKind, picked = ""): string {
  const models = modelsOf(kind);
  if (!models.length) return "";
  const on = models.some((m) => m.id === picked) ? picked : models[0].id;
  return `<select name="model" class="grow">${models.map((m) => `<option value="${esc(m.id)}" ${m.id === on ? "selected" : ""}>${esc(m.label)}${m.note ? ` · ${esc(m.note)}` : ""}</option>`).join("")}<option value="">Another model id…</option></select>`;
}

/**
 * Asks the provider, through the main side, which models it serves now, once per provider; the open form's list and
 * the model menu are swapped in place when it answers, so nothing typed in the form is lost.
 */
function loadModels(kind: ProviderKind, again = false): void {
  if (askedModels.has(kind) && !again) return;
  askedModels.add(kind);
  void api.chatModels(kind).then((models) => {
    if (!models) return;
    liveModels[kind] = models;
    const select = main.querySelector<HTMLSelectElement>('#providerForm select[name="model"]');
    if (select && pickOpen && pickKind === kind) select.outerHTML = modelSelect(kind, select.value);
    const menu = main.querySelector<HTMLSelectElement>("#modelPick");
    if (menu && data.chat && !data.chat.busy && document.activeElement !== menu) menu.outerHTML = modelMenu(data.chat);
  }).catch(() => { askedModels.delete(kind); });
}

/** Opens the provider form on a provider, or on the first one not saved yet (OpenRouter first: one key, cheap and free models). */
function openProviderForm(kind: ProviderKind | null): void {
  const saved = new Set(data.chat?.providers.map((p) => p.kind));
  const order: ProviderKind[] = ["openrouter", "anthropic", "opencode", "ollama", "custom"];
  pickKind = kind ?? order.find((k) => !saved.has(k)) ?? "openrouter";
  pickOpen = true; flash = "";
  loadModels(pickKind);
  render();
  main.querySelector<HTMLElement>("#providerKind")?.focus();
}

/** Questions to start with: about the game always; about the player's own data when a model can call the local tools. */
function starters(c: ChatInfo | null | undefined): string[] {
  const game = ["What drops the Bindings of the Windseeker?", "Where do I learn Enchanting past 225?"];
  if (!c || c.mode === "plain search") return game;
  return ["How much gold do my characters have?", "When did I last scan my realms?", "Is my data uploading?", ...game];
}

/** The provider picker: one preset, its key, a model from the list or typed, and a custom server address; and the keys already saved. */
function providerForm(c: ChatInfo): string {
  const preset = presetFor(pickKind) ?? PROVIDER_PRESETS[0];
  const saved = c.providers.some((p) => p.kind === preset.kind);
  const kinds = PROVIDER_PRESETS.map((p) => `<option value="${p.kind}" ${p.kind === preset.kind ? "selected" : ""}>${esc(p.label)}${c.providers.some((s) => s.kind === p.kind) ? " · saved" : ""}</option>`).join("");
  const name = (kind: ProviderKind) => esc(presetFor(kind)?.name ?? kind);
  const list = c.providers.length
    ? `<div class="saved-keys"><span class="muted small">Saved here:</span>${c.providers.map((p) => `<span class="chip chip-key">${tile(p.kind, true)}${name(p.kind)} <button type="button" class="link" data-removekind="${p.kind}" aria-label="Remove ${name(p.kind)}">remove</button></span>`).join("")}</div>`
    : "";
  const models = modelSelect(preset.kind);
  return `<form id="providerForm" class="panel" autocomplete="off">
    ${list}
    <div class="field"><label for="providerKind">Provider</label><div class="tile-row">${tile(preset.kind)}<select name="kind" id="providerKind">${kinds}</select></div></div>
    ${preset.kind === "custom" ? `<div class="field"><label for="providerUrl">Server</label><input name="baseUrl" id="providerUrl" placeholder="https://host/v1" spellcheck="false"></div>` : ""}
    ${preset.keyFile ? `<div class="field"><label for="providerKey">Key</label><input type="password" name="key" id="providerKey" placeholder="${saved ? "saved; paste a new one to replace it" : preset.kind === "custom" ? "optional" : "paste the key"}" spellcheck="false"><span class="hint">${esc(preset.keyHint)}</span></div>` : ""}
    <div class="field"><label for="providerModel">Model</label>${models}<input name="modelText" id="providerModel" placeholder="${modelsOf(preset.kind).length ? "only if you picked Another model id" : preset.kind === "ollama" ? "the model you pulled, like qwen3:8b" : "model id"}" spellcheck="false"></div>
    <p class="muted small">${esc(preset.dataNote)} The key is written to a file in your data folder and named from <code>config.json</code>; it goes to that provider only, with your questions and the tool results.</p>
    <div class="row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn" id="cancelProvider">Cancel</button></div>
  </form>`;
}

const SLOT_ORDER = ["HeadSlot", "NeckSlot", "ShoulderSlot", "BackSlot", "ChestSlot", "WristSlot", "HandsSlot", "WaistSlot", "LegsSlot", "FeetSlot", "Finger0Slot", "Finger1Slot", "Trinket0Slot", "Trinket1Slot", "MainHandSlot", "SecondaryHandSlot"];
const SLOT_LABEL: Record<string, string> = { HeadSlot: "Head", NeckSlot: "Neck", ShoulderSlot: "Shoulders", BackSlot: "Back", ChestSlot: "Chest", WristSlot: "Wrist", HandsSlot: "Hands", WaistSlot: "Waist", LegsSlot: "Legs", FeetSlot: "Feet", Finger0Slot: "Finger 1", Finger1Slot: "Finger 2", Trinket0Slot: "Trinket 1", Trinket1Slot: "Trinket 2", MainHandSlot: "Main hand", SecondaryHandSlot: "Off hand" };
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** The picked character (character\0realm) and the open drawer, kept across re-renders. */
let charPick: string | null = null;
let drawerChar: CharacterRow | null = null;
let drawerOpener: HTMLElement | null = null;

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

/** One keyed progress row set, listed apart from the named characters by design. */
function keyedRows(c: CharactersInfo | undefined): string {
  return (c?.progress ?? []).map((p) => `<tr><td><span class="mono">${esc(p.key)}</span></td><td>${esc(p.class.toLowerCase())} ${p.level}</td><td class="num">${p.achievements}${p.achievementsInProgress ? `<span class="muted"> +${p.achievementsInProgress} in progress</span>` : ""}</td><td class="num">${p.reputations}${p.exalted ? `<span class="muted"> · ${p.exalted} exalted</span>` : ""}</td><td class="num">${p.titles}</td><td class="num">${p.quests}</td></tr>`).join("");
}

function characters(): string {
  const c = data.characters;
  const named = c?.characters ?? [];
  const selected = named.find((r) => `${r.character}\u0000${r.realm}` === charPick) ?? named[0] ?? null;
  const t = selected ? totals(selected.days) : { earned: 0, spent: 0 };
  const net30 = netOf(t), week = selected ? netOf(selected.week) : 0;
  const rows = named.map((r, i) => {
    const w = netOf(r.week), at = r.history[r.history.length - 1]?.at;
    return `<tr class="roster-row${r === selected ? " sel" : ""}" data-char="${i}" tabindex="0" aria-haspopup="dialog">
      <td><b>${esc(r.character)}</b><div class="muted small">${esc(r.realm)}</div></td>
      <td class="num">${gold(r.gold)}${sparkline(r.history)}</td>
      <td class="num ${w >= 0 ? "ok" : "warn"}">${r.week.earned || r.week.spent ? signed(w) : "–"}</td>
      <td class="num">${r.itemLevel ?? "–"}<div class="muted small">${r.gearSlots ? `${r.gearSlots} slots` : ""}</div></td>
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
  const prog = keyedRows(c);
  return `<div class="page char-page">
    <div class="head">
      <div>
        <div class="mono muted small">${selected ? `${esc(selected.realm.toUpperCase())} · from the addon's save file` : "from the addon's save file"}</div>
        <h1 class="${selected ? "char-name" : ""}">${selected ? esc(selected.character) : "Characters"}</h1>
      </div>
      <div class="row"><span class="sub">Stored locally. Asking the assistant may send character details to your selected model provider.</span>${named.length && data.chat?.mode !== "plain search" ? askChip(`How is ${selected?.character ?? "my main"} doing: gold this week, gear and progress?`, "Ask the assistant") : ""}</div>
    </div>
    <p class="fg2">What the addon recorded about your own characters. Gold and gear carry the name; progress rows carry an opaque key the addon derives per character, so they are listed apart. Sharing any of this with the site is a choice you make on the upload page with a verified grant, never here.</p>
    ${named.length ? `${hero}
    <section class="panel"><div class="row between"><h2>Roster</h2><span class="muted small">click a character, or press Enter, for the details</span></div>
      <table class="roster"><thead><tr><th>Character</th><th class="num">Gold</th><th class="num">7 days</th><th class="num">Item level</th><th class="num">Last seen</th></tr></thead><tbody>${rows}</tbody></table>
    </section>` : `<section class="panel"><p class="muted">${c ? "No gold or gear snapshot yet. The addon records them while you play." : "Loading…"}</p></section>`}
    <section class="panel" id="keyed" tabindex="-1"><h2>Progress · keyed</h2>
      ${prog ? `<table><thead><tr><th>Key</th><th>Class</th><th class="num">Achievements</th><th class="num">Reputations</th><th class="num">Titles</th><th class="num">Quests done</th></tr></thead><tbody>${prog}</tbody></table>` : `<p class="muted">${c ? "Nothing yet. The completion tracker is off until <code>/everloot completion on</code> in game." : "Loading…"}</p>`}
      ${c?.talents.length ? `<p class="muted small">Active talent builds: ${c.talents.map((x) => `${esc(x.class.toLowerCase())} ${x.level} (${x.points} points)`).join(", ")}. Not linked to a name.</p>` : ""}
    </section>
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

function drawerOverview(c: CharacterRow): string {
  const week = netOf(c.week);
  const slots = new Map(c.equipped.map((e) => [e.slot, e.itemLevel]));
  const avg = c.equipped.length ? (c.equipped.reduce((s, e) => s + e.itemLevel, 0) / c.equipped.length).toFixed(1) : null;
  const grid = SLOT_ORDER.map((s) => {
    const v = slots.get(s);
    return `<div class="slot${v ? "" : " empty"}"><span class="slot-k">${SLOT_LABEL[s] ?? esc(s)}</span><span class="slot-v">${v ?? "—"}</span></div>`;
  }).join("");
  const catCol = (dir: "in" | "out") => {
    const rows = Object.entries(dir === "in" ? c.earned : c.spent).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return rows.length ? rows.map(([k, v]) => `<div class="cat"><span>${esc(k.replace(/_/g, " "))}</span><span class="num">${gold(v)}</span></div>`).join("") : '<p class="muted small">Nothing recorded.</p>';
  };
  return `
    <div class="dw-stats">
      <div class="dw-stat"><span class="k">Gold now</span><b>${gold(c.gold)}</b></div>
      <div class="dw-stat"><span class="k">Peak</span><b>${gold(c.peakGold)}</b></div>
      <div class="dw-stat"><span class="k">7-day net</span><b class="${week >= 0 ? "ok" : "warn"}">${signed(week)}</b></div>
    </div>
    <section class="dw-sec"><div class="row between"><h3>Gear</h3><span class="muted small">${c.equipped.length ? `${c.equipped.length} slots · average ${avg}` : "no snapshot yet"}</span></div>
      <div class="slot-grid">${grid}</div>
      <p class="muted small">Straight from the addon's last gear sample; empty slots show —.</p>
    </section>
    <section class="dw-sec"><div class="row between"><h3>Money by category</h3><span class="muted small">all time in this file</span></div>
      <div class="cat-cols"><div><h4>Earned</h4>${catCol("in")}</div><div><h4>Spent</h4>${catCol("out")}</div></div>
    </section>
    <section class="dw-sec"><h3>Progress</h3>
      <p class="muted small">Achievements, reputations, titles and quests are keyed by an opaque identifier, never a name, so they stay listed apart from this character. <button type="button" class="link" id="gotoKeyed">Show the keyed rows</button></p>
    </section>`;
}

function drawerHistory(c: CharacterRow): string {
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

function drawerShare(c: CharacterRow): string {
  const activeDays = c.days.filter((d) => d.earned || d.spent).length;
  return `
    <section class="dw-sec"><div class="row between"><h3>Sharing stays on the website</h3><span class="muted small">off by default</span></div>
      <p class="fg2">The automatic uploader keeps <b>${esc(c.character)}</b>'s gold, gear and progress on this computer. On everloot.app/upload you choose, per character, to include gear or gold; a verified grant authorizes it, and the same page revokes the grant or opts the character out at any time.</p>
      <p class="muted small">Progress rows carry an opaque key, never a name, so they cannot be included in that upload. Separately, Chat may send character names, gold, gear and progress to your selected model provider when it uses local tools to answer.</p>
      <button type="button" class="btn btn-primary" data-open="https://everloot.app/upload">Open the upload page</button>
    </section>
    <section class="dw-sec"><h3>What is on this machine</h3>
      <div class="cat"><span>Gear</span><span class="num">${c.gearSlots ? `${c.gearSlots} slots` : "none yet"}</span></div>
      <div class="cat"><span>Gold snapshots</span><span class="num">${c.history.length}</span></div>
      <div class="cat"><span>Days with money events, last 30</span><span class="num">${activeDays}</span></div>
    </section>`;
}

function selectChar(i: number): void {
  const c = data.characters?.characters[i];
  if (!c) return;
  charPick = `${c.character}\u0000${c.realm}`;
  render();
  openDrawer(c, main.querySelector<HTMLElement>(`[data-char="${i}"]`));
}

function openDrawer(c: CharacterRow, opener: HTMLElement | null, tab = "overview", focus = true): void {
  const layer = main.querySelector<HTMLElement>("#drawerLayer");
  if (!layer) return;
  drawerChar = c; drawerOpener = opener;
  main.querySelector<HTMLElement>(".char-page")?.setAttribute("inert", "");
  const realm = main.querySelector<HTMLElement>("#dwRealm"), title = main.querySelector<HTMLElement>("#dwTitle");
  if (realm) realm.textContent = c.realm.toUpperCase();
  if (title) title.textContent = c.character;
  renderDrawerTab(tab);
  layer.hidden = false;
  layer.setAttribute("aria-hidden", "false");
  if (focus) main.querySelector<HTMLElement>(".drawer-close")?.focus();
}

/** After the page is rebuilt (a job finished, the data refreshed), the open drawer comes back on the same character and tab. */
function reopenDrawer(tab: string): void {
  const was = drawerChar!;
  const rows = data.characters?.characters ?? [];
  const i = rows.findIndex((r) => r.character === was.character && r.realm === was.realm);
  if (i < 0) { drawerChar = null; drawerOpener = null; return; }
  openDrawer(rows[i], main.querySelector<HTMLElement>(`[data-char="${i}"]`), tab, false);
}

/** Remembers the focused control by its id or data attribute and returns the call that focuses it again after a rebuild. */
function keepFocus(): () => void {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !main.contains(el)) return () => {};
  const attrs = ["data-page", "data-run", "data-char", "data-dwtab", "data-copy", "data-toggle", "data-realm", "data-unfollow", "data-restore", "data-open", "data-ask"];
  const sel = el.id ? `#${CSS.escape(el.id)}`
    : attrs.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a)!)}"]`)[0]
      ?? (el.classList.contains("drawer-close") ? ".drawer-close" : null);
  return () => { if (sel && document.activeElement !== main.querySelector(sel)) main.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true }); };
}

function closeDrawer(): void {
  const layer = main.querySelector<HTMLElement>("#drawerLayer");
  if (!layer || layer.hidden) return;
  layer.hidden = true;
  layer.setAttribute("aria-hidden", "true");
  main.querySelector<HTMLElement>(".char-page")?.removeAttribute("inert");
  drawerChar = null;
  if (drawerOpener?.isConnected) drawerOpener.focus();
  drawerOpener = null;
}

function renderDrawerTab(name: string): void {
  const c = drawerChar, body = main.querySelector<HTMLElement>("#dwBody");
  if (!c || !body) return;
  body.innerHTML = name === "history" ? drawerHistory(c) : name === "share" ? drawerShare(c) : drawerOverview(c);
  body.scrollTop = 0;
  for (const b of main.querySelectorAll<HTMLElement>("[data-dwtab]")) {
    const on = b.dataset.dwtab === name;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }
}

function upload(s: AppState): string {
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
    <section class="panel"><div class="row between"><h2>Last run</h2><span class="muted small">${j.at ? when(j.at) : ""}</span></div><p class="${j.state === "error" ? "error" : "fg2"}">${esc(statusText(j))}</p></section>
    <section class="panel"><h2>Account files</h2>
      ${files.length ? `<table><thead><tr><th>Account</th><th>Written</th><th>Addon</th><th class="num">Records</th><th class="num">Confirmed</th><th>What it holds</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No account file yet.</p>'}
      <p class="muted small">Records are what the addon has on disk; confirmed is how many of them the site has accepted from this install. The site states a fact once three installs agree.</p>
    </section>
    <section class="panel"><div class="row between"><h2>Backups</h2><button type="button" class="btn" id="openBackups" ${(data.backups ?? []).length ? "" : "disabled"}>Open folder</button></div>
      ${backups.length ? `<table><thead><tr><th>Account</th><th>Taken</th><th class="num">Size</th><th></th></tr></thead><tbody>${backups}</tbody></table>` : '<p class="muted">No backup yet. One is kept after each upload.</p>'}
      <p class="muted small">A copy of <code>Everloot.lua</code> as it was uploaded, the newest ten per account. Restore while logged out; the file you replace is backed up first.</p>
      ${flash ? `<p class="${flash.startsWith("!") ? "error" : "ok"} small">${esc(flash.replace(/^!/, ""))}</p>` : ""}
    </section>
  </div>`;
}

function market(s: AppState): string {
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
  return `<div class="page">
    <div class="head"><h1>Market</h1><div class="row">${jobSwitch("prices", s)}${runBtn("prices", s, "Refresh now")}</div></div>
    <section class="panel"><div class="row between"><h2>Look up a price</h2>${ext(websiteUrl(s.settings.endpoint, "/tools/auctions"), "Auction prices on everloot.app ↗")}</div>
      <form id="priceForm" class="row" autocomplete="off"><input type="text" id="priceItem" name="priceItem" class="grow" aria-label="Item id or link" placeholder="Item id, or an item link pasted from game chat" maxlength="500"><button type="submit" class="btn">Look up</button></form>
      ${priceResult(s)}
      <p class="muted small">From the prices file in your game, the same numbers your tooltips show. In game, <code>/everloot price [item]</code> prints them in chat, anywhere in the world. Charts, every realm and item names are on the site.</p>
    </section>
    <p class="fg2">Community market values written into <code>EverlootPrices</code> so item tooltips show them after <code>/reload</code>. Realms from your own auction scans are always included; pick more below, the way TSM lets you pick realms, except the values are Everloot's own: a day counts once three reporters scanned it. Refreshed after each upload and every hour.</p>
    <section class="panel"><div class="row between"><h2>Realms to carry into the game</h2><span class="muted small">${m?.dataAsOf ? `site data as of ${when(m.dataAsOf)}` : ""}</span></div>
      ${checks}
      <div class="row"><input type="text" id="realmAdd" class="grow" placeholder="Add a realm by name" maxlength="60"><button type="button" class="btn" id="realmAddBtn">Follow</button></div>
      ${extra.length ? `<div class="chips">${extra.map((r) => `<span class="chip">${esc(r)} <button type="button" class="link" data-unfollow="${esc(r)}">remove</button></span>`).join("")}</div>` : ""}
      <p class="muted small">At most 20 realms in one prices file; your scans come first. The full tables and 60-day charts are on the Auction prices tool in the sidebar.</p>
    </section>
    <section class="panel"><h2>Your scans</h2>
      ${scans ? `<table><thead><tr><th>Realm</th><th>Last full scan</th><th>Status</th></tr></thead><tbody>${scans}</tbody></table>` : '<p class="muted">No full scan yet. At the auction house, press the <b>Everloot scan</b> button or type <code>/everloot scan</code>; the scan uploads after your next logout.</p>'}
      <p class="muted small">Every scan you upload is one of the three reporters a day needs before a price is published. A realm is only as fresh as its last scans.</p>
    </section>
    <section class="panel"><div class="row between"><h2>Written into the game</h2><span class="muted small">${j.at ? when(j.at) : ""}</span></div>
      ${j.state === "error" ? `<p class="error">${esc(j.message)}</p>` : ""}
      ${last.length ? `<table><thead><tr><th>Realm</th><th class="num">Items</th><th>Data as of</th><th>Why</th></tr></thead><tbody>${last.map((r) => `<tr><td>${esc(r.realm)}</td><td class="num">${r.items}</td><td>${r.dataAsOf ? when(r.dataAsOf) : "–"}</td><td class="muted">${r.source === "scan" ? "your scans" : "followed"}</td></tr>`).join("")}</tbody></table>`
        : m?.inGame?.length ? `<table><thead><tr><th>Realm</th><th class="num">Items</th><th>Data as of</th></tr></thead><tbody>${m.inGame.map((r) => `<tr><td>${esc(r.realm)}</td><td class="num">${r.items}</td><td>${r.dataAsOf ? when(r.dataAsOf) : "–"}</td></tr>`).join("")}</tbody></table><p class="muted small">The file in the game now; not refreshed yet this session.</p>`
        : '<p class="muted">Nothing written yet.</p>'}
    </section>
  </div>`;
}

/** The last lookup on the Market page: each realm's row from the game's prices file, and the site's full history. */
function priceResult(s: AppState): string {
  const p = priceLookup;
  if (!p) return "";
  if (!p.rows.length) return `<p class="muted">${esc(p.note ?? "Nothing found.")}</p>`;
  const site = (realm: string) => websiteUrl(s.settings.endpoint, `/tools/auctions?realm=${encodeURIComponent(realm)}&item=${p.itemId}`);
  return `<table><thead><tr><th>Realm</th><th class="num">Market</th><th class="num">Min</th><th class="num">Historical</th><th class="num">Up</th><th class="num">Reporters</th><th>Day</th><th></th></tr></thead><tbody>${p.rows.map((r) =>
    `<tr><td>${esc(r.realm)}</td><td class="num">${r.market === null ? '<span class="muted">unrecorded</span>' : gold(r.market)}</td><td class="num">${gold(r.min)}</td><td class="num">${gold(r.historical)}</td><td class="num">${r.quantity}</td><td class="num">${r.reporters}</td><td>${esc(r.day)}</td><td>${ext(site(r.realm), "history ↗")}</td></tr>`).join("")}</tbody></table>
    <p class="muted small">Item ${p.itemId}. Market weighs the last 14 public days, historical is the 60-day median, min is the lowest buyout.</p>`;
}

function ask(s: AppState): string {
  const j = s.engine.jobs.ask;
  const a = data.ask;
  const st = s.settings.ask;
  const pending = (a?.pending ?? []).flatMap((p) => p.asks.map((q) => ({ ...q, account: account(p.file) })));
  return `<div class="page">
    <div class="head"><h1>Ask</h1><div class="row">${jobSwitch("ask", s)}${runBtn("ask", s, "Answer now")}</div></div>
    <p class="fg2"><code>/ask</code> questions from the game are answered from everloot.app's public MCP server (with your account's limits when you are signed in, Settings > Account) and written into <code>EverlootAnswers</code>; they show after <code>/reload</code>. Every answer names its source; with no source there is no answer. The same setup serves the Chat page.</p>
    <form id="askForm" class="panel" autocomplete="off">
      <div class="grid2">
        <div class="field"><label for="mcpUrl">Private MCP server <span class="hint">used only with a token file</span></label><input type="url" id="mcpUrl" name="mcpUrl" value="${esc(st.mcpUrl)}"></div>
        <div class="field"><label for="tokenFile">Token file <span class="hint">for a private Everloot server; leave empty to use the public one. The token is never typed here</span></label>
          <div class="row"><input class="grow" type="text" id="tokenFile" name="tokenFile" value="${esc(st.tokenFile ?? "")}"><button type="button" class="btn" id="pickToken">Choose…</button></div></div>
      </div>
      <div class="row"><button type="submit" class="btn btn-primary">Save</button><span class="muted" id="saved"></span></div>
    </form>
    <div class="grid2">
      <section class="panel"><h2>Who answers</h2>
        ${a?.providerError ? `<p class="error">${esc(a.providerError)}</p>` : a?.providers.length ? `<p>Model: <b>${esc(a.providers.join(" > "))}</b>, writing at most two sentences from the top three sourced hits.</p>` : "<p>Plain search: the top sourced hit, no model.</p>"}
        <p class="muted small">An Anthropic key pasted on the <button type="button" class="link" data-page="chat">Chat page</button> answers here too. Other providers go in <code>config.json</code> in the data folder (any OpenAI-compatible server, keys from a file). <button type="button" class="link" id="openConfig">Open config.json</button></p>
        <p class="${j.state === "error" ? "error" : "fg2"} small">${esc(statusText(j))}</p>
      </section>
      <section class="panel"><h2>Pending in game</h2>
        ${pending.length ? `<div class="list">${pending.map((q) => `<div class="item"><div class="t">${esc(q.question)}</div><div class="muted small">${esc(q.account)} · ${when(q.askedAt)}</div></div>`).join("")}</div>` : '<p class="muted">No question waiting.</p>'}
      </section>
    </div>
    <section class="panel"><h2>Recent answers</h2>
      ${a?.answers.length ? `<div class="list">${a.answers.slice(0, 20).map((x) => `<div class="item"><div>${esc(x.answer)}</div><div class="muted small">${esc(x.source)} · ${when(x.answeredAt)}</div></div>`).join("")}</div>` : '<p class="muted">Nothing answered yet.</p>'}
    </section>
  </div>`;
}

function addon(s: AppState): string {
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
      ${upToDate
        ? `<h2>Up to date</h2><p class="fg2">${a!.installed === a!.latest!.version ? `You have the newest Everloot addon, ${esc(a!.installed!)}.` : `You have ${esc(a!.installed!)}, newer than the latest release ${esc(a!.latest!.version)}.`} Nothing to do.</p>`
        : `<h2>${a?.installed ? "Update" : "Install"}</h2><p class="fg2">Downloads <code>Everloot-${esc(a?.latest?.version ?? "x.y.z")}.zip</code> from the site, checks it against the checksum published with the GitHub release, and replaces <code>Interface/AddOns/Everloot</code> in one swap. Close the game first, or <code>/reload</code> after.</p>`}
      <div class="row">
        ${upToDate ? "" : `<button type="button" class="btn btn-primary" id="installAddon" ${a?.latest && s.settings.gameFolder && !busy ? "" : "disabled"}>${busy === "install" ? "Installing…" : a?.installed ? `Update to ${esc(a.latest?.version ?? "")}` : "Install"}</button>`}
        ${ext("https://everloot.app/upload", "manual install steps")}
        ${a?.addonsDir ? '<button type="button" class="link" id="openAddons">open the AddOns folder</button>' : ""}
        <span class="${flash.startsWith("!") ? "error" : "ok"} small" role="status">${esc(flash.replace(/^!/, ""))}</span>
      </div>
      ${upToDate ? `<p class="muted small">Addon acting up? <button type="button" class="link" id="installAddon" ${s.settings.gameFolder && !busy ? "" : "disabled"}>${busy === "install" ? "Reinstalling…" : a!.installed === a!.latest!.version ? `Reinstall ${esc(a!.installed!)}` : `Install release ${esc(a!.latest!.version)}`}</button> puts a clean copy of the release back${a!.installed === a!.latest!.version ? "" : " in place of this build"}. Only needed when files are broken or missing.</p>` : ""}
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

function changes(): string {
  const list = data.changes;
  return `<div class="page">
    <div class="head"><h1>Changes</h1><span class="sub">Blizzard posts, hotfixes and builds, newest first · ${ext("https://everloot.app/changes", "everloot.app/changes")}</span></div>
    <section class="panel"><div class="list">${list ? (list.length ? list.map((c) => `<div class="item"><div class="t">${c.link ? ext(c.link, c.title) : esc(c.title)}</div>${c.summary ? `<div class="fg2 small">${esc(c.summary)}</div>` : ""}<div class="muted small">${when(c.date)}</div></div>`).join("") : '<p class="muted">Nothing in the feed.</p>') : `<p class="muted">${data.changesError ? esc(data.changesError) : "Loading…"}</p>`}</div></section>
  </div>`;
}

function log(s: AppState): string {
  return `<div class="page">
    <div class="head"><h1>Log</h1><div class="row">${whyFailed(s).map((q) => askChip(q, "Ask the assistant why it failed")).join("")}<button type="button" class="btn" id="copyDiag">Copy diagnostics</button><button type="button" class="btn" id="pause">${s.engine.paused ? "Resume" : "Pause"}</button></div></div>
    ${flash ? `<p class="${flash.startsWith("!") ? "error" : "ok"} small">${esc(flash.replace(/^!/, ""))}</p>` : ""}
    <section class="panel"><div class="log">${logLines(s, 200)}</div></section>
    <p class="muted small">Copy diagnostics puts the version, your settings (where the token file is, never the token), the files watched, each job's last state and the last hundred lines on the clipboard, with your user folder hidden, for a bug report.</p>
  </div>`;
}

const JOB_ROWS: { job: Job; label: string; what: string }[] = [
  { job: "upload", label: "Upload", what: "Send what the addon recorded after every logout or /reload" },
  { job: "prices", label: "Market prices", what: "Keep community prices in your item tooltips, refreshed hourly" },
  { job: "ask", label: "In-game /ask", what: "Answer /ask questions from the game with the model below" },
];

/** The everloot.app account: a free key made after Battle.net sign-in on /docs/api/keys, pasted here. */
function accountPanel(s: AppState): string {
  const keys = websiteUrl(s.settings.endpoint, "/docs/api/keys#your-keys");
  const what = "Chat and the in-game /ask send it to everloot.app's public server, which then counts their requests against your account instead of this internet address, with a higher limit. A key with the \"Read my saved builds\" permission also brings your saved talent builds into the game. Uploads never carry it.";
  return s.account.signedIn
    ? `<section class="panel" id="account" tabindex="-1"><h2>Account</h2>
      <p class="fg2">Signed in to everloot.app with the key ending <b class="mono">…${esc(s.account.hint ?? "")}</b>.</p>
      <p class="muted small">${what}</p>
      <div class="row"><button type="button" class="btn" data-open="${esc(keys)}">Manage keys on everloot.app ↗</button><button type="button" class="btn" id="accountSignOut">Sign out</button></div>
    </section>`
    : `<section class="panel" id="account" tabindex="-1"><h2>Account</h2>
      <p class="fg2">Sign in through your browser: everloot.app opens, you sign in with Battle.net and press Connect, and the app gets its own key. It never sees your password.</p>
      <div class="row">${connecting ? `<button type="button" class="btn" id="connect">Open the browser again</button><button type="button" class="btn" id="connectCancel">Cancel</button><span class="muted small">Waiting for the browser…</span>` : `<button type="button" class="btn btn-primary" id="connect">Sign in with everloot.app</button>`}</div>
      <p class="muted small">${what} The key is kept in a file in your data folder and goes only to everloot.app.</p>
      <p class="muted small">Or make a key on ${ext(keys, "everloot.app")} and paste it:</p>
      <form id="accountForm" class="row" autocomplete="off"><input class="grow mono" type="password" name="key" placeholder="evl_…" aria-label="Everloot key" spellcheck="false"><button type="submit" class="btn btn-primary">Sign in</button></form>
    </section>`;
}

/** Everything the app can be set to, on one page: what runs, the AI model, the game folder, startup, the app itself. */
function settings(s: AppState): string {
  const st = s.settings;
  const c = data.chat;
  const jobs = JOB_ROWS.map((r) => `<div class="set-row"><div class="grow"><b>${r.label}</b><div class="muted small">${esc(r.what)} · <button type="button" class="link" data-page="${r.job}">details</button></div></div>${jobSwitch(r.job, s)}</div>`).join("");
  const keys = c?.providers.length
    ? c.providers.map((p) => {
      const inUse = c.provider?.kind === p.kind;
      return `<div class="set-row">${tile(p.kind)}<div class="grow"><b>${esc(presetFor(p.kind)?.name ?? p.kind)}</b><div class="muted small">${esc(p.model)}${inUse ? ' · <span class="ok">in use</span>' : ""}</div></div>
        ${inUse ? "" : `<button type="button" class="btn" data-usekind="${p.kind}" data-usemodel="${esc(p.model)}">Use</button>`}<button type="button" class="btn" data-removekind="${p.kind}">Remove</button></div>`;
    }).join("")
    : `<p class="muted small">${c && c.mode !== "plain search" ? `In use: ${esc(c.mode)}, from config.json written by hand.` : "No model yet: Chat and /ask answer with Everloot's top search hits as they are."}</p>`;
  return `<div class="page">
    <div class="head"><h1>Settings</h1></div>
    ${flash ? `<p role="status" class="${flash.startsWith("!") ? "error" : "ok"} small">${esc(flash.replace(/^!/, ""))}</p>` : ""}
    ${accountPanel(s)}
    <section class="panel"><h2>What runs</h2>${jobs}</section>
    <section class="panel"><div class="row between"><h2>AI model</h2>${pickOpen ? "" : `<button type="button" class="btn" data-addmodel>Add a provider key</button>`}</div>
      <p class="muted small">Your own key answers Chat and the in-game /ask. Each key is kept in a file in your data folder and goes only to its provider. Switch models from the menu under the Chat box too.</p>
      ${c ? keys : '<p class="muted small">Loading…</p>'}
      ${c && pickOpen ? providerForm(c) : ""}
    </section>
    <form id="settings" autocomplete="off">
      <section class="panel"><h2>Game</h2>
        <div class="field"><label for="gameFolder">Game folder <span class="hint">the product folder that holds <code>WTF</code>, like <code>World of Warcraft\\_classic_era_</code></span></label>
          <div class="row"><input class="grow" type="text" id="gameFolder" name="gameFolder" value="${esc(st.gameFolder ?? "")}"><button type="button" class="btn" id="browse">Browse…</button></div></div>
      </section>
      <section class="panel"><h2>Startup</h2>
        ${s.platform === "linux" ? "" : `<label class="switch"><input type="checkbox" name="launchAtLogin" ${st.launchAtLogin ? "checked" : ""}> Start when I sign in</label>`}
        <label class="switch"><input type="checkbox" name="startInTray" ${st.startInTray ? "checked" : ""}> Start in the tray without a window</label>
      </section>
      <section class="panel"><h2>Census</h2>
        <label class="switch"><input type="checkbox" name="census" ${st.census ? "checked" : ""}> Send census counts with the uploads</label>
        <p class="muted small">The race, class, level and faction of your characters and of players the addon sees. Never names, guilds, gear or places; the site shows only totals. Off keeps them in <code>Everloot.lua</code>; <code>/everloot census off</code> in the game stops recording and deletes them.</p>
      </section>
      <section class="panel"><h2>Player pages</h2>
        <label class="switch"><input type="checkbox" name="players" ${st.players ? "checked" : ""}> Send the player pages with the uploads</label>
        <p class="muted small">The name, realm, race, class, level and guild of the players the addon saw, so a page can be found by name. Off keeps them in <code>Everloot.lua</code>; <code>/everloot players off</code> in the game stops recording and deletes them.</p>
      </section>
      <details class="panel"><summary><h2>Advanced</h2></summary>
        <div class="field"><label for="endpoint">Site <span class="hint">change only to test against another deployment</span></label><input type="url" id="endpoint" name="endpoint" value="${esc(st.endpoint)}"></div>
      </details>
      <div class="row"><button type="submit" class="btn btn-primary">Save</button><span class="muted" id="saved"></span></div>
    </form>
    <section class="panel"><h2>This app</h2>
      <p class="fg2">Everloot Desktop App ${esc(s.version)} · AGPL-3.0-only · ${ext("https://github.com/Everloot/everloot/tree/main/desktop", "source")} · ${ext("https://discord.gg/9CKsbHTRu3", "Discord")}</p>
      <p class="muted small">Data folder: <span class="mono">${esc(s.dataFolder)}</span> <button type="button" class="link" id="openData">open</button></p>
      <div class="row"><button type="button" class="btn" id="updates">Check for updates</button></div>
    </section>
  </div>`;
}

// ---------- render and data ----------

const GEAR = `<svg class="gear" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M10.3 3h3.4l.5 2.4 1.7.9 2.3-.8 1.7 2.9-1.8 1.7v1.8l1.8 1.7-1.7 2.9-2.3-.8-1.7.9-.5 2.4h-3.4l-.5-2.4-1.7-.9-2.3.8-1.7-2.9 1.8-1.7v-1.8L4.1 8.4l1.7-2.9 2.3.8 1.7-.9Z"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;

function renderSide(s: AppState): void {
  const item = (id: string, label: string, job?: Job) => `<button type="button" data-page="${id}" ${id === page ? 'aria-current="page"' : ""}>${esc(label)}${job ? dot(s.engine.jobs[job]) : ""}</button>`;
  // The site's tools open in the browser; the app does not carry them.
  const web = WEBSITE_LINKS.map((l) => `<button type="button" class="out" data-open="${esc(websiteUrl(s.settings.endpoint, l.path))}">${esc(l.label)}<span class="ext" aria-hidden="true">↗</span><span class="sr-only"> (opens in your browser)</span></button>`).join("");
  nav.innerHTML = PAGES.filter((p) => p.id !== "settings").map((p) => item(p.id, p.label, p.job)).join("")
    + `<div class="section">On everloot.app</div>${web}`;
  const e = s.engine;
  // Ready to install: Restart gets its own row, the clearest thing in the footer.
  const ready = s.update?.newer && s.updateProgress.stage === "ready";
  const acct = s.account.signedIn
    ? `<button type="button" class="account-btn" id="accountBtn" title="Signed in to everloot.app">${PERSON}<span class="grow">Signed in</span><span class="muted small">key …${esc(s.account.hint ?? "")}</span></button>`
    : `<button type="button" class="account-btn" id="accountBtn">${PERSON}<span class="grow">Sign in</span><span class="muted small">everloot.app</span></button>`;
  sideFoot.innerHTML = `<div class="nav">${acct}</div>${ready ? `<div class="nav"><button type="button" class="restart-btn" id="updateRestart" title="Restart to install ${esc(s.update!.latest ?? "")}">${ARROW}Restart to update</button></div>` : ""}<div class="nav foot-row"><button type="button" data-page="settings" ${page === "settings" ? 'aria-current="page"' : ""}>${GEAR}Settings</button><button type="button" class="foot-icon" id="reportBug" aria-label="Report a bug" title="Report a bug">${BUG}</button>${updateButton(s)}</div>
    <div class="foot-line"><span>${e.files.length ? `Watching ${e.files.length} file(s)` : "Not watching"}${e.paused ? " · paused" : ""}</span><span>v${esc(s.version)}</span></div>`;
}

const PERSON = `<svg class="gear" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="10" r="3.2"/><path d="M6.4 18.6a6.5 6.5 0 0 1 11.2 0"/></g></svg>`;
const BUG = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8V7a3 3 0 0 1 6 0v1M12 12v8M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2"/></g></svg>`;

/**
 * The footer's update button: an arrow while an update is out, the percentage while it downloads,
 * and a Restart pill once it is ready to install.
 */
function updateButton(s: AppState): string {
  const up = s.update?.newer ? s.update : null;
  if (!up) return "";
  const p = s.updateProgress;
  // Ready: the Restart row above the footer takes over; the arrow stays to reopen what changed.
  const label = p.stage === "downloading" ? `Downloading update ${p.percent}%` : `Update ${esc(up.latest ?? "")} available`;
  return `<button type="button" class="update-btn${p.stage === "downloading" ? " busy" : ""}" id="updateBtn" aria-expanded="${updateOpen}" aria-controls="updatePop" aria-label="${label}" title="${label}">${p.stage === "downloading" ? `<span class="pct">${p.percent}</span>` : ARROW}</button>`;
}

const ARROW = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const NOTES_SHOWN = 8;

/** The update popover: the new version, what its release lists as changed, and this system's download. */
function updatePopover(u: NonNullable<AppState["update"]>, p: AppState["updateProgress"]): string {
  const notes = u.notes.slice(0, NOTES_SHOWN).map((n) => `<li><span class="note" title="${esc(n.text)}">${esc(n.text)}${n.author ? ` <span class="muted">by @${esc(n.author)}${n.pr ? ` in #${n.pr}` : ""}</span>` : ""}</span></li>`).join("");
  const more = u.notes.length > NOTES_SHOWN ? `${u.notes.length - NOTES_SHOWN} more changes on GitHub ↗` : "Release notes on GitHub ↗";
  return `<div class="pop-head"><h2 id="updTitle">Update available</h2><div class="muted small">${esc(u.latest ?? "")} · you run ${esc(u.current)}${u.publishedAt ? ` · released ${when(u.publishedAt)}` : ""}</div></div>
    <div class="pop-body"><h3>What's changed</h3>${notes ? `<ul>${notes}</ul>` : '<p class="muted small">This release lists no changes.</p>'}${u.url ? ext(u.url, more) : ""}</div>
    ${p.stage === "failed" ? `<p class="error small">The download failed: ${esc(p.error ?? "")}</p>` : ""}
    <div class="pop-foot">${updatePrimary(u, p)}<button type="button" class="btn" id="updateLater">Later</button></div>
    <p class="muted small">${u.installable
      ? "The update is checked against the release's published checksum before it installs. Your settings and data folder stay."
      : "Run the download to update; your settings and data folder stay. The app is not code-signed yet, so Windows asks once (More info, Run anyway)."}</p>`;
}

/** Download and install where this install can (the Windows installer), else the download in the browser. */
function updatePrimary(u: NonNullable<AppState["update"]>, p: AppState["updateProgress"]): string {
  if (!u.installable) return `<button type="button" class="btn btn-primary" data-open="${esc(u.downloadUrl ?? u.url ?? "")}">Download ${esc(u.latest ?? "")}</button>`;
  if (p.stage === "ready") return `<button type="button" class="btn btn-primary" id="updateRestartPop">Restart to update</button>`;
  if (p.stage === "downloading") return `<button type="button" class="btn btn-primary" disabled>Downloading ${p.percent}%</button>`;
  return `<button type="button" class="btn btn-primary" id="updateGet">${p.stage === "failed" ? "Try again" : `Download and install ${esc(u.latest ?? "")}`}</button>`;
}

function renderUpdate(s: AppState): void {
  const up = s.update?.newer ? s.update : null;
  if (!up) updateOpen = false;
  updatePop.hidden = !updateOpen;
  if (updateOpen && up) {
    const focused = document.activeElement?.id;
    updatePop.innerHTML = updatePopover(up, s.updateProgress);
    // Progress re-renders the panel; keep the reader where they were.
    if (focused) document.getElementById(focused)?.focus();
  }
}

function toggleUpdate(open: boolean): void {
  updateOpen = open;
  if (state) { renderSide(state); renderUpdate(state); }
  if (open) updatePop.querySelector<HTMLElement>(".btn-primary")?.focus();
  else document.getElementById("updateBtn")?.focus();
}

function render(): void {
  if (!state) return;
  const setup = !state.settings.consentedAt;
  side.hidden = setup;
  if (setup) { main.innerHTML = welcome(); return; }
  renderSide(state);
  renderUpdate(state);
  if ((page === "settings" || page === "ask") && draftDirty) return;
  const s = state;
  const draft = page === "chat" ? (main.querySelector("#chatText") as HTMLTextAreaElement | null)?.value : undefined;
  const realmDraft = (main.querySelector("#realmAdd") as HTMLInputElement | null)?.value;
  const drawerTab = drawerChar ? main.querySelector<HTMLElement>('[data-dwtab][aria-selected="true"]')?.dataset.dwtab ?? "overview" : null;
  const refocus = keepFocus();
  main.innerHTML = page === "overview" ? overview(s) : page === "chat" ? chat() : page === "characters" ? characters() : page === "upload" ? upload(s) : page === "market" ? market(s) : page === "ask" ? ask(s)
    : page === "addon" ? addon(s) : page === "changes" ? changes() : page === "log" ? log(s) : settings(s);
  // The page's CSP allows no inline style attributes; bar heights go through the DOM instead.
  for (const el of main.querySelectorAll<HTMLElement>("[data-h]")) el.style.height = `${el.dataset.h}%`;
  for (const el of main.querySelectorAll<HTMLElement>("[data-tile]")) { el.style.background = el.dataset.tile!; el.style.color = inkOn(el.dataset.tile!); }
  const realmBox = main.querySelector("#realmAdd") as HTMLInputElement | null;
  if (realmBox && realmDraft) realmBox.value = realmDraft;
  if (page === "characters" && drawerTab) reopenDrawer(drawerTab);
  refocus();
  // The drawer is modal: focus stays inside it.
  if (drawerChar && !main.querySelector("#drawerLayer")?.contains(document.activeElement)) main.querySelector<HTMLElement>(".drawer-close")?.focus();
  if (page === "chat") {
    const box = main.querySelector("#chatText") as HTMLTextAreaElement | null;
    if (box && draft) box.value = draft;
    const thread = main.querySelector("#thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }
}

async function load(p: Page): Promise<void> {
  try {
    if (p === "overview") { [data.addon, data.changes] = await Promise.all([api.addonInfo(), api.changes().catch((e) => { data.changesError = msg(e); return undefined; })]); data.market = await api.marketInfo(); }
    else if (p === "chat" || p === "settings") { data.chat = await api.chatInfo(); for (const own of data.chat.providers) loadModels(own.kind); }
    else if (p === "characters") data.characters = await api.charactersInfo();
    else if (p === "upload") [data.upload, data.backups] = await Promise.all([api.uploadInfo(), api.backups()]);
    else if (p === "market") data.market = await api.marketInfo();
    else if (p === "ask") data.ask = await api.askInfo();
    else if (p === "addon") data.addon = await api.addonInfo();
    else if (p === "changes") { try { data.changes = await api.changes(); data.changesError = undefined; } catch (e) { data.changesError = msg(e); } }
  } catch (e) { flash = `!${msg(e)}`; }
  if (p === page) render();
}

let reload: ReturnType<typeof setTimeout> | undefined;
const PAGE_IDS = new Set<string>(PAGES.map((p) => p.id));
// A tray entry or a notification asks for a page. A settings draft in progress is not thrown away for it.
api.onNavigate((p) => { if (PAGE_IDS.has(p) && !draftDirty && state?.settings.consentedAt) void go(p as Page); });

api.onState((s) => {
  state = s;
  render();
  // A finished job changes what the pages show; refresh the open one once things settle.
  if (reload) clearTimeout(reload);
  reload = setTimeout(() => void load(page), 800);
});

async function detect(): Promise<void> {
  candidates = await api.detectGameFolders();
  if (!chosenFolder && candidates[0]) chosenFolder = candidates[0].folder;
  render();
}

async function go(p: Page): Promise<void> {
  page = p; draftDirty = false; flash = ""; drawerChar = null; drawerOpener = null;
  render();
  void load(p);
}

/** Shows the question in the thread at once, then the answer when it comes. */
async function sendChat(question: string): Promise<void> {
  if (!question || data.chat?.busy) return;
  data.chat = { ...(data.chat ?? { messages: [], mode: "", mcpUrl: "", withToken: false, withAccountKey: false, provider: null, providers: [], error: null }), busy: true, messages: [...(data.chat?.messages ?? []), { role: "user", text: question, at: new Date().toISOString(), model: null, sources: [], steps: [] }] };
  live = null;
  render();
  try { data.chat = await api.chatSend(question); } finally { live = null; }
  // Stop was on the composer and goes with the answer; the question box takes the focus it had.
  const stopped = data.chat.messages.at(-1)?.stopped === true;
  const fromStop = document.activeElement?.id === "chatStop";
  render();
  if (fromStop) main.querySelector<HTMLElement>("#chatText")?.focus();
  if (stopped) { announcer.textContent = ""; setTimeout(() => { announcer.textContent = "Stopped"; }, 50); }
}

// The answer as it is written goes into its bubble only; the rest of the page stays as it is.
api.onChatProgress((p) => {
  live = p;
  const bubble = page === "chat" ? main.querySelector("#chatLive") : null;
  if (!bubble) return;
  const thread = main.querySelector("#thread")!;
  const atEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
  bubble.innerHTML = liveAnswer();
  if (atEnd) thread.scrollTop = thread.scrollHeight;
});

/** A polite live region: what a press did, for screen readers. */
const announcer = document.getElementById("announce")!;
/** Puts each Copy button's label in step with `copied` without rebuilding the thread. */
function paintCopy(): void {
  for (const b of main.querySelectorAll<HTMLElement>("[data-copy]")) b.textContent = copyLabel(Number(b.dataset.copy), copied);
}

const toast = document.getElementById("toast")!;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A short note in the same corner, for things that went right. */
function notice(text: string): void {
  toast.textContent = text;
  toast.classList.add("info");
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; toast.classList.remove("info"); }, 6000);
}

/** A call to the main side that failed where the page has no message line of its own: shown, then gone. */
function failed(e: unknown): void {
  toast.classList.remove("info");
  toast.textContent = msg(e);
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 8000);
  // A switch the save refused goes back to what is actually set; a form draft stays as typed.
  render();
}

document.body.addEventListener("click", (ev) => { onClick(ev).catch(failed); });
main.addEventListener("change", (ev) => { onChange(ev).catch(failed); });
main.addEventListener("submit", (ev) => { onSubmit(ev).catch(failed); });

async function onClick(ev: MouseEvent): Promise<void> {
  const el = ev.target as HTMLElement;
  if (el.closest("#updateBtn")) { toggleUpdate(!updateOpen); return; }
  if (el.closest("#updateLater")) { toggleUpdate(false); return; }
  if (el.closest("#updateGet")) { await api.updateDownload(); return; }
  if (el.closest("#updateRestart, #updateRestartPop")) { await api.updateRestart(); return; }
  if (el.closest("#accountBtn, [data-account]")) {
    if (page !== "settings") await go("settings");
    const panel = main.querySelector<HTMLElement>("#account");
    panel?.scrollIntoView({ block: "nearest" });
    (panel?.querySelector<HTMLElement>("input") ?? panel)?.focus();
    return;
  }
  if (el.closest("#connect")) {
    const attempt = ++connectAttempt;
    connecting = true;
    render();
    try {
      const next = await api.accountConnect();
      if (attempt !== connectAttempt) return;
      state = next;
      flash = "Signed in. Chat and /ask now use your account's limits, and your saved builds sync to the game (Addon page).";
    } catch (e) {
      // A second press or Cancel ends this wait; only the newest attempt reports.
      if (attempt !== connectAttempt) return;
      flash = `!${msg(e)}`;
    }
    connecting = false;
    render();
    return;
  }
  if (el.closest("#connectCancel")) { connectAttempt++; await api.accountConnectCancel(); connecting = false; render(); return; }
  if (el.closest("#accountSignOut")) { state = await api.accountSignOut(); flash = "Signed out on this computer. The key still works until you revoke it on everloot.app."; render(); return; }
  if (el.closest("#reportBug") && state) {
    const r = await api.reportBug(diagnostics(state));
    if (r === "copied") notice("Diagnostics copied. Paste them into the Discord #bug-reports channel or a GitHub issue.");
    return;
  }
  // A click anywhere outside the open popover closes it; its own links still work.
  if (updateOpen && !el.closest("#updatePop")) toggleUpdate(false);
  const row = el.closest<HTMLElement>("[data-char]");
  if (row) { selectChar(Number(row.dataset.char)); return; }
  const dwTab = el.closest<HTMLElement>("[data-dwtab]");
  if (dwTab) { renderDrawerTab(dwTab.dataset.dwtab!); return; }
  if (el.closest("[data-dwclose]")) { closeDrawer(); return; }
  if (el.id === "gotoKeyed") {
    closeDrawer();
    const keyed = main.querySelector<HTMLElement>("#keyed");
    if (keyed) { keyed.focus(); keyed.scrollIntoView({ block: "start" }); }
    return;
  }
  const t = el.closest<HTMLElement>("button");
  if (!t) return;
  if (t.dataset.page) { void go(t.dataset.page as Page); return; }
  if (t.dataset.ask) {
    // Not go(): its load("chat") would answer after the send and overwrite the busy thread.
    const question = t.dataset.ask;
    if (page !== "chat") { page = "chat"; draftDirty = false; flash = ""; }
    if (!data.chat) data.chat = await api.chatInfo();
    sendChat(question).catch(failed);
    return;
  }
  if (t.dataset.copy) {
    const index = Number(t.dataset.copy);
    const text = data.chat?.messages[index]?.text;
    if (text === undefined) return;
    let label = "Copied";
    try { await navigator.clipboard.writeText(text); } catch { label = "Copy failed"; }
    copied = { index, label };
    paintCopy();
    // Emptied first, so a second copy of the same answer is said again.
    announcer.textContent = "";
    setTimeout(() => { announcer.textContent = label; }, 50);
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied = null; paintCopy(); announcer.textContent = ""; }, 1500);
    return;
  }
  if (t.dataset.open) { void api.openExternal(t.dataset.open); return; }
  if (t.dataset.run) { void api.runNow(t.dataset.run as Job); return; }
  if (t.dataset.unfollow) { const gone = t.dataset.unfollow.toLowerCase(); state = await api.saveSettings({ market: { realms: state!.settings.market.realms.filter((r) => r.toLowerCase() !== gone) } }); void load("market"); return; }
  if (t.id === "pause") { await api.setPaused(!state!.engine.paused); return; }
  if (t.id === "chatStop") { await api.chatStop(); return; }
  if (t.id === "chatClear") { copied = null; data.chat = await api.chatClear(); render(); return; }
  if (t.id === "browse") {
    const folder = await api.pickGameFolder();
    if (!folder) return;
    if (state!.settings.consentedAt) { (main.querySelector("#gameFolder") as HTMLInputElement).value = folder; draftDirty = true; }
    else { chosenFolder = folder; render(); }
    return;
  }
  if (t.id === "pickToken") { const f = await api.pickTokenFile(); if (f) { (main.querySelector("#tokenFile") as HTMLInputElement).value = f; draftDirty = true; } return; }
  if (t.id === "redetect") { chosenFolder = null; await detect(); return; }
  if (t.id === "start" && chosenFolder) { state = await api.saveSettings({ gameFolder: chosenFolder, census: censusChoice, consentedAt: new Date().toISOString() }); void go("overview"); return; }
  if (t.id === "openConfig") { void api.openConfig(); return; }
  if (t.id === "openData") { void api.openDataFolder(); return; }
  if (t.id === "openAddons") { void api.openAddonsFolder(); return; }
  if (t.id === "realmAddBtn") {
    const input = main.querySelector("#realmAdd") as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    state = await api.saveSettings({ market: { realms: [...state!.settings.market.realms, name] } });
    input.value = "";
    void load("market");
    return;
  }
  if (t.id === "installAddon" && data.addon?.latest) {
    busy = "install"; flash = ""; render();
    try { const r = await api.installAddon(data.addon.latest.version); flash = `Installed ${r.version} (${r.files} files). /reload in game.`; }
    catch (e) { flash = `!${msg(e)}`; }
    busy = "";
    await load("addon");
    return;
  }
  if (t.id === "buildsSync") { state = await api.buildsSync(); await load("addon"); return; }
  if (t.id === "openBackups") { void api.openBackupsFolder(); return; }
  if (t.dataset.removekind) {
    try {
      data.chat = await api.chatRemoveProvider(t.dataset.removekind as ProviderKind);
      flash = data.chat.provider ? `Key removed. Chat now runs ${data.chat.mode}.` : "Key removed. Chat is back to search only.";
    } catch (e) { flash = `!${msg(e)}`; }
    render();
    return;
  }
  if (t.hasAttribute("data-addmodel")) { openProviderForm(null); return; }
  if (t.dataset.usekind && t.dataset.usemodel) {
    data.chat = await api.chatUseModel(t.dataset.usekind as ProviderKind, t.dataset.usemodel);
    flash = `Chat and /ask now use ${data.chat.provider?.model ?? t.dataset.usemodel}.`;
    render();
    return;
  }
  if (t.id === "cancelProvider") { pickOpen = false; render(); return; }
  if (t.id === "copyDiag" && state) {
    try { await navigator.clipboard.writeText(diagnostics(state)); flash = "Copied. Paste it into the bug report."; }
    catch (e) { flash = `!Could not copy: ${msg(e)}`; }
    render();
    return;
  }
  if (t.dataset.restore) {
    busy = t.dataset.restore; flash = ""; render();
    try { const live = await api.restoreBackup(t.dataset.restore); flash = live ? `Restored ${account(live)}. Log in to see it.` : ""; }
    catch (e) { flash = `!${msg(e)}`; }
    busy = "";
    await load("upload");
    return;
  }
  if (t.id === "updates") {
    flash = "Checking…"; render();
    try {
      const u = await api.checkForUpdates();
      flash = u.latest ? (u.newer ? `${u.latest} is available.` : `${u.current} is the newest.`) : "No desktop release yet.";
      if (u.newer && u.url) void api.openExternal(u.url);
    } catch (e) { flash = `Could not check: ${msg(e)}`; }
    render();
  }
}

async function onChange(ev: Event): Promise<void> {
  const el = ev.target as HTMLInputElement;
  if (el.id === "censusConsent") { censusChoice = el.checked; return; }
  if (el.id === "agree") { agreed = el.checked; render(); return; }
  if (el.id === "providerKind") { pickKind = el.value as ProviderKind; loadModels(pickKind); render(); return; }
  if (el.id === "modelPick") {
    const v = el.value;
    if (v === "add") { openProviderForm(null); return; }
    if (v === "manage") { openProviderForm(data.chat?.provider?.kind ?? data.chat?.providers[0]?.kind ?? null); return; }
    const [kind, ...rest] = v.split("|");
    if (!kind || !rest.length) return;
    data.chat = await api.chatUseModel(kind as ProviderKind, rest.join("|"));
    flash = "";
    render();
    return;
  }
  if (el.dataset.toggle) {
    const job = el.dataset.toggle as Job;
    state = await api.saveSettings(job === "ask" ? { ask: { ...state!.settings.ask, enabled: el.checked } } : { [job]: el.checked });
    render();
    return;
  }
  if (el.dataset.realm) {
    const realm = el.dataset.realm;
    const current = state!.settings.market.realms.filter((r) => r.toLowerCase() !== realm.toLowerCase());
    state = await api.saveSettings({ market: { realms: el.checked ? [...current, realm] : current } });
    void load("market");
    return;
  }
  if (el.name === "folder") { chosenFolder = el.value; render(); return; }
  if (el.form && el.form.id !== "chatForm" && el.form.id !== "providerForm") draftDirty = true;
}
main.addEventListener("input", (ev) => { const f = (ev.target as HTMLElement).closest("form"); if (f && f.id !== "chatForm" && f.id !== "providerForm") draftDirty = true; });
// Escape closes the update popover from anywhere.
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && updateOpen) { ev.preventDefault(); toggleUpdate(false); } });
main.addEventListener("keydown", (ev) => {
  const el = ev.target as HTMLElement;
  if (el.id === "chatText" && ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); (main.querySelector("#chatForm") as HTMLFormElement).requestSubmit(); return; }
  const row = el.closest<HTMLElement>("[data-char]");
  if (row && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); selectChar(Number(row.dataset.char)); return; }
  const layer = main.querySelector<HTMLElement>("#drawerLayer");
  if (layer && !layer.hidden) {
    if (ev.key === "Escape") { ev.preventDefault(); closeDrawer(); return; }
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      const tabs = [...layer.querySelectorAll<HTMLElement>("[data-dwtab]")];
      const i = tabs.indexOf(el);
      if (i >= 0) { ev.preventDefault(); const next = tabs[(i + (ev.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; next.focus(); renderDrawerTab(next.dataset.dwtab!); }
      return;
    }
    if (ev.key === "Tab") {
      const f = [...layer.querySelectorAll<HTMLElement>(".drawer button")].filter((b) => b.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    }
  }
});

async function onSubmit(ev: SubmitEvent): Promise<void> {
  const form = ev.target as HTMLFormElement;
  ev.preventDefault();
  const f = new FormData(form);
  const text = (k: string) => String(f.get(k) ?? "").trim();
  if (form.id === "providerForm") {
    const model = text("model") || text("modelText");
    if (!model && f.has("model")) { flash = "!Type the model id, or pick one from the list"; render(); return; }
    try {
      data.chat = await api.chatSetProvider({ kind: pickKind, key: text("key"), model, baseUrl: text("baseUrl") });
      // A new key may see other models: ask again.
      loadModels(pickKind, true);
      pickOpen = false; flash = `Saved. Chat now runs ${data.chat.mode}.`;
    } catch (e) { flash = `!${msg(e)}`; }
    render();
    return;
  }
  if (form.id === "accountForm") {
    try { state = await api.accountSignIn(String(f.get("key") ?? "")); flash = "Signed in. Chat and /ask now use your account's limits, and your saved builds sync to the game (Addon page)."; }
    catch (e) { flash = `!${msg(e)}`; }
    draftDirty = false;
    render();
    return;
  }
  if (form.id === "priceForm") {
    priceLookup = await api.marketLookup(text("priceItem") || String(f.get("priceItem") ?? ""));
    render();
    return;
  }
  if (form.id === "chatForm") {
    const box = main.querySelector("#chatText") as HTMLTextAreaElement;
    const question = box.value.trim();
    if (!question || data.chat?.busy) return;
    box.value = "";
    sendChat(question).catch(failed);
    return;
  }
  if (form.id === "settings") {
    state = await api.saveSettings({ gameFolder: text("gameFolder") || null, endpoint: text("endpoint"), launchAtLogin: f.get("launchAtLogin") === "on", startInTray: f.get("startInTray") === "on", census: f.get("census") === "on", players: f.get("players") === "on" });
  } else if (form.id === "askForm") {
    state = await api.saveSettings({ ask: { ...state!.settings.ask, mcpUrl: text("mcpUrl"), tokenFile: text("tokenFile") || null } });
  }
  draftDirty = false;
  render();
  const saved = main.querySelector("#saved");
  if (saved) saved.textContent = "Saved.";
}

void (async () => {
  state = await api.state();
  if (!state.settings.consentedAt) await detect();
  render();
  void load(page);
})();
