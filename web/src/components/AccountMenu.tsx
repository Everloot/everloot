"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AccountShell, AccountStatus, DeviceAccount } from "@/lib/account-shell-types";
import { SHELL_CHANGED_EVENT } from "@/lib/profiles";

// The signed-in side of the header (docs/design/specs/2026-10-20-account-shell-design.md): the "+" menu, the
// avatar bubble and its menu (the name there links to the account page), and the account switcher. Both menus are disclosures like Tools and the version
// label: a button with aria-expanded, Escape closes and returns focus, a click outside closes.

type MenuLink = { label: string; href: string };

export const CREATE_LINKS: MenuLink[] = [
  { label: "Plan a build", href: "/tools/talents" },
  { label: "Upload addon data", href: "/upload" },
  { label: "New character", href: "/me" },
];

// Written out so Tailwind sees each class name.
const CLASS_BG: Record<string, string> = {
  warrior: "bg-class-warrior", paladin: "bg-class-paladin", hunter: "bg-class-hunter",
  rogue: "bg-class-rogue", priest: "bg-class-priest", shaman: "bg-class-shaman",
  mage: "bg-class-mage", warlock: "bg-class-warlock", druid: "bg-class-druid",
};

/** "Thrall#1234" -> "T", "Jaina Proudmoore" -> "JP". */
export function initials(name: string): string {
  const words = name.replace(/#\d+$/, "").split(/[\s_.-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0]).join("");
  return letters.toUpperCase() || "?";
}

/** The avatar's fill: the main character's class colour, else the site accent. */
export function avatarClass(shell: AccountShell | null | undefined): string {
  const main = shell?.characters.find((c) => c.id === shell.mainCharacterId);
  return (main && CLASS_BG[main.classSlug]) || "bg-accent";
}

/** A status reads as unset after its clear time. */
export function currentStatus(status: AccountStatus | null | undefined, now = Date.now()): AccountStatus | null {
  if (!status || (!status.text && !status.emoji)) return null;
  if (status.clearsAt && Date.parse(status.clearsAt) <= now) return null;
  return status;
}

/**
 * The middle sections of the avatar menu. Every variant links to the account page by name, with API keys as a
 * second entry into it. Without a shell (EVERLOOT_PROFILES off), the links there are today.
 */
export function accountMenuSections(shell: AccountShell | null | undefined, savedBuilds: boolean): MenuLink[][] {
  const builds = savedBuilds ? [{ label: "Your builds", href: "/me" }] : [];
  const account = { label: "Your account", href: "/account" };
  const apiKeys = { label: "API keys", href: "/account#keys" };
  const desktop = { label: "Desktop App and addon", href: "/addon" };
  if (!shell) return [[...builds, account, apiKeys, desktop]];
  return [
    [
      { label: "Your profile", href: shell.handle ? `/u/${encodeURIComponent(shell.handle)}` : "/settings" },
      ...(savedBuilds ? [{ label: "Your characters", href: "/me" }] : []),
      ...builds,
    ],
    [account, apiKeys, desktop, { label: "Settings", href: "/settings" }],
  ];
}

export function Avatar({ name, fill = "bg-accent", size = "sm" }: { name: string; fill?: string; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-canvas ${box} ${fill}`}>
      {initials(name)}
    </span>
  );
}

function useDisclosure() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };
  return { open, setOpen, box, button, onKeyDown };
}

const itemClass = "flex min-h-11 w-full items-center rounded-control px-3 text-left text-sm text-fg-2 hover:bg-canvas hover:text-accent disabled:opacity-60";
const panelClass = "pop z-50 border-edge bg-panel p-2";

function PlusIcon() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>;
}
function Caret({ open }: { open: boolean }) {
  return <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className={open ? "rotate-180" : undefined}><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

/** "+": Plan a build, Upload addon data, and New character while saved builds are on (it is on /me). */
export function CreateMenu({ savedBuilds }: { savedBuilds: boolean }) {
  const menu = useDisclosure();
  const links = savedBuilds ? CREATE_LINKS : CREATE_LINKS.filter((link) => link.href !== "/me");
  return (
    <div ref={menu.box} className="relative" onKeyDown={menu.onKeyDown}>
      <button
        ref={menu.button}
        type="button"
        aria-label="Create new"
        aria-expanded={menu.open}
        aria-controls="create-menu"
        onClick={() => menu.setOpen(!menu.open)}
        className="inline-flex h-8 min-w-11 items-center justify-center gap-1 rounded-control border border-edge px-2 text-fg-2 hover:text-accent"
      ><PlusIcon /><Caret open={menu.open} /></button>
      <div id="create-menu" hidden={!menu.open} className={`${panelClass} absolute right-0 top-full mt-2 w-56 rounded-card border`}>
        <ul>
          {links.map((link) => (
            <li key={link.label}><a href={link.href} onClick={() => menu.setOpen(false)} className={itemClass}>{link.label}</a></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The multi-session plugin's limit: at 5 accounts a sixth sign-in would replace the current one. */
export const MAX_ACCOUNTS = 5;

/**
 * The accounts signed in on this browser, fetched once the menu first opens (not on every page). Null while
 * loading or not asked yet; `failed` when the route did not answer.
 */
function useDeviceAccounts(wanted: boolean) {
  const [accounts, setAccounts] = useState<DeviceAccount[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!wanted || accounts || failed) return;
    let active = true;
    fetch("/api/me/accounts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("accounts");
        const list = await response.json() as DeviceAccount[];
        if (active) setAccounts(list);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [wanted, accounts, failed]);
  return { accounts, failed };
}

/** The accounts signed in on this browser; picking one makes it current and reloads the page as that account. */
export function AccountSwitcher({ accounts, failed }: { accounts: DeviceAccount[] | null; failed: boolean }) {
  const [switchError, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const error = switchError ?? (failed ? "Accounts unavailable. Try again." : null);

  async function choose(userId: string) {
    setSwitching(userId);
    setError(null);
    try {
      const response = await fetch("/api/me/accounts/switch", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId }),
      });
      if (!response.ok) throw new Error("switch");
      // A full load, so every part of the page reads as the new account.
      window.location.reload();
    } catch {
      setError("Could not switch accounts. Try again.");
      setSwitching(null);
    }
  }

  return (
    <div id="account-switcher" className="border-t border-line pt-2">
      <p className="px-3 pb-1 font-mono text-xs text-muted">Switch account</p>
      {error && <p role="alert" className="px-3 py-2 text-sm text-fg">{error}</p>}
      {!accounts && !error && <p className="px-3 py-2 text-sm text-muted">Loading accounts</p>}
      {accounts && (
        <ul>
          {accounts.map((account) => {
            const label = (
              <>
                <Avatar name={account.displayName} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-fg">{account.displayName}</span>
                  {account.handle && <span className="block truncate text-xs text-muted">@{account.handle}</span>}
                </span>
              </>
            );
            return (
              <li key={account.userId}>
                {account.current ? (
                  <span aria-current="true" className={`${itemClass} gap-3 hover:bg-transparent hover:text-fg-2`}>
                    {label}
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" className="text-accent"><path d="m3 8.5 3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
                    <span className="sr-only">(current)</span>
                  </span>
                ) : (
                  <button type="button" disabled={switching !== null} aria-busy={switching === account.userId} onClick={() => choose(account.userId)} className={`${itemClass} gap-3`}>
                    {label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The avatar bubble and its menu, in GitHub's order. With `profiles` (EVERLOOT_PROFILES, from the layout) the
 * player's shell is fetched from /api/me/shell once the menu mounts; without it, or while it loads, or on 401, the
 * menu lists what exists today and nothing is fetched. `initialShell` only seeds it (tests). `accountSwitching`
 * (Better Auth on) shows Add another account, once the menu knows fewer than 5 accounts are on this browser.
 */
export function AvatarMenu({ name, initialShell = null, profiles = false, savedBuilds, accountSwitching, signingOut, onSignOut }: {
  name: string;
  initialShell?: AccountShell | null;
  profiles?: boolean;
  savedBuilds: boolean;
  accountSwitching: boolean;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const menu = useDisclosure();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [shell, setShell] = useState<AccountShell | null>(initialShell);
  const device = useDeviceAccounts(Boolean(shell) && (switcherOpen || (menu.open && accountSwitching)));
  const canAdd = Boolean(shell) && accountSwitching && device.accounts !== null && device.accounts.length < MAX_ACCOUNTS;

  useEffect(() => {
    if (!profiles) return;
    let active = true;
    const load = () => fetch("/api/me/shell", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as AccountShell;
        if (active && typeof data?.userId === "string") setShell(data);
      })
      .catch(() => {});
    load();
    // The home and settings announce a status or character change; show it without a reload.
    window.addEventListener(SHELL_CHANGED_EVENT, load);
    return () => { active = false; window.removeEventListener(SHELL_CHANGED_EVENT, load); };
  }, [profiles]);
  const shown = shell?.displayName || name;
  const fill = avatarClass(shell);
  const status = currentStatus(shell?.status);

  useEffect(() => { if (!menu.open) setSwitcherOpen(false); }, [menu.open]);

  return (
    <div ref={menu.box} className="relative" onKeyDown={menu.onKeyDown}>
      <button
        ref={menu.button}
        type="button"
        aria-label="Account menu"
        aria-expanded={menu.open}
        aria-controls="account-menu"
        onClick={() => menu.setOpen(!menu.open)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full"
      ><Avatar name={shown} fill={fill} /></button>
      {/* On phones a sheet that slides up from the bottom of the screen; from 640 px a dropdown under the bubble. */}
      <div
        id="account-menu"
        hidden={!menu.open}
        className={`${panelClass} sheet fixed inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-card border-t sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 sm:rounded-card sm:border`}
      >
        <div className="flex items-center gap-3 px-3 py-2">
          <Avatar name={shown} fill={fill} size="md" />
          <div className="min-w-0 flex-1">
            <a href="/account" className="block truncate font-semibold text-fg hover:underline underline-offset-4">{shown}</a>
            {shell && (shell.handle
              ? <p className="truncate text-sm text-muted">@{shell.handle}</p>
              : <a href="/settings" className="text-sm text-accent hover:underline underline-offset-4">Choose a handle</a>)}
          </div>
          {shell && (
            <button
              type="button"
              aria-label="Switch account"
              aria-expanded={switcherOpen}
              aria-controls="account-switcher"
              onClick={() => setSwitcherOpen(!switcherOpen)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-fg-2 hover:text-accent"
            >⇄</button>
          )}
        </div>
        {switcherOpen && <AccountSwitcher accounts={device.accounts} failed={device.failed} />}
        {shell && (
          <a href="/settings#status" className={`${itemClass} gap-2 border-t border-line`}>
            {status ? <>{status.emoji && <span>{status.emoji}</span>}<span className="truncate">{status.text}</span></> : "Set status"}
          </a>
        )}
        {accountMenuSections(shell, savedBuilds).map((section, i) => (
          <ul key={i} className="border-t border-line py-1">
            {section.map((link) => <li key={link.label}><a href={link.href} className={itemClass}>{link.label}</a></li>)}
          </ul>
        ))}
        <ul className="border-t border-line pt-1">
          {canAdd && <li><a href="/sign-in?add=1" className={itemClass}>Add another account</a></li>}
          <li>
            <button type="button" disabled={signingOut} aria-busy={signingOut} onClick={onSignOut} className={itemClass}>Sign out</button>
          </li>
        </ul>
      </div>
    </div>
  );
}
