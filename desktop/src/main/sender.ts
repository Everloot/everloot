import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** What the IPC check reads from a frame; Electron's WebFrameMain has both. */
export interface SenderFrame {
  url: string;
  parent: unknown;
}

/**
 * True when a message comes from the app's own page at the top of the window: the bundled
 * index.html, whatever #page it shows. Another file, a web page, a frame inside the page or a
 * frame that is already gone is refused. Paths are compared, not URL text, since Chromium and
 * Node spell the same file URL differently (escapes, drive letter case).
 */
export function fromAppPage(frame: SenderFrame | null | undefined, pagePath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!frame || frame.parent) return false;
  let path: string;
  try {
    const u = new URL(frame.url);
    if (u.protocol !== "file:" || u.host) return false;
    path = resolve(fileURLToPath(u));
  } catch {
    return false;
  }
  const page = resolve(pagePath);
  return platform === "win32" ? path.toLowerCase() === page.toLowerCase() : path === page;
}

/** The page copies text with navigator.clipboard; it asks for nothing else (no camera, location, notifications). */
export function allowedPermission(permission: string): boolean {
  return permission === "clipboard-sanitized-write";
}
