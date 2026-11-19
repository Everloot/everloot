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
export default async function GuildCrest({ crest, region = "us" }: { crest?: Crest | null; region?: string }) {
  const parsed = CrestSchema.safeParse(crest);
  if (!parsed.success) return <p className="text-sm text-muted">No in-game crest stored.</p>;
  const [emblem, border] = await Promise.all([media(region === "eu" ? "eu" : "us", "emblem", parsed.data.emblem.id), media(region === "eu" ? "eu" : "us", "border", parsed.data.border.id)]);
  return emblem && border ? <CrestImages crest={parsed.data} emblem={emblem} border={border} /> : <p className="text-sm text-muted">In-game crest images are unavailable.</p>;
}
