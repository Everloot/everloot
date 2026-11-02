import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from "electron";
import type { AppState, Job } from "../shared/types";
import { scanReminder } from "./inspect";

export interface TrayActions {
  show(page?: string): void;
  runNow(job: Job): void;
  setPaused(paused: boolean): void;
  openExternal(url: string): void;
  quit(): void;
}

const LABEL: Record<Job, string> = { upload: "Upload", prices: "Market prices", ask: "/ask" };

/** One line per job for the tray menu: "Upload: sent 3 new events (02:41)". */
export function jobLine(state: AppState, job: Job): string {
  const j = state.engine.jobs[job];
  const when = j.at ? ` (${new Date(j.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : "";
  switch (j.state) {
    case "off": return `${LABEL[job]}: off`;
    case "idle": return `${LABEL[job]}: waiting`;
    case "running": return `${LABEL[job]}: running`;
    case "ok": return `${LABEL[job]}: ${j.message.split(";")[0]}${when}`;
    case "error": return `${LABEL[job]}: failed, ${j.message}${when}`;
  }
}

export function createTray(iconPath: string, actions: TrayActions): { update(state: AppState): void; destroy(): void } {
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip("Everloot Desktop App");
  tray.on("click", () => actions.show());
  tray.on("double-click", () => actions.show());
  // Replacing the menu while it is open can close it on Windows, and state pushes come often (each percent of a
  // download), so the menu is rebuilt only when a label or enabled state in it changes. Its items read the newest state.
  let current: AppState | null = null;
  let shown = "", tip = "";
  return {
    update(state) {
      current = state;
      const paused = state.engine.paused;
      const watching = state.engine.files.length;
      const reminder = scanReminder(state.staleScans);
      const items: MenuItemConstructorOptions[] = [
        { label: watching ? `Watching ${watching} account file(s)` : "Not watching a game folder", enabled: false },
        { label: jobLine(state, "upload"), enabled: false },
        { label: jobLine(state, "prices"), enabled: false },
        { label: jobLine(state, "ask"), enabled: false },
        ...(reminder ? [{ label: reminder, click: () => actions.show("market") }] : []),
        // Where the app can install the update itself, the item opens its update panel; elsewhere the download page.
        ...(state.update?.newer && (state.update.installable || state.update.url) ? [{
          label: state.updateProgress.stage === "ready" ? `Restart to update to ${state.update.latest}` : `Update Everloot Desktop App to ${state.update.latest}`,
          click: () => { const u = current?.update; if (u?.installable) actions.show("update"); else if (u?.url) actions.openExternal(u.url); },
        }] : []),
        { type: "separator" },
        { label: "Open Everloot Desktop App", click: () => actions.show() },
        { label: "Ask Everloot…", click: () => actions.show("chat") },
        { label: "Upload now", enabled: state.settings.upload && watching > 0 && !paused, click: () => actions.runNow("upload") },
        { label: "Refresh prices now", enabled: state.settings.prices && watching > 0 && !paused, click: () => actions.runNow("prices") },
        { label: paused ? "Resume" : "Pause", click: () => actions.setPaused(!(current?.engine.paused ?? paused)) },
        { type: "separator" },
        { label: "Quit", click: () => actions.quit() },
      ];
      const signature = JSON.stringify(items.map((i) => [i.type ?? "", i.label ?? "", i.enabled ?? true]));
      if (signature !== shown) { shown = signature; tray.setContextMenu(Menu.buildFromTemplate(items)); }
      const tooltip = `Everloot Desktop App${paused ? " (paused)" : ""}${state.update?.newer ? ` · update ${state.update.latest} available` : ""}`;
      if (tooltip !== tip) { tip = tooltip; tray.setToolTip(tooltip); }
    },
    destroy: () => tray.destroy(),
  };
}
