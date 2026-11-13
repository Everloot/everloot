import { ARMORY_SUBMIT_PATH, armoryOn } from "@/lib/armory";
import { armoryStore } from "@/lib/armory-store";
import { intakeQuota } from "@/lib/intake-quota";
import { back, notAForm, notFoundAnswer, readSubmissionForm } from "../../form";

/**
 * POST /armory/submit/send: put one character in the crawler's queue (armory_enqueue, source "website"). The crawler
 * reads it on its next run; a character Blizzard does not know is dropped there. Nothing is written to a page here.
 * Limited per address like every other form.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!armoryOn()) return notFoundAnswer();
  const form = await readSubmissionForm(req);
  if (!form.ok) return form.fields ? back(req, ARMORY_SUBMIT_PATH, { error: "invalid", ...form.fields }) : notAForm();
  const kept = { region: form.region, name: form.name, surname: form.surname };
  try {
    const admitted = await intakeQuota.form(req);
    if (!admitted.allowed) return back(req, ARMORY_SUBMIT_PATH, { error: "limit", ...kept });
    const queued = await armoryStore().enqueue(form.region, "character", form.slug, "website");
    return back(req, ARMORY_SUBMIT_PATH, { done: queued ? "1" : "0" });
  } catch (err) {
    console.error("armory submit failed", err);
    return back(req, ARMORY_SUBMIT_PATH, { error: "storage", ...kept });
  }
}
