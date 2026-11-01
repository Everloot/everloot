/**
 * What "Start when I sign in" hands to app.setLoginItemSettings, or null where there is no login
 * item API (Linux; the AppImage can be added by hand). The portable Windows exe unpacks itself to a
 * temporary folder on every run, so process.execPath, Electron's default, is gone after the next
 * restart: the entry names the portable exe itself (PORTABLE_EXECUTABLE_FILE) instead. `path` is
 * read on Windows only.
 */
export function loginItemOptions(platform: string, openAtLogin: boolean, portableExe: string | undefined): { openAtLogin: boolean; args: string[]; path?: string } | null {
  if (platform === "linux") return null;
  return { openAtLogin, args: ["--hidden"], ...(platform === "win32" && portableExe ? { path: portableExe } : {}) };
}
