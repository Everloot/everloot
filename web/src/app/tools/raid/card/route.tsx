import { CURRENT_BUILD, TABLES } from "@/data/game-data/raid";
import { CLASSES, tokens } from "@/design/tokens";
import { renderBuildCard, renderCard } from "@/lib/og-card";
import { coverage, decodeRaid, describeRaid, roster } from "@/lib/raid";

const CLASS_NAME = (c: string) => c[0].toUpperCase() + c.slice(1);
const ROLE_NAME = { tank: "Tanks", healer: "Healers", damage: "Damage", unknown: "Not known" } as const;

// The link preview for a raid link (/tools/raid/r/<code>): ?c=<code>. The size and roles, the buffs
// the raid covers on the page's rules, and its biggest classes as bars in their class colours.
export async function GET(req: Request) {
  const decoded = decodeRaid(new URL(req.url).searchParams.get("c") ?? "");
  const c = tokens.dark;
  const image = decoded.ok && decoded.value.slots.some(Boolean)
    ? await (() => {
      const { size, slots } = decoded.value;
      const d = describeRaid(size, slots);
      const r = roster(slots);
      const cov = coverage(slots, TABLES[CURRENT_BUILD]);
      const roleBars = (["tank", "healer", "damage", "unknown"] as const)
        .filter((k) => k !== "unknown" || r.roles.unknown > 0)
        .map((k) => ({ name: ROLE_NAME[k], value: String(r.roles[k]), fraction: r.roles[k] / d.filled }));
      const classBars = CLASSES.filter((k) => r.classes[k] > 0)
        .sort((a, b) => r.classes[b] - r.classes[a])
        .slice(0, 4)
        .map((k) => ({ name: CLASS_NAME(k), value: String(r.classes[k]), fraction: r.classes[k] / d.filled, color: c[`class-${k}`] }));
      return renderBuildCard({
        label: "Everloot · WoW Forever raid plan",
        title: d.title,
        color: c.accent,
        subtitle: `${d.filled} of ${size} filled · buffs covered ${cov.summary.covered} of ${cov.buffs.length}`,
        groups: [{ heading: "Roles", bars: roleBars }, { heading: "Most common classes", bars: classBars }],
      });
    })()
    : await renderCard({ label: "Everloot", title: "WoW Forever Raid Buff Planner", subtitle: "Fill a raid and see which buffs each group gets" });
  image.headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
  image.headers.set("CDN-Cache-Control", "public, max-age=86400");
  return image;
}
