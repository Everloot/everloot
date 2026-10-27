import Link from "next/link";
import type { ReactNode } from "react";
import { KeysRefresh, RemoveAccess } from "@/components/ApiKeys";
import { Callout } from "@/components/docs/blocks";
import { Badge, Card, GET_THE_ADDON } from "@/components/ui";
import type { AccountOverview } from "@/lib/account-overview";
import { guardOn } from "@/lib/data-guard";
import { DESKTOP_KEY_LABEL } from "@/lib/desktop-connect";

const subheading = "text-meta font-semibold text-fg-2";
const action = "btn min-h-11 px-3 text-sm";

/** In place of a logo: Everloot's diamond for its own apps, a few letters for the rest (no third-party logo is shipped). */
function Mark({ letters }: { letters?: string }) {
  return (
    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-control border border-line bg-canvas text-xs font-bold tracking-tight text-fg-2">
      {letters ?? (
        <svg viewBox="8 8 48 48" width="18" height="18" className="text-accent">
          <path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/**
 * One integration: its mark, its name (with a badge only where the badge is a fact), its line and the one thing to do.
 * The action sits at the foot of the card, so the actions of a row line up however long each line is.
 */
function Entry({ letters, name, badge, action, children }: { letters?: string; name: string; badge?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Card as="li" padding="none">
      <div className="flex h-full items-start gap-3 p-4">
        <Mark letters={letters} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 self-stretch">
          <div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-fg [overflow-wrap:anywhere]">{name}{badge}</p>
            {children}
          </div>
          {action && <div className="mt-auto">{action}</div>}
        </div>
      </div>
    </Card>
  );
}

/**
 * Integrations on /account. Connected is only what the server knows for this account: the Battle.net sign-in (it has
 * no unlink, so nothing to press) and each live key, the Desktop App's by the name its connect page gives it, each with
 * Remove access, which is the list's own Revoke. Claude, ChatGPT and the addon keep nothing per account, so they are
 * only ever Available, with a link to their docs or download; so is the Desktop App while it has no live key.
 */
export default function Integrations({ methods, name, overview }: { methods: string[]; name: string; overview: AccountOverview | null }) {
  const battlenet = methods.includes("battlenet");
  // The name is a BattleTag only when Battle.net is the one way in; otherwise it is the name the account chose.
  const battleTag = battlenet && methods.length === 1 ? name : null;
  // With keys on, no overview means the keys could not be read: say so, and claim nothing about the Desktop App.
  const unread = guardOn() && !overview;
  const live = overview?.keys?.liveKeys ?? [];
  const desktop = live.some((k) => k.label === DESKTOP_KEY_LABEL);
  return (
    <>
      {live.length > 0 && (
        <Callout>
          <p><strong className="font-semibold">Don&apos;t recognise an app or key?</strong> Remove its access. Anything using its key stops working at once.</p>
        </Callout>
      )}

      <div className="space-y-2 text-sm">
        <h3 id="connected-heading" tabIndex={-1} className={subheading}>Connected</h3>
        {battlenet || live.length > 0 ? (
          <ul aria-labelledby="connected-heading" className="grid gap-3 sm:grid-cols-2">
            {battlenet && (
              <Entry letters="BN" name="Battle.net" badge={<Badge tone="neutral">Sign-in</Badge>}>
                <p className="text-meta text-muted">{battleTag ?? "Linked to your account"}</p>
              </Entry>
            )}
            {live.map((k) => {
              const keyName = k.label || "Unnamed key";
              return (
                <Entry key={k.id} letters={k.label === DESKTOP_KEY_LABEL ? undefined : "API"} name={keyName}
                  action={<RemoveAccess id={k.id} name={keyName} hint={k.hint} focusAfter="connected-heading" />}>
                  <p className="text-meta text-muted">
                    <code className="font-mono">evl_…{k.hint}</code> · {k.last_used_at ? `Last used ${k.last_used_at.slice(0, 10)}` : "Never used"}
                  </p>
                </Entry>
              );
            })}
          </ul>
        ) : !unread && <p className="text-muted">Nothing is connected to your account.</p>}
        {unread && <p className="text-muted">Your keys could not be read right now, so apps that use one are not shown.</p>}
        <KeysRefresh />
      </div>

      <div className="space-y-2 text-sm">
        <h3 id="available-heading" className={subheading}>Available</h3>
        <ul aria-labelledby="available-heading" className="grid gap-3 sm:grid-cols-2">
          <Entry name="Everloot addon" action={<Link href={GET_THE_ADDON.href} className={action}>{GET_THE_ADDON.label}</Link>}>
            <p className="text-fg-2">Records what you see in WoW: Forever and saves it for you to upload.</p>
          </Entry>
          {!unread && !desktop && (
            <Entry name="Everloot Desktop App" action={<Link href="/addon#desktop" className={action}>Get the app</Link>}>
              <p className="text-fg-2">Uploads after each logout and puts community prices in your tooltips. Sign in from the app to connect it.</p>
            </Entry>
          )}
          <Entry letters="C" name="Claude" action={<Link href="/docs/mcp/clients#claude" className={action}>Connect<span className="sr-only"> Claude</span></Link>}>
            <p className="text-fg-2">Ask Claude about WoW: Forever. Add Everloot as a connector by URL. No key needed.</p>
          </Entry>
          <Entry letters="GPT" name="ChatGPT" action={<Link href="/docs/mcp/clients#chatgpt" className={action}>Connect<span className="sr-only"> ChatGPT</span></Link>}>
            <p className="text-fg-2">Ask ChatGPT about WoW: Forever. Add Everloot as a custom connector. No key needed.</p>
          </Entry>
        </ul>
      </div>
    </>
  );
}
