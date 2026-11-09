import { revalidatePath } from "next/cache";
import { ARMORY_HIDE_PATH, armoryOn } from "@/lib/armory";
import { armoryStore } from "@/lib/armory-store";
import { intakeQuota } from "@/lib/intake-quota";
import { back, notAForm, notFoundAnswer, readCharacterForm } from "../../form";

/**
 * POST /armory/hide/send: hide a character from the armory, no account needed. armory_hide records the hide, deletes
 * the character's row, its roster rows and its queue rows, and the crawler never writes it again. The cached armory
 * pages (the hub and the boards) are cleared so it is gone at once. Limited per address like every other form.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!armoryOn()) return notFoundAnswer();
  const form = await readCharacterForm(req);
  if (!form.ok) return form.fields ? back(req, ARMORY_HIDE_PATH, { error: "invalid", ...form.fields }) : notAForm();
  const kept = { region: form.region, name: form.name, surname: form.surname };
  try {
    const admitted = await intakeQuota.form(req);
    if (!admitted.allowed) return back(req, ARMORY_HIDE_PATH, { error: "limit", ...kept });
    await armoryStore().hide(form.region, form.slug);
  } catch (err) {
    console.error("armory hide failed", err);
    return back(req, ARMORY_HIDE_PATH, { error: "storage", ...kept });
  }
  revalidatePath("/armory", "layout");
  return back(req, ARMORY_HIDE_PATH, { done: "1" });
}
