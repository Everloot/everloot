import { armoryOn, isArmoryRegion } from "@/lib/armory";
import { GUILD_SUBMIT_PATH, guildSlugOf } from "@/lib/armory-guilds";
import { armoryStore } from "@/lib/armory-store";
import { intakeQuota } from "@/lib/intake-quota";
import { back, notAForm, notFoundAnswer } from "../../../form";

export const dynamic = "force-dynamic";

/** Queue only: the crawler asks Blizzard for the guild and then queues its roster members. */
export async function POST(req: Request) {
  if (!armoryOn()) return notFoundAnswer();
  const form = await req.formData().catch(() => null);
  if (!form) return notAForm();
  const region = form.get("region"), name = form.get("name");
  const kept = { region: typeof region === "string" ? region.slice(0, 10) : "", name: typeof name === "string" ? name.slice(0, 64) : "" };
  const slug = typeof name === "string" && name.length <= 128 ? guildSlugOf(name) : null;
  if (typeof region !== "string" || !isArmoryRegion(region) || !slug) return back(req, GUILD_SUBMIT_PATH, { error: "invalid", ...kept });
  try {
    const admitted = await intakeQuota.form(req);
    if (!admitted.allowed) return back(req, GUILD_SUBMIT_PATH, { error: "limit", ...kept });
    const queued = await armoryStore().enqueue(region, "guild", slug, "website");
    return back(req, GUILD_SUBMIT_PATH, { done: queued ? "1" : "0" });
  } catch (err) {
    console.error("armory guild submit failed", err);
    return back(req, GUILD_SUBMIT_PATH, { error: "storage", ...kept });
  }
}
