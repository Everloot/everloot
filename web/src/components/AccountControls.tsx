"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountShell } from "@/lib/account-shell-types";
import { AvatarMenu, CreateMenu } from "./AccountMenu";

type Status = "loading" | "anonymous" | "signed-in" | "unavailable";

/** Dispatched on window when Sign out leaves no account signed in on this tab. The route refresh after it keeps
 *  client state, so a page that holds the account's data in the browser (Plans on this device) listens for it,
 *  hides that data and asks who is signed in now. A sign-out that hands over to another account reloads instead. */
export const ACCOUNT_CHANGED_EVENT = "everloot:account-changed";

/**
 * The header's account area. Signed out: Sign in and Get the addon. Signed in: the "+" menu and the avatar menu.
 * The account is looked up here; the avatar menu fetches the player's shell itself. `initialShell` seeds it (tests).
 * `place="menu"` keeps Sign in (or Retry) and the addon link reachable on narrow phones.
 */
export default function AccountControls({ savedBuilds = false, initialShell = null, profiles = false, accountSwitching = false, place = "bar" }: {
  savedBuilds?: boolean;
  initialShell?: AccountShell | null;
  /** EVERLOOT_PROFILES: the avatar menu fetches the player's shell only with it on. */
  profiles?: boolean;
  accountSwitching?: boolean;
  place?: "bar" | "menu";
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [name, setName] = useState("");
  const [retry, setRetry] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controlClass = "inline-flex items-center min-h-11 px-2 text-sm text-fg-2 hover:text-accent disabled:opacity-60";

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError(null);
    async function checkAccount() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (!response.ok) throw new Error("Account lookup failed");
        const { user } = await response.json();
        if (!active) return;
        setStatus(user ? "signed-in" : "anonymous");
        setName(typeof user?.name === "string" ? user.name : "");
      } catch {
        if (active) { setStatus("unavailable"); setError("Account unavailable. Try again."); }
      }
    }
    void checkAccount();
    return () => { active = false; };
  }, [retry]);

  async function signOut() {
    setSigningOut(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const result = response.ok ? await response.json() : null;
      if (result?.ok !== true) throw new Error("Logout failed");
      // Another account signed in on this browser is now the current one.
      if (result.next === true) { window.location.reload(); return; }
      setStatus("anonymous");
      window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
      router.refresh();
    } catch {
      setError("Sign out failed. Try again.");
    } finally {
      setSigningOut(false);
    }
  }

  const alert = error && <p role="alert" className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-line bg-canvas p-3 text-sm text-fg">{error}</p>;
  const signIn = status === "anonymous" ? <a href="/sign-in" className={controlClass}>Sign in</a>
    : status === "unavailable" ? <button type="button" aria-label="Retry account status" onClick={() => setRetry(retry + 1)} className={controlClass}>Retry</button>
    : <button type="button" disabled aria-busy="true" className={controlClass}>Account</button>;

  if (place === "menu") {
    return status === "signed-in" ? null : <div className="flex flex-wrap gap-2 border-t border-line pt-4 sm:hidden">{signIn}<a href="/addon" className={controlClass}>Get the addon</a></div>;
  }

  return (
    <div className="relative flex shrink-0 items-center gap-2">
      {status === "signed-in" ? (
        <>
          <CreateMenu savedBuilds={savedBuilds} />
          <AvatarMenu name={name} initialShell={initialShell} profiles={profiles} savedBuilds={savedBuilds} accountSwitching={accountSwitching} signingOut={signingOut} onSignOut={signOut} />
        </>
      ) : (
        <>
          <span className="hidden sm:inline-flex">{signIn}</span>
          <a href="/addon" className="btn btn-primary hidden min-h-8 shrink-0 whitespace-nowrap px-4 text-sm min-[400px]:inline-flex">Get the addon</a>
        </>
      )}
      {alert}
    </div>
  );
}
