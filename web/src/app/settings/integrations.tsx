import Link from "next/link";
import type { ReactNode } from "react";
import { KeysRefresh, RemoveAccess } from "@/components/ApiKeys";
import { Callout } from "@/components/docs/blocks";
import { Badge, Card, GET_THE_ADDON } from "@/components/ui";
import type { AccountOverview } from "@/lib/account-overview";
import type { KeyRow } from "@/lib/api-keys";
import { guardOn } from "@/lib/data-guard";
import { DESKTOP_KEY_LABEL } from "@/lib/desktop-connect";
import { MCP_URL } from "@/lib/docs/connect-data";
import { timeAgo } from "@/lib/time";
import ProviderLogo, { hasProviderLogo } from "@/components/ProviderLogo";
import SocialSignIn from "@/components/SocialSignIn";
import { PROVIDER_NAMES, type SocialProvider } from "@/lib/auth/social";

const subheading = "text-meta font-semibold text-fg-2";
const action = "btn min-h-11 px-3 text-sm";
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const grid = "grid gap-3 sm:grid-cols-2";

/**
 * The entry's mark: a sign-in provider's logo where ProviderLogo has one, Everloot's diamond for its own apps, a few
 * letters for the rest. Claude and ChatGPT keep letters: the repo ships no licensed mark for either (ProviderLogo and
 * THIRD_PARTY.md list the marks it may use), and none is fetched or drawn here.
 */
function Mark({ letters, provider }: { letters?: string; provider?: string }) {
  return (
    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-control border border-line bg-canvas text-xs font-bold tracking-tight text-fg-2">
      {provider && hasProviderLogo(provider) ? <ProviderLogo provider={provider} size={20} /> : letters ?? (
        <svg viewBox="8 8 48 48" width="18" height="18" className="text-accent">
          <path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/** Connected (accent), not connected or not known (grey), or could not be checked (red). The words carry the state; the dot repeats it. */
type State = "connected" | "off" | "error";
const DOT: Record<State, string> = { connected: "bg-accent", off: "bg-muted", error: "bg-danger" };

function Status({ state, children }: { state: State; children: ReactNode }) {
  return (
    <p data-status={state} className="flex flex-wrap items-center gap-x-2 text-meta text-fg-2">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[state]}`} />
      {children}
    </p>
  );
}

/** One client's setup steps, closed until asked for. Native <details>, so it opens without JavaScript. */
function HowTo({ name, children }: { name: string; children: ReactNode }) {
  return (
    <details data-how-to className="group text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-fg underline decoration-edge underline-offset-4 hover:decoration-fg [&::-webkit-details-marker]:hidden">
        How to connect<span className="sr-only"> {name}</span>
        <span aria-hidden="true" className="font-mono text-muted transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="space-y-2 pb-1 text-fg-2">{children}</div>
    </details>
  );
}

/**
 * One integration: its mark, its name (with a badge only where the badge is a fact), its status and line, and the one
 * thing to do. The action sits at the foot of the card, so the actions of a row line up however long each line is.
 */
function Entry({ letters, provider, name, badge, action, children }: { letters?: string; provider?: string; name: string; badge?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Card as="li" padding="none">
      <div className="flex h-full items-start gap-3 p-4">
        <Mark letters={letters} provider={provider} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 self-stretch">
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-fg [overflow-wrap:anywhere]">{name}{badge}</p>
            {children}
          </div>
          {action && <div className="mt-auto">{action}</div>}
        </div>
      </div>
    </Card>
  );
}

/** "last used 2 h ago" from the key's own last_used_at, which the database writes at most once a minute per key. */
function lastUsed(k: KeyRow, now: number): ReactNode {
  if (!k.last_used_at) return "never used";
  const at = Date.parse(k.last_used_at);
  if (!Number.isFinite(at)) return "never used";
  return <>last used <time dateTime={k.last_used_at} title={`${k.last_used_at.slice(0, 16).replace("T", " ")} UTC`}>{timeAgo(at, now)}</time></>;
}

/** A live key as a connection: its name, its last four characters, when it was last used, and Disconnect (its Revoke). */
function KeyEntry({ k, now }: { k: KeyRow; now: number }) {
  const desktopKey = k.label === DESKTOP_KEY_LABEL;
  const keyName = desktopKey ? "Desktop App key" : k.label || "Unnamed key";
  return (
    <Entry letters={desktopKey ? undefined : "API"} name={keyName}
      action={<RemoveAccess id={k.id} name={keyName} hint={k.hint} focusAfter="apps-heading" />}>
      <Status state="connected">Connected · {lastUsed(k, now)}</Status>
      <p className="text-meta text-muted"><code className="font-mono">evl_…{k.hint}</code></p>
    </Entry>
  );
}

/** Claude and ChatGPT use the public MCP server without a key, so the account holds nothing about them to show. */
function AssistantEntry({ letters, name, id, children }: { letters: string; name: string; id: string; children: ReactNode }) {
  return (
    <Entry letters={letters} name={name} action={<HowTo name={name}>{children}<p><Link href={`/docs/mcp/clients#${id}`} className={link}>Full steps in the docs</Link></p></HowTo>}>
      <Status state="off">Not tracked</Status>
      <p className="text-fg-2">
        {name} reaches Everloot&apos;s MCP server without a key, so your account keeps no record of it and cannot show
        whether it is connected. To disconnect it, remove the connector in {name}.
      </p>
    </Entry>
  );
}

const Endpoint = () => <p>The address: <code className="font-mono text-fg [overflow-wrap:anywhere]">{MCP_URL}</code></p>;

/**
 * Integrations on /settings. Connected is only what the server knows for this account: the sign-ins (Battle.net has
 * no unlink, so nothing to press) and each live key, with when it was last used and Disconnect, which is the key
 * list's own Revoke. A key with the name the Desktop App's connect page gives is the "Desktop App key": a name is not
 * proof the app is installed. Claude and ChatGPT keep nothing per account, so they say so (Not tracked) rather than
 * claim a state; a key given to either shows with the other keys. With keys on but unread, the Desktop App is an error,
 * not "not connected".
 */
export default function Integrations({ methods, name, overview, availableLogins = [], now = Date.now() }: {
  methods: string[]; name: string; overview: AccountOverview | null; availableLogins?: (SocialProvider | "battlenet")[]; now?: number;
}) {
  const battlenet = methods.includes("battlenet");
  const logins = methods.filter((method) => PROVIDER_NAMES[method]);
  const toLink = availableLogins.filter((provider) => !methods.includes(provider));
  // The name is a BattleTag only when Battle.net is the one way in; otherwise it is the name the account chose.
  const battleTag = battlenet && methods.length === 1 ? name : null;
  // With keys on, no overview means the keys could not be read: say so, and claim nothing about the Desktop App.
  const unread = guardOn() && !overview;
  const live = overview?.keys?.liveKeys ?? [];
  const desktopKeys = live.filter((k) => k.label === DESKTOP_KEY_LABEL);
  const otherKeys = live.filter((k) => k.label !== DESKTOP_KEY_LABEL);
  return (
    <>
      {live.length > 0 && (
        <Callout>
          <p><strong className="font-semibold">Don&apos;t recognise an app or key?</strong> Disconnect it. Anything using its key stops working at once.</p>
        </Callout>
      )}

      <div id="sign-in-methods" className="scroll-mt-20 space-y-2 text-sm">
        <h3 id="sign-in-heading" className={subheading}>Sign-in methods</h3>
        {logins.length > 0 ? (
          <ul aria-labelledby="sign-in-heading" className={grid}>
            {battlenet && (
              <Entry letters="BN" name="Battle.net" badge={<Badge tone="neutral">Sign-in</Badge>}>
                <Status state="connected">Connected · {battleTag ?? "linked to your account"}</Status>
              </Entry>
            )}
            {logins.filter((method) => method !== "battlenet").map((method) => (
              <Entry key={method} letters={PROVIDER_NAMES[method].slice(0, 2)} provider={method} name={PROVIDER_NAMES[method]} badge={<Badge tone="neutral">Sign-in</Badge>}>
                <Status state="connected">Connected · linked to your account</Status>
              </Entry>
            ))}
          </ul>
        ) : <p className="text-muted">None.</p>}
        {toLink.length > 0 && (
          <div className="space-y-3 pt-2">
            <p className="text-fg-2">Link another login to sign in to this same Everloot account. Your saved builds and API keys stay here.</p>
            <SocialSignIn providers={toLink} mode="link" />
          </div>
        )}
      </div>

      <div className="space-y-2 text-sm">
        <h3 id="apps-heading" tabIndex={-1} className={subheading}>Apps and assistants</h3>
        <ul aria-labelledby="apps-heading" className={grid}>
          {desktopKeys.map((k) => <KeyEntry key={k.id} k={k} now={now} />)}
          {desktopKeys.length === 0 && (
            <Entry name="Everloot Desktop App" action={(
              <HowTo name="the Desktop App">
                <ol className="list-decimal space-y-1 pl-5">
                  <li><Link href="/addon#desktop" className={link}>Download the Desktop App</Link> and open it.</li>
                  <li>Choose Sign in with everloot.app, during setup or under Settings &gt; Account in the app.</li>
                  <li>In your browser, sign in and press Connect.</li>
                  <li>It gets a key named Everloot Desktop App, which then shows here with when it was last used.</li>
                </ol>
              </HowTo>
            )}>
              {unread ? <Status state="error">Could not check</Status> : <Status state="off">Not connected</Status>}
              <p className="text-fg-2">Uploads after each logout and puts community prices in your tooltips.</p>
            </Entry>
          )}
          <AssistantEntry letters="C" name="Claude" id="claude">
            <Endpoint />
            <ol className="list-decimal space-y-1 pl-5">
              <li>In Claude, open Customize, then Connectors.</li>
              <li>Add a connector by URL and paste the address.</li>
              <li>Once it shows Connected, turn it on in a chat from the plus menu.</li>
            </ol>
          </AssistantEntry>
          <AssistantEntry letters="GPT" name="ChatGPT" id="chatgpt">
            <Endpoint />
            <ol className="list-decimal space-y-1 pl-5">
              <li>In ChatGPT&apos;s settings, under Apps and Connectors, create a connector named Everloot.</li>
              <li>Paste the address and choose no authentication. Some plans need Developer mode turned on first.</li>
              <li>Turn the connector on for a chat.</li>
            </ol>
          </AssistantEntry>
          <Entry name="Everloot addon" action={<Link href={GET_THE_ADDON.href} className={action}>{GET_THE_ADDON.label}</Link>}>
            <p className="text-fg-2">Records what you see in WoW: Forever and saves it for you to upload. It does not sign in, so there is nothing to connect.</p>
          </Entry>
        </ul>
        {unread && <p className="text-muted">Your keys could not be read right now, so apps that use one are not shown.</p>}
      </div>

      {otherKeys.length > 0 && (
        <div className="space-y-2 text-sm">
          <h3 id="keys-in-use-heading" className={subheading}>Keys in use</h3>
          <p className="text-fg-2">Each live key and when it was last used. A key you gave an assistant or a script shows here.</p>
          <ul aria-labelledby="keys-in-use-heading" className={grid}>
            {otherKeys.map((k) => <KeyEntry key={k.id} k={k} now={now} />)}
          </ul>
        </div>
      )}
      <KeysRefresh />
    </>
  );
}
