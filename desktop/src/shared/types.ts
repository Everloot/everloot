/** Shapes shared by the Node side and the page. No Node or Electron imports here. */
import type { ModelChoice, ProviderChoice, ProviderInUse, ProviderKind } from "./providers";

export type Job = "upload" | "prices" | "ask";
export const JOBS: Job[] = ["upload", "prices", "ask"];

export interface Settings {
  /** The product folder (the one holding WTF/), or null before setup. */
  gameFolder: string | null;
  /** The folder the player chose to keep when the page suggested WoW: Forever's folder instead; null otherwise. */
  keptGameFolder: string | null;
  endpoint: string;
  upload: boolean;
  prices: boolean;
  /** Census counts go with the uploads: race, class, level and faction of players seen, never names. */
  census: boolean;
  /** Player pages go with the uploads: the name, realm, race, class, level and guild of the players seen. Off by default. */
  players: boolean;
  ask: { enabled: boolean; mcpUrl: string; tokenFile: string | null };
  /** Realms to keep prices for beyond the ones in the player's own scans (TSM-style realm picks). */
  market: { realms: string[] };
  /** ISO time the player pressed Start on the welcome screen; null until then. Nothing runs before. */
  consentedAt: string | null;
  launchAtLogin: boolean;
  startInTray: boolean;
}

export type JobState = "off" | "idle" | "running" | "ok" | "error";
export interface JobStatus { state: JobState; message: string; at: string | null }
export interface LogLine { at: string; level: "info" | "error"; text: string }

export interface EngineState {
  files: string[];
  jobs: Record<Job, JobStatus>;
  log: LogLine[];
  paused: boolean;
}

/** `files` counts accounts with an Everloot.lua; `hasAccounts` says WTF/Account exists at all. */
export interface GameFolderCandidate { folder: string; product: string; files: number; hasAccounts: boolean }

/** One change a release lists; author and pull request when GitHub generated the line. */
export interface ReleaseNote { text: string; author: string | null; pr: number | null }
export interface UpdateCheck {
  current: string;
  latest: string | null;
  /** The release page. */
  url: string | null;
  newer: boolean;
  /** What the newest release lists as changed. */
  notes: ReleaseNote[];
  /** This system's installer from that release; null when it has none. */
  downloadUrl: string | null;
  publishedAt: string | null;
  /** The release's SHA256SUMS, which an in-app download is checked against. */
  sumsUrl: string | null;
  /** Whether this install can download the update and install it on restart (the Windows installer only). */
  installable: boolean;
}
/** The in-app update download: idle until asked, then downloading, then ready to restart, or failed with why. */
export interface UpdateProgress { stage: "idle" | "downloading" | "ready" | "failed"; percent: number; error: string | null }

/** One dated copy of an account's Everloot.lua in the data folder, kept after each upload. */
export interface BackupInfo { file: string; account: string; at: string; bytes: number }

/** What one account's Everloot.lua holds, for the Upload page. Nothing here leaves the machine. */
export interface FileSummary {
  file: string;
  ok: boolean;
  error: string | null;
  addonVersion: string | null;
  clientBuild: string | null;
  writtenAt: string | null;
  bytes: number;
  /** Records per kind, most first. */
  kinds: { kind: string; count: number }[];
  records: number;
  /** Events the site has confirmed from this install (sent.json). */
  confirmed: number;
  pendingAsks: number;
  scanRealms: string[];
  /** The player's last full scan per realm, newest first. */
  scans: ScanAge[];
}

export interface ScanAge { realm: string; at: string | null }

export interface RealmSummary { realm: string; items: number; dataAsOf: string | null; source: "scan" | "followed" }
export interface MarketInfo {
  /** Realms named in the player's own scans. */
  own: string[];
  followed: string[];
  /** Realms the site has public values for, when it answered. */
  known: string[];
  dataAsOf: string | null;
  /** What the last refresh wrote into the game. */
  last: RealmSummary[];
  /** The player's last full scan per realm across every account file, newest first. */
  scans: ScanAge[];
  error: string | null;
  /** What the EverlootPrices file in the game holds now, per realm; null when there is no file. */
  inGame: { realm: string; dataAsOf: string | null; items: number }[] | null;
}
/** One item's price on each realm in the game's prices file, as the tooltip shows it. */
export interface PriceLookup {
  itemId: number | null;
  rows: { realm: string; dataAsOf: string | null; market: number | null; min: number; historical: number; quantity: number; day: string; reporters: number }[];
  /** Why there is nothing to show, in a sentence; null with rows. */
  note: string | null;
}

export interface Ask { id: string; question: string; askedAt: string }
export interface Answer { id: string; answer: string; source: string; answeredAt: string }
export interface AskInfo {
  pending: { file: string; asks: Ask[] }[];
  answers: Answer[];
  /** Provider names from config.json, in order; empty means plain search. */
  providers: string[];
  providerError: string | null;
}

export interface AddonInfo {
  addonsDir: string | null;
  installed: string | null;
  latest: { version: string; url: string } | null;
  /** The latest release is newer than what is installed; false for a nightly ahead of it. */
  newer: boolean;
  slots: { prices: boolean; answers: boolean; builds: boolean };
  error: string | null;
}

export interface ChangeItem { title: string; link: string; date: string | null; summary: string }

/** One tool call the agent made while answering. */
export interface ChatStep { tool: string; input: string; chars: number }
/** The assistant's text when the tools had nothing and no model answered on its own. */
export const NO_SOURCED_ANSWER = "No sourced answer found in Everloot's data for that.";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
  /** The model that wrote an assistant message; null for plain search. */
  model: string | null;
  sources: string[];
  steps: ChatStep[];
  /** The player pressed Stop while it was written: the text is what had arrived. */
  stopped?: boolean;
}
export interface ChatInfo {
  messages: ChatMessage[];
  /** "<provider>:<model> with tools", or "plain search" with no provider. */
  mode: string;
  /** The MCP endpoint in use and whether a token is set (the public one is rate limited per IP). */
  mcpUrl: string;
  withToken: boolean;
  /** The public MCP target is actually using the account key for its checked origin. */
  withAccountKey: boolean;
  /** The provider saved from the Chat page, if config.json still names it; null when none or hand-written only. */
  provider: ProviderInUse | null;
  /** Every provider saved from the Chat page, with a key where it needs one; the model menu lists their models. */
  providers: ProviderInUse[];
  busy: boolean;
  error: string | null;
}
/** The answer being written: the model's text so far in this round and the tool it is running, if any. */
export interface ChatProgress { text: string; tool: string | null }

/** One of the player's own characters, from the save file. Never uploaded from here. */
export interface GearSlot {
  slot: string;
  itemLevel: number;
}
export interface MoneyRow {
  at: string;
  category: string;
  copper: number;
  direction: "in" | "out";
}
export interface MoneyDay {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  earned: number;
  spent: number;
}
export interface CharacterRow {
  character: string;
  realm: string;
  /** Copper, latest snapshot. */
  gold: number | null;
  peakGold: number | null;
  gearSlots: number;
  itemLevel: number | null;
  /** The latest gear snapshot's slots, in the game's order. */
  equipped: GearSlot[];
  /** Copper by category, from money events this file holds. */
  spent: Record<string, number>;
  earned: Record<string, number>;
  /** Dated gold snapshots in time order, thinned to at most sixty points for a sparkline. */
  history: { at: string; copper: number }[];
  /** Money events from the last seven days. */
  week: { earned: number; spent: number };
  /** The last thirty UTC days of money events, oldest first. */
  days: MoneyDay[];
  /** The newest money events, at most twelve. */
  receipts: MoneyRow[];
}
/** Progress rows carry an opaque per-install key instead of a name (intake.ts CHARACTER_KEY). */
export interface ProgressRow {
  key: string;
  class: string;
  level: number;
  achievements: number;
  achievementsInProgress: number;
  reputations: number;
  exalted: number;
  titles: number;
  quests: number;
  talentPoints: number | null;
}
export interface CharactersInfo {
  characters: CharacterRow[];
  progress: ProgressRow[];
  talents: { class: string; level: number; points: number }[];
}


/**
 * The saved-builds sync into the EverlootBuilds slot addon. `off` without a key; `forbidden` when the key
 * lacks the "Read my saved builds" permission; `unavailable` while the site has saved builds switched off.
 */
export interface BuildsStatus {
  state: "off" | "running" | "ok" | "error" | "forbidden" | "unavailable";
  message: string;
  /** When the last sync that reached the site finished; null before one did. */
  syncedAt: string | null;
  /** How many builds the last sync wrote. */
  builds: number | null;
}

/** Signed in to everloot.app with one of the account's API keys; the page sees only its last four characters. */
export interface Account { signedIn: boolean; hint: string | null }

/** Everything the page knows. The main side sends a fresh one after every change. */
export interface AppState {
  version: string;
  platform: string;
  dataFolder: string;
  /** A problem reading settings.json at start, shown once on the page; null otherwise. */
  notice: string | null;
  settings: Settings;
  /** WoW: Forever's folder, when the chosen game folder is another client installed beside it; null otherwise. */
  foreverFolder: string | null;
  engine: EngineState;
  /** The desktop release check made once at start; null until it ran or when it could not reach GitHub. */
  update: UpdateCheck | null;
  updateProgress: UpdateProgress;
  /** Realms whose last full scan is older than a day (or never dated), for the tray reminder. */
  staleScans: ScanAge[];
  account: Account;
  builds: BuildsStatus;
}

/** What `window.everloot` offers the page. Implemented in preload.ts over IPC. */
export interface EverlootApi {
  state(): Promise<AppState>;
  saveSettings(patch: Partial<Settings>): Promise<AppState>;
  detectGameFolders(): Promise<GameFolderCandidate[]>;
  pickGameFolder(): Promise<string | null>;
  pickTokenFile(): Promise<string | null>;
  runNow(job: Job): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  openDataFolder(): Promise<void>;
  /** Opens the game's Interface/AddOns folder in the file manager. */
  openAddonsFolder(): Promise<void>;
  openConfig(): Promise<void>;
  openExternal(url: string): Promise<boolean>;
  checkForUpdates(): Promise<UpdateCheck>;
  /** Downloads the update to install on restart (Windows installs); progress arrives with the state. */
  updateDownload(): Promise<void>;
  /** Asks to restart, then installs the downloaded update; false when the player chose Not now. */
  updateRestart(): Promise<boolean>;
  /** Offers a GitHub bug report with these diagnostics, or copies them. */
  reportBug(diagnostics: string): Promise<"opened" | "copied" | null>;
  /** Checks an everloot.app API key with the site and keeps it; throws with the reason when it is refused. */
  accountSignIn(key: string): Promise<AppState>;
  /** Signs in through the browser (everloot.app's connect page); throws with the reason when it does not finish. */
  accountConnect(): Promise<AppState>;
  /** Stops a browser sign-in that is still waiting. */
  accountConnectCancel(): Promise<void>;
  /** Forgets the key on this computer. */
  accountSignOut(): Promise<AppState>;
  uploadInfo(): Promise<FileSummary[]>;
  backups(): Promise<BackupInfo[]>;
  /** Asks the player to confirm, then copies the backup over the live file; returns the restored path or null when cancelled. */
  restoreBackup(file: string): Promise<string | null>;
  openBackupsFolder(): Promise<void>;
  marketInfo(): Promise<MarketInfo>;
  /** Looks an item up in the game's prices file: an item id or a link pasted from game chat. */
  marketLookup(text: string): Promise<PriceLookup>;
  askInfo(): Promise<AskInfo>;
  addonInfo(): Promise<AddonInfo>;
  /** Reads the saved builds from everloot.app with the account key and writes the EverlootBuilds slot addon. */
  buildsSync(): Promise<AppState>;
  installAddon(version: string): Promise<{ version: string; files: number }>;
  changes(): Promise<ChangeItem[]>;
  charactersInfo(): Promise<CharactersInfo>;
  chatInfo(): Promise<ChatInfo>;
  chatSend(text: string): Promise<ChatInfo>;
  chatClear(): Promise<ChatInfo>;
  /** Stops the answer being written; the pending chatSend resolves with what had arrived. */
  chatStop(): Promise<void>;
  /** Saves a provider pick (its key, if any, to a file in the data folder) and points config.json at it; the key never comes back to the page. */
  chatSetProvider(choice: ProviderChoice): Promise<ChatInfo>;
  /** Removes a saved provider and its key; without a kind, the one in use. */
  chatRemoveProvider(kind?: ProviderKind): Promise<ChatInfo>;
  /** Switches Chat and /ask to a model of a provider already saved. */
  chatUseModel(kind: ProviderKind, model: string): Promise<ChatInfo>;
  /** The models a provider serves now, read from the provider with the saved key; null when it cannot be read. */
  chatModels(kind: ProviderKind): Promise<ModelChoice[] | null>;
  onState(listener: (state: AppState) => void): () => void;
  /** The main side asks the page to open a screen: a tray entry or a notification was clicked. */
  onNavigate(listener: (page: string) => void): () => void;
  /** The Chat page's answer as it is written, until chatSend resolves. */
  onChatProgress(listener: (progress: ChatProgress) => void): () => void;
}
