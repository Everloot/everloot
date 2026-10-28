import { PROVIDER_PRESETS } from "../shared/providers";

/** The page may open a browser only to these hosts, and only over https. */
export const EXTERNAL_HOSTS = ["everloot.app", "github.com", "www.github.com", "discord.gg"];

/** The catalogue's get-key pages, as the URL parser writes them. These exact pages open; their hosts are not otherwise allowed. */
const KEY_PAGES = new Set(PROVIDER_PRESETS.flatMap((p) => (p.getKey ? [new URL(p.getKey.href).href] : [])));

export function allowedExternal(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  return EXTERNAL_HOSTS.includes(u.hostname) || (!u.username && !u.password && !u.hash && KEY_PAGES.has(u.href));
}
