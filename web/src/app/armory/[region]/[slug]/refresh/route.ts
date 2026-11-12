import { armoryCharacterPath, armoryOn, isArmoryRegion, slugFromSegment, validArmorySlug } from "@/lib/armory";
import { armoryStore } from "@/lib/armory-store";
import { intakeQuota } from "@/lib/intake-quota";
import { back, notFoundAnswer } from "../../../form";

export const dynamic = "force-dynamic";
export async function POST(req: Request, props: { params: Promise<{ region: string; slug: string }> }) {
  const { region, slug: segment } = await props.params;
  const slug = slugFromSegment(segment);
  if (!armoryOn() || !isArmoryRegion(region) || !slug || !validArmorySlug(slug)) return notFoundAnswer();
  const path = armoryCharacterPath(region, slug);
  try {
    if (!(await intakeQuota.form(req)).allowed) return back(req, path, { refresh: "limit" });
    return back(req, path, { refresh: await armoryStore().refresh(region, slug) });
  } catch {
    return back(req, path, { refresh: "storage" });
  }
}
