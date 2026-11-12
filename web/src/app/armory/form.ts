import { NextResponse } from "next/server";
import { characterFromArmoryUrl, characterSlugOf, isArmoryRegion } from "@/lib/armory";

/**
 * The hide and add forms post here without JavaScript, so a handler answers with a redirect back to its form: `done`
 * on success, `error` with the fields kept otherwise. A body that is not a form at all is a 400.
 */

export type CharacterForm =
  | { ok: true; region: "us" | "eu"; name: string; surname: string; slug: string }
  | { ok: false; fields: Record<string, string> | null };

export async function readCharacterForm(req: Request): Promise<CharacterForm> {
  const form = await req.formData().catch(() => null);
  if (!form) return { ok: false, fields: null };
  const text = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string).trim().slice(0, 40) : "");
  const region = text("region"), name = text("name"), surname = text("surname");
  const slug = characterSlugOf(name, surname);
  if (!isArmoryRegion(region) || !slug) return { ok: false, fields: { region, name, surname } };
  return { ok: true, region, name, surname, slug };
}

export async function readSubmissionForm(req: Request): Promise<CharacterForm> {
  const form = await req.clone().formData().catch(() => null);
  if (!form) return { ok: false, fields: null };
  const raw = form.get("armoryUrl");
  if (typeof raw !== "string" || !raw.trim()) return readCharacterForm(req);
  const identity = characterFromArmoryUrl(raw);
  return identity ? { ok: true, ...identity } : { ok: false, fields: { armoryUrl: raw.slice(0, 500) } };
}

export function back(req: Request, path: string, query: Record<string, string>): Response {
  return NextResponse.redirect(new URL(`${path}?${new URLSearchParams(query)}`, req.url), { status: 303, headers: { "cache-control": "no-store" } });
}

export const notAForm = () => NextResponse.json({ ok: false, error: "Send the form's fields" }, { status: 400, headers: { "cache-control": "no-store" } });
export const notFoundAnswer = () => NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
