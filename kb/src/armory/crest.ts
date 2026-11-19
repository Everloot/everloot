import { z } from "zod";

const color = z.object({ rgba: z.object({ r: z.number().int().min(0).max(255), g: z.number().int().min(0).max(255), b: z.number().int().min(0).max(255), a: z.number().min(0).max(1).optional() }) });
const part = z.object({ id: z.number().int().nonnegative(), color });
export const GuildCrest = z.object({ emblem: part, border: part, background: z.object({ color }) });
export type GuildCrest = z.infer<typeof GuildCrest>;
/** Only Blizzard's HTTPS media, never an arbitrary URL from stored JSON. */
export function crestImage(body: unknown): string | null {
  const parsed = z.object({ assets: z.array(z.object({ key: z.string(), value: z.string() })) }).safeParse(body);
  const value = parsed.success ? parsed.data.assets.find((a) => a.key === "image")?.value : null;
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && (u.hostname === "render.worldofwarcraft.com" || u.hostname.endsWith(".battle.net")) ? value : null;
  } catch { return null; }
}
