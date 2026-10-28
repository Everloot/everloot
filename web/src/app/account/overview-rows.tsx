import Link from "next/link";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Facts, type Fact } from "@/components/ui";
import type { AccountOverview } from "@/lib/account-overview";
import { KEYS_PER_ACCOUNT } from "@/lib/api-keys";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const methodNames: Record<string, string> = { battlenet: "Battle.net", credential: "Email and password" };
const count = (n: number) => n.toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/**
 * The overview on /account: one dense list of what the account has. Rows behind a switch that is off are left
 * out; with no overview (storage trouble) only the sign-in rows and the Desktop App links show.
 */
export default function OverviewRows({ name, methods, overview }: { name: string; methods: string[]; overview: AccountOverview | null }) {
  const battlenetOnly = methods.length === 1 && methods[0] === "battlenet";
  const items: Fact[] = [
    { label: battlenetOnly ? "BattleTag" : "Account name", value: name },
    { label: "Signs in with", value: methods.map((m) => methodNames[m] ?? m).join(", ") },
  ];
  if (overview) {
    const { memberSince, profile, characters, builds, keys } = overview;
    if (memberSince) items.push({ label: "Member since", value: day(memberSince) });
    if (profile) {
      items.push(
        { label: "Handle", value: profile.handle ? `@${profile.handle}` : <Link href="/settings" className={link}>Choose one</Link> },
        {
          label: "Public profile",
          value: profile.publicProfile && profile.handle ? <Link href={`/u/${profile.handle}`} className={link}>/u/{profile.handle}</Link> : "Off",
        },
        {
          label: "Main character",
          value: profile.main
            ? <span className={CLASS_TEXT[profile.main.classSlug] ?? "text-fg"}>{profile.main.name}</span>
            : characters ? <Link href="/settings#characters" className={link}>Pick one</Link> : "None",
        },
      );
    }
    if (characters !== null) items.push({ label: "Characters", value: count(characters), numeric: true });
    if (builds !== null) items.push({ label: "Saved builds", value: <Link href="/me" className={link}>{count(builds)}</Link>, numeric: true });
    if (keys) {
      items.push(
        { label: "API keys", value: <a href="#keys" className={link}>{count(keys.live)} of {KEYS_PER_ACCOUNT}</a>, numeric: true },
        { label: "Requests, last 7 days", value: count(keys.requests), numeric: true },
      );
    }
  }
  const keys = overview?.keys;
  items.push({
    label: "Desktop App",
    value: (
      <>
        {keys && <>{keys.desktop ? "Has a key" : "No key"} · </>}
        <Link href="/addon#desktop" className={link}>Download</Link> · <Link href="/docs/guides/desktop" className={link}>Guide</Link>
      </>
    ),
  });
  return <Facts layout="list" label="Account overview" items={items} />;
}
