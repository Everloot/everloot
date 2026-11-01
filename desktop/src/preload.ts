import { contextBridge, ipcRenderer } from "electron";
import type { ProviderChoice, ProviderKind } from "./shared/providers";
import type { AppState, ChatProgress, EverlootApi, Job, Settings } from "./shared/types";

// The only way the page reaches Node: named calls over IPC, each checked on the main side.
const api: EverlootApi = {
  state: () => ipcRenderer.invoke("state"),
  saveSettings: (patch: Partial<Settings>) => ipcRenderer.invoke("saveSettings", patch),
  detectGameFolders: () => ipcRenderer.invoke("detectGameFolders"),
  pickGameFolder: () => ipcRenderer.invoke("pickGameFolder"),
  pickTokenFile: () => ipcRenderer.invoke("pickTokenFile"),
  runNow: (job: Job) => ipcRenderer.invoke("runNow", job),
  setPaused: (paused: boolean) => ipcRenderer.invoke("setPaused", paused),
  openDataFolder: () => ipcRenderer.invoke("openDataFolder"),
  openAddonsFolder: () => ipcRenderer.invoke("openAddonsFolder"),
  openConfig: () => ipcRenderer.invoke("openConfig"),
  openExternal: (url: string) => ipcRenderer.invoke("openExternal", url),
  checkForUpdates: () => ipcRenderer.invoke("checkForUpdates"),
  updateDownload: () => ipcRenderer.invoke("updateDownload"),
  updateRestart: () => ipcRenderer.invoke("updateRestart"),
  reportBug: (diagnostics: string) => ipcRenderer.invoke("reportBug", diagnostics),
  accountSignIn: (key: string) => ipcRenderer.invoke("accountSignIn", key),
  accountConnect: () => ipcRenderer.invoke("accountConnect"),
  accountConnectCancel: () => ipcRenderer.invoke("accountConnectCancel"),
  accountSignOut: () => ipcRenderer.invoke("accountSignOut"),
  uploadInfo: () => ipcRenderer.invoke("uploadInfo"),
  backups: () => ipcRenderer.invoke("backups"),
  restoreBackup: (file: string) => ipcRenderer.invoke("restoreBackup", file),
  openBackupsFolder: () => ipcRenderer.invoke("openBackupsFolder"),
  marketInfo: () => ipcRenderer.invoke("marketInfo"),
  marketLookup: (text: string) => ipcRenderer.invoke("marketLookup", text),
  askInfo: () => ipcRenderer.invoke("askInfo"),
  addonInfo: () => ipcRenderer.invoke("addonInfo"),
  buildsSync: () => ipcRenderer.invoke("buildsSync"),
  installAddon: (version: string) => ipcRenderer.invoke("installAddon", version),
  setupAddon: (folder: string) => ipcRenderer.invoke("setupAddon", folder),
  setupInstallAddon: (folder: string) => ipcRenderer.invoke("setupInstallAddon", folder),
  changes: () => ipcRenderer.invoke("changes"),
  charactersInfo: () => ipcRenderer.invoke("charactersInfo"),
  chatInfo: () => ipcRenderer.invoke("chatInfo"),
  chatSend: (text: string) => ipcRenderer.invoke("chatSend", text),
  chatClear: () => ipcRenderer.invoke("chatClear"),
  chatStop: () => ipcRenderer.invoke("chatStop"),
  chatSetProvider: (choice: ProviderChoice) => ipcRenderer.invoke("chatSetProvider", choice),
  chatRemoveProvider: (kind?: ProviderKind) => ipcRenderer.invoke("chatRemoveProvider", kind),
  chatUseModel: (kind: ProviderKind, model: string) => ipcRenderer.invoke("chatUseModel", kind, model),
  chatModels: (kind: ProviderKind) => ipcRenderer.invoke("chatModels", kind),
  onNavigate: (listener) => {
    const handler = (_event: unknown, page: string) => listener(page);
    ipcRenderer.on("navigate", handler);
    return () => { ipcRenderer.removeListener("navigate", handler); };
  },
  onChatProgress: (listener) => {
    const handler = (_event: unknown, progress: ChatProgress) => listener(progress);
    ipcRenderer.on("chatProgress", handler);
    return () => { ipcRenderer.removeListener("chatProgress", handler); };
  },
  onState: (listener) => {
    const handler = (_event: unknown, state: AppState) => listener(state);
    ipcRenderer.on("state", handler);
    return () => { ipcRenderer.removeListener("state", handler); };
  },
};

contextBridge.exposeInMainWorld("everloot", api);
