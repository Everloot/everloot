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

/**
 * What start-up hands to app.setLoginItemSettings: the entry only when the player asked for one, null otherwise.
 * Writing "off" on every start is what macOS refuses for an app that is not signed or runs from a temporary
 * folder ("Unable to set login item … Operation not permitted" in the log), and nothing needs it: the setting
 * changes only from Settings, which applies it then, on or off.
 */
export function startupLoginItemOptions(platform: string, openAtLogin: boolean, portableExe: string | undefined): ReturnType<typeof loginItemOptions> {
  return openAtLogin ? loginItemOptions(platform, openAtLogin, portableExe) : null;
}
