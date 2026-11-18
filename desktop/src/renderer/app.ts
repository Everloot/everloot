import { reportsView } from "./reports";
import type { ReportQuery } from "../shared/reports";
import { accountOf as account } from "../main/engine";
import { diagnostics } from "../shared/diagnostics";
import { answerSuggestion, copyLabel, esc, msg, savedNote } from "./format";
import type { AppState, CharacterRow, ChatProgress, EverlootApi, PriceLookup, GameFolderCandidate, Job } from "../shared/types";
import { removalNotice, type ModelChoice, type ProviderKind } from "../shared/providers";
import { inkOn } from "../../../web/src/lib/chat/catalogue";
import { WEBSITE_LINKS, websiteUrl } from "../shared/website";
import { statePill, watchPill } from "./parts";
import { addon, ask, assistantSetup, changes, characters, chat, drawerHistory, drawerOverview, drawerShare, drawn, icon, liveAnswer, log, market, modelMenu, overview, restartDialog, settings, updateButton, updatePopover, updateReady, upload, welcome, wipeDialog, type PageData, type ProviderDraft, type SetupAddon, type View, type Wipe } from "./pages";

declare global { interface Window { everloot: EverlootApi } }
const api = window.everloot;

type Page = "reports" | "overview" | "chat" | "characters" | "upload" | "market" | "ask" | "addon" | "changes" | "log" | "settings";
const PAGES: { id: Page; label: string; job?: Job }[] = [
  { id: "overview", label: "Overview" },
  { id: "chat", label: "Chat" },
  { id: "characters", label: "Characters" },
  { id: "reports", label: "Reports" },
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
let playersChoice = true;
/** The welcome screen's addon check for the picked folder: the installed version (null: not there) and what Install did ("!" starts an error). */
let setupAddon: SetupAddon | null = null;
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
/** What was typed in the open provider form, kept in memory only (never saved or logged) so a redraw does not eat it. Same provider only. */
let providerDraft: ProviderDraft | null = null;
/** The control the provider form was opened from, so Cancel and Save hand the focus back to it. */
let setupOpener = "#assistantOpen";
/** What the last setup action did, shown inside the Assistant panel so it is seen even while another form on the page is unsaved. "!" starts an error. */
let setupNote = "";
/** Ask's Advanced disclosure: null until the player opens or closes it, so a saved private configuration starts open and a choice then holds across redraws. */
let advancedOpen: boolean | null = null;
/** Each provider's models as the provider listed them, once asked (api.chatModels); the catalogue's until then. */
const liveModels: Partial<Record<ProviderKind, ModelChoice[]>> = {};
const askedModels = new Set<ProviderKind>();
/** The Chat page's own scrolling regions; a background redraw puts them back where they were, as it does the page's own scroll. */
const CHAT_SCROLLERS = [".page.chat", ".chat-top"] as const;
/** Set when the player navigates or opens the provider form, so the next redraw does not keep the scroll positions. */
let freshScroll = false;
/** Bumped by navigation, each lookup and typing in the price box; a finished lookup clears the box only if none of these happened meanwhile. */
let priceEdits = 0;
/** The answer being written while a chat question is out; null otherwise. */
let live: ChatProgress | null = null;
/** The Copy button just pressed and how it went, kept for its 1.5 s across a redraw of the thread. */
let copied: { index: number; label: string } | null = null;
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
/** The Market page's last price lookup; null before the first. */
let priceLookup: PriceLookup | null = null;
let reportQuery: ReportQuery = {};
let reportPage = 0;
let reportRequest = 0;
const data: PageData = {};

/** The window's own state as the pages read it, taken when a page is built. */
const view = (): View => ({ state, data, candidates, chosenFolder, censusChoice, playersChoice, setupAddon, agreed, connecting, busy, flash, pickKind, pickOpen, providerDraft, setupNote, advancedOpen, liveModels, live, copied, priceLookup, charPick, wipe });

const main = document.getElementById("app")!;
const bar = document.getElementById("bar")!;
const side = document.getElementById("side")!;
const nav = document.getElementById("nav")!;
const sideFoot = document.getElementById("side-foot")!;
const updatePop = document.getElementById("updatePop")!;
/** Whether the update popover is open. */
let updateOpen = false;
/** The update notification asked for the popover before the first state arrived. */
let updateAsked = false;
const restartDlg = document.getElementById("restartDlg") as HTMLDialogElement;
const wipeDlg = document.getElementById("wipeDlg") as HTMLDialogElement;
/** Delete my local data: asking, deleting, or showing what another program kept open. */
let wipe: Wipe = { stage: "ask", left: [], error: "" };
/** Restart was confirmed and the app is handing over to the installer. */
let restarting = false;

/** Shows the typed model id only when "Another model id…" is picked or the provider has no list, and never leaves the focus in a box that was just hidden. */
function syncManualModel(): void {
  const form = main.querySelector<HTMLFormElement>("#providerForm");
  const box = form?.querySelector<HTMLElement>("#providerModelField");
  const input = form?.elements.namedItem("modelText") as HTMLInputElement | null;
  if (!form || !box || !input) return;
  const pick = form.elements.namedItem("model") as HTMLSelectElement | null;
  const show = !pick || pick.value === "";
  box.hidden = !show;
  input.disabled = !show;
  if (!show && document.activeElement === input) pick?.focus({ preventScroll: true });
}

/**
 * Asks the provider, through the main side, which models it serves now, once per provider; the open form's list and
 * the model menu are swapped in when it answers, with what was typed in the form kept.
 */
function loadModels(kind: ProviderKind, again = false): void {
  if (askedModels.has(kind) && !again) return;
  askedModels.add(kind);
  void api.chatModels(kind).then((models) => {
    if (!models) return;
    liveModels[kind] = models;
    if (pickOpen && pickKind === kind) renderAssistant();
    const menu = main.querySelector<HTMLSelectElement>("#modelPick");
    if (menu && data.chat && !data.chat.busy && document.activeElement !== menu) menu.outerHTML = modelMenu(data.chat, liveModels);
  }).catch(() => { askedModels.delete(kind); });
}

/** Opens the provider form on a provider, or on the first one not saved yet (OpenRouter first: one key, cheap and free models). */
function openProviderForm(kind: ProviderKind | null): void {
  const saved = new Set(data.chat?.providers.map((p) => p.kind));
  const order: ProviderKind[] = ["openrouter", "anthropic", "opencode", "ollama", "custom"];
  const next = kind ?? order.find((k) => !saved.has(k)) ?? "openrouter";
  if (next !== pickKind) dropProviderDraft();
  setupOpener = document.activeElement?.id === "modelPick" ? "#modelPick" : "#assistantOpen";
  pickKind = next;
  pickOpen = true; setupNote = ""; freshScroll = true;
  loadModels(pickKind);
  render();
  main.querySelector<HTMLElement>("#providerKind")?.focus();
}

/** Closes the provider form and puts the focus back on what opened it, which is drawn again by then. */
function closeProviderForm(): void {
  pickOpen = false;
  dropProviderDraft();
  render();
  (main.querySelector<HTMLElement>(setupOpener) ?? main.querySelector<HTMLElement>("#assistantOpen"))?.focus();
}

/** Forgets the typed provider fields, and blanks the form so the next redraw cannot read them back (a provider change, Cancel or a save). */
function dropProviderDraft(): void {
  providerDraft = null;
  main.querySelector<HTMLFormElement>("#providerForm")?.reset();
}

/** Called before the page is rebuilt: keeps the open form's fields for the provider being edited. */
function holdProviderDraft(): void {
  const form = main.querySelector<HTMLFormElement>("#providerForm");
  if (!form || !pickOpen) return;
  const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
  // No model list yet is not a pick: when one arrives it starts on its default, unless an id was already typed, which is "Another model id…".
  const model = form.elements.namedItem("model") ? field("model") : field("modelText").trim() ? "" : null;
  providerDraft = { kind: pickKind, key: field("key"), baseUrl: field("baseUrl"), model, modelText: field("modelText") };
}

/** Puts the held fields back into a rebuilt form when it is for the same provider. */
function restoreProviderDraft(): void {
  const form = main.querySelector<HTMLFormElement>("#providerForm");
  if (!form || !providerDraft || providerDraft.kind !== pickKind) return;
  for (const name of ["key", "baseUrl", "model", "modelText"] as const) {
    const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    const held = providerDraft[name];
    if (!el || held === null) continue;
    // A model list that no longer has the pick keeps the new default.
    if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === held)) continue;
    el.value = held;
  }
  syncManualModel();
}

/**
 * Redraws only the Assistant panel, with its typed fields, focus and the page's scroll kept. A Settings or Ask page
 * with unsaved fields is not rebuilt (render() returns early), so the panel is the one part that still moves: a form
 * opening, a late model list, a saved or refused provider.
 */
function renderAssistant(): void {
  const host = main.querySelector<HTMLElement>("#assistant");
  const keepScroll = !freshScroll;
  freshScroll = false;
  if (!host) return;
  holdProviderDraft();
  const html = assistantSetup(data.chat, page === "ask" ? "ask" : page === "settings" ? "settings" : "chat", view());
  if (html === drawn.assistant) return;
  const pageTop = keepScroll ? main.scrollTop : null;
  const scrolls = page === "chat" && keepScroll ? CHAT_SCROLLERS.map((sel) => [sel, main.querySelector(sel)?.scrollTop ?? 0] as const) : [];
  const refocus = keepFocus();
  host.outerHTML = html;
  drawn.assistant = html;
  paintTiles();
  restoreProviderDraft();
  refocus();
  if (pageTop !== null) main.scrollTop = pageTop;
  for (const [sel, top] of scrolls) { const el = main.querySelector(sel); if (el) el.scrollTop = top; }
}

/** Paints each provider tile its colour and ink; the page's CSP allows no inline styles. */
function paintTiles(): void {
  for (const el of main.querySelectorAll<HTMLElement>("[data-tile]")) { el.style.background = el.dataset.tile!; el.style.color = inkOn(el.dataset.tile!); }
}

/** The picked character (character\0realm) and the open drawer, kept across re-renders. */
let charPick: string | null = null;
let drawerChar: CharacterRow | null = null;
let drawerOpener: HTMLElement | null = null;

function selectChar(i: number): void {
  const c = data.characters?.characters[i];
  if (!c) return;
  charPick = c.id;
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
  // Only a drawer the player just opened slides in; a background rebuild reopens it in place.
  layer.querySelector(".drawer")?.classList.toggle("enter", focus);
  if (focus) main.querySelector<HTMLElement>(".drawer-close")?.focus();
}

/** After the page is rebuilt (a job finished, the data refreshed), the open drawer comes back on the same character and tab. */
function reopenDrawer(tab: string): void {
  const was = drawerChar!;
  const rows = data.characters?.characters ?? [];
  const i = rows.findIndex((r) => r.id === was.id);
  if (i < 0) { drawerChar = null; drawerOpener = null; return; }
  openDrawer(rows[i], main.querySelector<HTMLElement>(`[data-char="${i}"]`), tab, false);
}

/** Remembers the focused control by its id or data attribute and returns the call that focuses it again after a rebuild. */
function keepFocus(): () => void {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !main.contains(el)) return () => {};
  const attrs = ["data-page", "data-run", "data-char", "data-dwtab", "data-copy", "data-toggle", "data-realm", "data-unfollow", "data-restore", "data-open", "data-ask", "data-addmodel", "data-removekind", "data-usekind", "data-advanced"];
  const sel = el.id ? `#${CSS.escape(el.id)}`
    : attrs.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a)!)}"]`)[0]
      ?? (el.classList.contains("drawer-close") ? ".drawer-close" : null);
  // A text box also keeps its caret or selection; the value must be back in the box before this runs.
  const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
  const range = text && text.selectionStart !== null && text.selectionEnd !== null ? { start: text.selectionStart, end: text.selectionEnd, dir: text.selectionDirection ?? "none" } : null;
  return () => {
    const next = sel ? main.querySelector<HTMLElement>(sel) : null;
    if (!sel || !next || document.activeElement === next) return;
    next.focus({ preventScroll: true });
    if (range && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) && next.type !== "checkbox" && next.value.length >= range.end) next.setSelectionRange(range.start, range.end, range.dir);
  };
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

// ---------- render and data ----------

const GEAR = icon("settings");

function renderSide(s: AppState): void {
  // The rail is rebuilt on every state update; the focused control comes back by its id or destination.
  const was = document.activeElement as HTMLElement | null;
  const refocus = was && side.contains(was)
    ? (was.id ? `#${CSS.escape(was.id)}` : was.dataset.page ? `[data-page="${CSS.escape(was.dataset.page)}"]` : was.dataset.open ? `[data-open="${CSS.escape(was.dataset.open)}"]` : null)
    : null;
  const item = (id: string, label: string, job?: Job) => {
    const j = job ? s.engine.jobs[job] : null;
    // The pill says the job's state in a word, so a screen reader hears it with the label.
    return `<button type="button" data-page="${id}" ${id === page ? 'aria-current="page"' : ""}>${icon(id)}<span class="grow">${esc(label)}</span>${j ? statePill(j, s.engine.paused) : ""}</button>`;
  };
  // The site's tools open in the browser; the app does not carry them.
  const web = WEBSITE_LINKS.map((l) => `<button type="button" class="out" data-open="${esc(websiteUrl(s.settings.endpoint, l.path))}"><span class="grow">${esc(l.label)}<span class="sr-only"> (opens in your browser)</span></span>${icon("external", "ico ext")}</button>`).join("");
  const group = (id: string, label: string | null, body: string) => `<div class="nav-group" role="group" ${label ? `aria-labelledby="ng-${id}"` : `aria-label="Main"`}>${label ? `<div class="section" id="ng-${id}">${label}</div>` : ""}${body}</div>`;
  const pages = (ids: Page[]) => ids.map((id) => PAGES.find((p) => p.id === id)!).map((p) => item(p.id, p.label, p.job)).join("");
  nav.innerHTML = group("main", null, pages(["overview", "chat", "characters", "reports"]))
    + group("companion", "Companion", pages(["upload", "market", "ask", "addon", "changes", "log"]))
    + group("web", "On everloot.app", web);
  const e = s.engine;
  const acct = s.account.signedIn
    ? `<button type="button" class="account-btn" id="accountBtn" title="Signed in to everloot.app">${PERSON}<span class="acct-text"><b>Signed in</b><span>key …${esc(s.account.hint ?? "")}</span></span></button>`
    : `<button type="button" class="account-btn" id="accountBtn">${PERSON}<span class="acct-text"><b>Sign in</b><span>everloot.app</span></span></button>`;
  sideFoot.innerHTML = `${acct}<div class="foot-row"><button type="button" data-page="settings" ${page === "settings" ? 'aria-current="page"' : ""}>${GEAR}Settings</button><button type="button" class="foot-icon" id="reportBug" aria-label="Report a bug" title="Report a bug">${BUG}</button>${updateButton(s, updateOpen)}</div>
    <div class="foot-line"><span>Everloot</span><span>v${esc(s.version)}</span></div>`;
  paintBars(sideFoot);
  if (refocus) side.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
}

/** The title bar: where the player is, and what the app watches. It is draggable like a native title. */
function renderBar(s: AppState): void {
  const label = PAGES.find((p) => p.id === page)?.label ?? "";
  bar.innerHTML = `<nav class="crumb" aria-label="Where you are"><span>Everloot</span><span class="sep" aria-hidden="true">/</span><strong>${esc(label)}</strong></nav>${watchPill(s.engine)}`;
}

const PERSON = icon("account");
const BUG = icon("bug");

function paintBars(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-w]")) el.style.width = `${el.dataset.w}%`;
}

function renderUpdate(s: AppState): void {
  const up = s.update?.newer ? s.update : null;
  if (!up) updateOpen = false;
  updatePop.hidden = !updateOpen;
  if (updateOpen && up) {
    const focused = document.activeElement?.id;
    updatePop.innerHTML = updatePopover(up, s.updateProgress);
    paintBars(updatePop);
    // Progress re-renders the panel; keep the reader where they were.
    if (focused) document.getElementById(focused)?.focus();
  }
}

function renderRestart(s: AppState): void {
  if (!restartDlg.open) return;
  // A newer release or a failed check takes the download back; the sidebar then says which.
  if (s.updateProgress.stage !== "ready" || !s.update?.newer) { closeRestart(); return; }
  const focused = document.activeElement?.id;
  restartDlg.innerHTML = restartDialog(s, restarting);
  if (focused) document.getElementById(focused)?.focus();
}

function openRestart(): void {
  if (!state || restartDlg.open) return;
  if (updateOpen) toggleUpdate(false);
  restarting = false;
  restartDlg.innerHTML = restartDialog(state, restarting);
  restartDlg.showModal();
  restartDlg.querySelector<HTMLElement>("#restartGo")?.focus();
}

function closeRestart(): void {
  restarting = false;
  if (restartDlg.open) restartDlg.close();
}

function renderWipe(s: AppState): void {
  if (!wipeDlg.open) return;
  const focused = document.activeElement?.id;
  wipeDlg.innerHTML = wipeDialog(s, view());
  if (focused) document.getElementById(focused)?.focus();
}

function openWipe(): void {
  if (!state || wipeDlg.open) return;
  wipe = { stage: "ask", left: [], error: "" };
  wipeDlg.innerHTML = wipeDialog(state, view());
  wipeDlg.showModal();
  // Cancel takes the focus: the safe choice is the one Enter presses.
  wipeDlg.querySelector<HTMLElement>("#wipeCancel")?.focus();
}

/** Once deleting has begun the dialog stays: the jobs are stopped and the app must start over. */
function closeWipe(): void {
  if (wipe.stage !== "ask") return;
  if (wipeDlg.open) wipeDlg.close();
  document.getElementById("wipeOpen")?.focus();
}

async function runWipe(): Promise<void> {
  if (!state) return;
  const was = wipe.stage;
  wipe = { ...wipe, stage: "deleting", error: "" };
  renderWipe(state);
  try {
    // On success the app starts over and this window goes with it.
    const left = await api.deleteLocalData();
    wipe = { stage: "left", left, error: "" };
  } catch (e) {
    wipe = { ...wipe, stage: was, error: msg(e) };
  }
  renderWipe(state);
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
  bar.hidden = setup;
  if (setup) { main.innerHTML = welcome(view()); return; }
  renderSide(state);
  renderBar(state);
  renderUpdate(state);
  renderRestart(state);
  renderWipe(state);
  // Unsaved fields on Settings or Ask are not rebuilt; the Assistant panel beside them still moves.
  if ((page === "settings" || page === "ask") && draftDirty) { renderAssistant(); return; }
  const s = state;
  const draft = page === "chat" ? (main.querySelector("#chatText") as HTMLTextAreaElement | null)?.value : undefined;
  const realmDraft = (main.querySelector("#realmAdd") as HTMLInputElement | null)?.value;
  const priceDraft = (main.querySelector("#priceItem") as HTMLInputElement | null)?.value;
  holdProviderDraft();
  // The page scroll is put back too: the browser's scroll anchoring otherwise walks a scrolled Settings form down a little at every redraw.
  const keepScroll = !freshScroll;
  freshScroll = false;
  const pageTop = keepScroll ? main.scrollTop : null;
  const scrolls = page === "chat" && keepScroll ? CHAT_SCROLLERS.map((sel) => [sel, main.querySelector(sel)?.scrollTop ?? 0] as const) : [];
  const drawerTab = drawerChar ? main.querySelector<HTMLElement>('[data-dwtab][aria-selected="true"]')?.dataset.dwtab ?? "overview" : null;
  const refocus = keepFocus();
  const v = view();
  main.innerHTML = page === "reports" ? reportsView(data.reports, reportQuery, reportPage) : page === "overview" ? overview(s, v) : page === "chat" ? chat(v) : page === "characters" ? characters(v) : page === "upload" ? upload(s, v) : page === "market" ? market(s, v) : page === "ask" ? ask(s, v)
    : page === "addon" ? addon(s, v) : page === "changes" ? changes(v) : page === "log" ? log(s, v) : settings(s, v);
  // The page's CSP allows no inline style attributes; bar heights go through the DOM instead.
  for (const el of main.querySelectorAll<HTMLElement>("[data-h]")) el.style.height = `${el.dataset.h}%`;
  paintTiles();
  const realmBox = main.querySelector("#realmAdd") as HTMLInputElement | null;
  if (realmBox && realmDraft) realmBox.value = realmDraft;
  const priceBox = main.querySelector("#priceItem") as HTMLInputElement | null;
  if (priceBox && priceDraft) priceBox.value = priceDraft;
  restoreProviderDraft();
  const chatBox = main.querySelector("#chatText") as HTMLTextAreaElement | null;
  if (chatBox && draft) chatBox.value = draft;
  if (page === "characters" && drawerTab) reopenDrawer(drawerTab);
  // Values first, so the caret goes back into the text that is already there.
  refocus();
  if (pageTop !== null) main.scrollTop = pageTop;
  for (const [sel, top] of scrolls) { const el = main.querySelector(sel); if (el) el.scrollTop = top; }
  // The drawer is modal: focus stays inside it.
  if (drawerChar && !main.querySelector("#drawerLayer")?.contains(document.activeElement)) main.querySelector<HTMLElement>(".drawer-close")?.focus();
  if (page === "chat") {
    const thread = main.querySelector("#thread");
    // An empty thread shows its starters from the top; a transcript is read from its end.
    if (thread && !thread.querySelector(".chat-empty")) thread.scrollTop = thread.scrollHeight;
  }
}

async function load(p: Page): Promise<void> {
  try {
    if (p === "overview") { [data.addon, data.changes, data.usage] = await Promise.all([api.addonInfo(), api.changes().catch((e) => { data.changesError = msg(e); return undefined; }), api.dataUsage().catch(() => undefined)]); data.market = await api.marketInfo(); }
    else if (p === "chat" || p === "settings") {
      if (p === "settings") data.usage = await api.dataUsage();
      data.chat = await api.chatInfo(); for (const own of data.chat.providers) loadModels(own.kind);
    }
    else if (p === "ask") { [data.ask, data.chat] = await Promise.all([api.askInfo(), api.chatInfo()]); for (const own of data.chat.providers) loadModels(own.kind); }
    else if (p === "reports") { const request = ++reportRequest; const result = await api.reportsInfo(reportQuery); if (request === reportRequest) data.reports = result; }
    else if (p === "characters") data.characters = await api.charactersInfo();
    else if (p === "upload") [data.upload, data.backups] = await Promise.all([api.uploadInfo(), api.backups()]);
    else if (p === "market") data.market = await api.marketInfo();
    else if (p === "addon") data.addon = await api.addonInfo();
    else if (p === "changes") { try { data.changes = await api.changes(); data.changesError = undefined; } catch (e) { data.changesError = msg(e); } }
  } catch (e) { flash = `!${msg(e)}`; }
  if (p === page) render();
}

let reload: ReturnType<typeof setTimeout> | undefined;
const PAGE_IDS = new Set<string>(PAGES.map((p) => p.id));
// A tray entry or a notification asks for a page. A settings draft in progress is not thrown away for it.
api.onNavigate((p) => {
  // The update notification and the tray's update item open the update panel over whatever page is showing.
  // A window opened for it may not have its first state yet; the panel opens once it does.
  if (p === "update") { if (!state) updateAsked = true; else if (state.update?.newer) toggleUpdate(true); return; }
  if (PAGE_IDS.has(p) && !draftDirty && state?.settings.consentedAt) void go(p as Page);
});

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
  void checkSetupAddon();
}

/** Looks for the addon in the folder the welcome screen has picked; a check that fails shows nothing. */
async function checkSetupAddon(): Promise<void> {
  const folder = chosenFolder;
  if (!folder) return;
  const installed = await api.setupAddon(folder).catch(() => undefined);
  if (installed === undefined || folder !== chosenFolder) return;
  setupAddon = { folder, installed, note: setupAddon?.folder === folder ? setupAddon.note : "" };
  render();
}

/** After a provider changes while Ask is open, its summary is read again so the old chain or error does not linger. */
async function refreshAsk(): Promise<void> {
  if (page === "ask") data.ask = await api.askInfo().catch(() => data.ask);
}

async function go(p: Page): Promise<void> {
  page = p; draftDirty = false; flash = ""; setupNote = ""; drawerChar = null; drawerOpener = null; freshScroll = true; priceEdits++;
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
  bubble.innerHTML = liveAnswer(live);
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
  if (el.closest("#updateBtn")) { if (state && updateReady(state)) openRestart(); else toggleUpdate(!updateOpen); return; }
  if (el.closest("#updateLater")) { toggleUpdate(false); return; }
  if (el.closest("#updateGet, #updateNowCallout")) { await api.updateDownload(); return; }
  if (el.closest("#updateRestartPop, #updateRestartCallout")) { openRestart(); return; }
  if (el.closest("#restartCancel")) { closeRestart(); return; }
  if (el.closest("#wipeOpen")) { openWipe(); return; }
  if (el.closest("#wipeCancel")) { closeWipe(); return; }
  if (el.closest("#wipeGo") && wipe.stage !== "deleting") { await runWipe(); return; }
  if (el.closest("#wipeRelaunch")) { await api.relaunch(); return; }
  if (el.closest("#dataNoticeOpen")) {
    await go("settings");
    const panel = main.querySelector<HTMLElement>("#data");
    panel?.scrollIntoView({ block: "start" });
    panel?.focus();
    return;
  }
  if (el.closest("#dataNoticeDismiss")) {
    state = await api.saveSettings({ dataNoticeDismissed: true });
    if (data.usage) data.usage = { ...data.usage, notice: false };
    render();
    return;
  }
  if (el.closest("#restartGo") && !restarting) {
    restarting = true;
    if (state) renderRestart(state);
    // On success the app quits; otherwise the dialog closes and the sidebar shows what happened.
    let started = false;
    try { started = await api.updateRestart(); } finally { if (!started) closeRestart(); }
    return;
  }
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
    if (r === "copied") notice("Diagnostics copied. Paste them into a Discord #help post tagged Bug, or a GitHub issue.");
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
  const adv = el.closest<HTMLElement>("#askAdvanced > summary");
  if (adv) { advancedOpen = !(adv.parentElement as HTMLDetailsElement).open; return; }
  const t = el.closest<HTMLElement>("button");
  if (!t) return;
  if (t.dataset.page === "reports-reset") { reportQuery = {}; reportPage = 0; await load("reports"); return; }
  if (t.id === "reportPrevious" || t.id === "reportNext") { reportPage = Math.max(0, reportPage + (t.id === "reportNext" ? 1 : -1)); render(); return; }
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
  if (t.dataset.open) {
    const url = t.dataset.open;
    if (await api.openExternal(url)) return;
    const refused = `!Your browser could not be opened from here. Copy this address into it: ${url}`;
    if (t.closest("#assistant")) { setupNote = refused; render(); } else failed(new Error(refused.slice(1)));
    return;
  }
  if (t.dataset.run) { void api.runNow(t.dataset.run as Job); return; }
  if (t.dataset.suggestion) {
    state = await api.saveSettings(answerSuggestion(state!.settings.market, data.market?.suggested ?? [], t.dataset.suggestion === "follow"));
    void load(page);
    return;
  }
  if (t.dataset.unfollow) { const gone = t.dataset.unfollow.toLowerCase(); state = await api.saveSettings({ market: { ...state!.settings.market, realms: state!.settings.market.realms.filter((r) => r.toLowerCase() !== gone) } }); void load("market"); return; }
  if (t.id === "pause") { await api.setPaused(!state!.engine.paused); return; }
  if (t.id === "chatStop") { await api.chatStop(); return; }
  if (t.id === "chatClear") { copied = null; data.chat = await api.chatClear(); render(); return; }
  if (t.id === "browse") {
    const folder = await api.pickGameFolder();
    if (!folder) return;
    if (state!.settings.consentedAt) { (main.querySelector("#gameFolder") as HTMLInputElement).value = folder; draftDirty = true; }
    else { chosenFolder = folder; render(); void checkSetupAddon(); }
    return;
  }
  if (t.id === "pickToken") { const f = await api.pickTokenFile(); if (f) { (main.querySelector("#tokenFile") as HTMLInputElement).value = f; draftDirty = true; } return; }
  if (t.id === "redetect") { chosenFolder = null; await detect(); return; }
  // Saves only the folder choice; with unsaved Settings edits the page is not redrawn, so the field and callout are updated here.
  if (t.id === "useForever" && state?.foreverFolder) {
    const folder = state.foreverFolder;
    state = await api.saveSettings({ gameFolder: folder });
    const input = main.querySelector("#gameFolder") as HTMLInputElement | null;
    if (input) input.value = folder;
    t.closest(".callout")?.remove(); render(); return;
  }
  if (t.id === "keepFolder" && state?.settings.gameFolder) { state = await api.saveSettings({ keptGameFolder: state.settings.gameFolder }); t.closest(".callout")?.remove(); render(); return; }
  if (t.id === "start" && chosenFolder) { state = await api.saveSettings({ gameFolder: chosenFolder, census: censusChoice, players: playersChoice, consentedAt: new Date().toISOString() }); void go("overview"); return; }
  if (t.id === "openConfig") { void api.openConfig(); return; }
  if (t.id === "openData") { void api.openDataFolder(); return; }
  if (t.id === "openAddons") { void api.openAddonsFolder(); return; }
  if (t.id === "realmAddBtn") {
    const input = main.querySelector("#realmAdd") as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    state = await api.saveSettings({ market: { ...state!.settings.market, realms: [...state!.settings.market.realms, name] } });
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
  if (t.id === "setupInstallAddon" && setupAddon) {
    const target = setupAddon;
    busy = "setupAddon"; target.note = ""; render();
    try { const r = await api.setupInstallAddon(target.folder); target.installed = r.version; target.note = `Installed the Everloot addon ${r.version}. If the game is open, restart it.`; }
    catch (e) { target.note = `!${msg(e)}`; }
    busy = "";
    render();
    return;
  }
  if (t.id === "buildsSync") { state = await api.buildsSync(); await load("addon"); return; }
  if (t.id === "openBackups") { void api.openBackupsFolder(); return; }
  if (t.dataset.removekind) {
    try {
      data.chat = await api.chatRemoveProvider(t.dataset.removekind as ProviderKind);
      setupNote = removalNotice(data.chat);
      await refreshAsk();
    } catch (e) { setupNote = `!${msg(e)}`; }
    render();
    return;
  }
  if (t.hasAttribute("data-addmodel")) { openProviderForm(null); return; }
  if (t.hasAttribute("data-advanced")) {
    advancedOpen = true;
    await go("ask");
    main.querySelector<HTMLElement>("#askAdvanced > summary")?.focus();
    return;
  }
  if (t.dataset.usekind && t.dataset.usemodel) {
    data.chat = await api.chatUseModel(t.dataset.usekind as ProviderKind, t.dataset.usemodel);
    setupNote = `Chat now uses ${data.chat.provider?.model ?? t.dataset.usemodel}, and /ask tries it first.`;
    await refreshAsk();
    render();
    return;
  }
  if (t.id === "cancelProvider") { setupNote = ""; closeProviderForm(); return; }
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
  const control = ev.target as HTMLInputElement;
  if (control.id.startsWith("report")) {
    if (control.id === "reportPeriod") reportQuery.period = control.value === "all" ? "all" : Number(control.value) as 7 | 14 | 30 | 90;
    if (control.id === "reportMetric") { reportQuery.metric = control.value as ReportQuery["metric"]; reportQuery.item = undefined; }
    if (control.id === "reportScope") { const [account, character] = JSON.parse(control.value); reportQuery.account = account; reportQuery.character = character; reportQuery.item = undefined; }
    if (control.id === "reportItem") reportQuery.item = control.value;
    if (control.id === "reportCumulative") reportQuery.cumulative = control.checked;
    reportPage = 0;
    await load("reports");
    main.querySelector<HTMLElement>(`#${control.id}`)?.focus();
    return;
  }
  const el = ev.target as HTMLInputElement;
  if (el.id === "censusConsent") { censusChoice = el.checked; return; }
  if (el.id === "playersConsent") { playersChoice = el.checked; return; }
  if (el.id === "agree") { agreed = el.checked; render(); return; }
  if (el.id === "providerModelPick") {
    syncManualModel();
    if (el.value === "") main.querySelector<HTMLElement>("#providerModel")?.focus();
    return;
  }
  if (el.id === "providerKind") { const kind = el.value as ProviderKind; dropProviderDraft(); pickKind = kind; loadModels(pickKind); render(); return; }
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
    state = await api.saveSettings({ market: { ...state!.settings.market, realms: el.checked ? [...current, realm] : current } });
    void load("market");
    return;
  }
  if (el.name === "folder") { chosenFolder = el.value; render(); void checkSetupAddon(); return; }
  if (el.form && el.form.id !== "chatForm" && el.form.id !== "providerForm") draftDirty = true;
}
main.addEventListener("input", (ev) => {
  const f = (ev.target as HTMLElement).closest("form");
  if (f && f.id !== "chatForm" && f.id !== "providerForm") draftDirty = true;
  if (f?.id === "priceForm") priceEdits++;
});
// Escape or a click on the dimmed backdrop closes the restart dialog, unless the restart is already under way.
restartDlg.addEventListener("cancel", (ev) => { ev.preventDefault(); if (!restarting) closeRestart(); });
restartDlg.addEventListener("click", (ev) => { if (ev.target === restartDlg && !restarting) closeRestart(); });
// The same for Delete my local data, until deleting has begun.
wipeDlg.addEventListener("cancel", (ev) => { ev.preventDefault(); closeWipe(); });
wipeDlg.addEventListener("click", (ev) => { if (ev.target === wipeDlg) closeWipe(); });
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
    if (!model && f.has("model")) {
      // In the panel, where a dirty Settings/Ask page still redraws; the empty box takes the focus so the fix is one keystroke away.
      setupNote = "!Type the model id, or pick one from the list";
      render();
      main.querySelector<HTMLElement>("#providerModel")?.focus();
      return;
    }
    try {
      data.chat = await api.chatSetProvider({ kind: pickKind, key: text("key"), model, baseUrl: text("baseUrl") });
      // A new key may see other models: ask again.
      loadModels(pickKind, true);
      setupNote = `Saved and selected: Chat now runs ${data.chat.mode}, and /ask tries it first. Nothing was sent to the provider to test it.`;
      await refreshAsk();
      closeProviderForm();
    } catch (e) { setupNote = `!${msg(e)}`; render(); }
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
    const query = text("priceItem") || String(f.get("priceItem") ?? "");
    const edits = ++priceEdits;
    priceLookup = await api.marketLookup(query);
    // A redraw may have replaced the submitted form: clear the live box, and only while it still holds this query.
    const box = main.querySelector<HTMLInputElement>("#priceItem");
    if (box && edits === priceEdits && box.value.trim() === query.trim()) box.value = "";
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
  let note = "Saved.";
  if (form.id === "settings") {
    const endpoint = text("endpoint");
    state = await api.saveSettings({ gameFolder: text("gameFolder") || null, endpoint, launchAtLogin: f.get("launchAtLogin") === "on", startInTray: f.get("startInTray") === "on", autoUpdateAddon: f.get("autoUpdateAddon") === "on", census: f.get("census") === "on", players: f.get("players") === "on" });
    note = savedNote({ endpoint }, state.settings);
  } else if (form.id === "askForm") {
    const mcpUrl = text("mcpUrl");
    state = await api.saveSettings({ ask: { ...state!.settings.ask, mcpUrl, tokenFile: text("tokenFile") || null } });
    note = savedNote({ mcpUrl }, state.settings);
  }
  draftDirty = false;
  render();
  const saved = main.querySelector("#saved");
  if (saved) { saved.textContent = note.replace(/^!/, ""); saved.className = note.startsWith("!") ? "error" : "muted"; }
}

void (async () => {
  state = await api.state();
  if (!state.settings.consentedAt) await detect();
  render();
  if (updateAsked && state.update?.newer) toggleUpdate(true);
  void load(page);
})();
