import { unstable_cache } from "next/cache";
import { ForeverApi } from "@kb/armory/api";
import { crestImage, GuildCrest as CrestSchema, type GuildCrest as Crest } from "@kb/armory/crest";
// The crest is two transparent media layers; keep plain images so their alpha can be tinted.
/* eslint-disable @next/next/no-img-element */

const media = unstable_cache(async (region: "us" | "eu", kind: "emblem" | "border", id: number) => {
  const clientId = process.env.BNET_CLIENT_ID, clientSecret = process.env.BNET_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const api = new ForeverApi({ clientId, clientSecret, region });
    const response = await api.get(`/data/wow/media/guild-crest/${kind}/${id}`, "static");
    return response.status === 200 ? crestImage(response.body) : null;
  } catch { return null; }
}, ["guild-crest-media"], { revalidate: 86400 });
const rgb = (color: Crest["emblem"]["color"]) => `rgb(${color.rgba.r}, ${color.rgba.g}, ${color.rgba.b})`;

export function CrestImages({ crest, emblem, border }: { crest: Crest; emblem: string; border: string }) {
  const borderFilter = `crest-border-${crest.border.id}`;
  const emblemFilter = `crest-emblem-${crest.emblem.id}`;
  return <div role="img" aria-label="In-game guild crest" className="relative h-24 w-24" style={{ backgroundColor: rgb(crest.background.color) }}>
    <svg width="0" height="0" aria-hidden="true"><defs>{[[borderFilter, crest.border.color], [emblemFilter, crest.emblem.color]].map(([id, color]) => <filter key={id as string} id={id as string}><feFlood floodColor={rgb(color as Crest["emblem"]["color"])} /><feComposite in2="SourceAlpha" operator="in" /></filter>)}</defs></svg>
    <img src={border} alt="" width={96} height={96} className="absolute inset-0 h-24 w-24 object-contain" style={{ filter: `url(#${borderFilter})` }} />
    <img src={emblem} alt="" width={64} height={64} className="absolute left-4 top-4 h-16 w-16 object-contain" style={{ filter: `url(#${emblemFilter})` }} />
  </div>;
}
/**
 * The guild's mark when no in-game crest can be drawn: a plain shield in the faction's colour with its initial. Drawn
 * here, so it never shows as a broken image.
 */
export function FactionEmblem({ faction }: { faction: string }) {
  const side = faction === "Alliance" ? "Alliance" : faction === "Horde" ? "Horde" : null;
  const tone = side === "Alliance" ? "text-faction-alliance" : side === "Horde" ? "text-faction-horde" : "text-muted";
  return (
    <svg data-faction-emblem={side ?? "none"} role="img" aria-label={side ? `${side} emblem` : "Guild emblem"} viewBox="0 0 48 56" className={`h-24 w-[5.25rem] shrink-0 ${tone}`}>
      <path d="M24 2 L45 9 V27 C45 40 36 49 24 54 C12 49 3 40 3 27 V9 Z" fill="currentColor" />
      <path d="M24 7 L40 12.5 V27 C40 37.5 33 44.5 24 48.5 C15 44.5 8 37.5 8 27 V12.5 Z" fill="none" className="stroke-canvas" strokeWidth="1.5" />
      {side && <text x="24" y="34" textAnchor="middle" fontSize="20" fontWeight="700" className="fill-canvas">{side[0]}</text>}
    </svg>
  );
}

/** The in-game crest, or `fallback` when none is stored or its images cannot be read (the faction emblem by default). */
export default async function GuildCrest({ crest, region = "us", faction = "" }: { crest?: Crest | null; region?: string; faction?: string }) {
  const parsed = CrestSchema.safeParse(crest);
  if (!parsed.success) return <FactionEmblem faction={faction} />;
  const [emblem, border] = await Promise.all([media(region === "eu" ? "eu" : "us", "emblem", parsed.data.emblem.id), media(region === "eu" ? "eu" : "us", "border", parsed.data.border.id)]);
  return emblem && border ? <CrestImages crest={parsed.data} emblem={emblem} border={border} /> : <FactionEmblem faction={faction} />;
}
