"use client";

import Link from "next/link";
import { useState } from "react";
import { callbackUrl, DESKTOP_KEY_LABEL, sealForDesktop, type ConnectRequest } from "@/lib/desktop-connect";

const primary = "inline-flex items-center justify-center min-h-11 px-5 rounded-lg bg-accent text-bg text-sm font-semibold hover:bg-accent/90 disabled:opacity-60";
const secondary = "inline-flex items-center justify-center min-h-11 px-4 rounded-lg border border-line text-sm text-fg hover:text-accent disabled:opacity-60";

/**
 * The confirm step: Connect makes a key named "Everloot Desktop App" (with the saved-builds permission when
 * that feature is on, and permission to send character link codes while character links are on), seals it to the
 * app and sends the browser back to the app on this computer.
 */
export default function DesktopConnect({ request, name, links = false }: { request: ConnectRequest; name: string; links?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"connected" | "cancelled" | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: DESKTOP_KEY_LABEL, builds: true, ...(links ? { links: true } : {}) }) });
      const result = await response.json();
      if (!response.ok || typeof result.token !== "string") throw new Error(result.error ?? "That did not work. Try again.");
      const sealed = await sealForDesktop(result.token, request);
      setDone("connected");
      window.location.assign(callbackUrl(request, sealed));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
      setBusy(false);
    }
  }

  function cancel() {
    setDone("cancelled");
    window.location.assign(callbackUrl(request, { error: "denied" }));
  }

  return (
    <article className="max-w-xl space-y-6">
      <h1 className="text-3xl font-bold text-fg">Connect the Desktop App</h1>
      <p className="text-fg-2">Signed in as <b className="text-fg">{name}</b>. Connect the Everloot Desktop App on this computer to your account?</p>
      <ul className="list-disc pl-5 space-y-1 text-sm text-fg-2">
        <li>Chat and the in-game <code>/ask</code> count against your account, with a higher limit.</li>
        <li>Your saved talent builds sync into the game.</li>
        {links && <li>Codes you type with <code>/everloot link</code> in game are sent to your account, to link those characters.</li>}
        <li>It gets a key named <b>Everloot Desktop App</b>. You can revoke it any time on <Link href="/account" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">your account</Link>. Uploads never carry it, and the app never sees your Battle.net password.</li>
      </ul>
      {done === "connected" ? (
        <p role="status" className="text-fg">Connected. Go back to the Desktop App; you can close this tab. If the app does not show you signed in (it stops waiting after five minutes), press Sign in there again and revoke the unused key on <Link href="/account" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">your account</Link>.</p>
      ) : done === "cancelled" ? (
        <p role="status" className="text-fg-2">Cancelled. Nothing was made. You can close this tab.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} onClick={connect} disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
          <button type="button" className={secondary} onClick={cancel} disabled={busy}>Cancel</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-fg">{error} {/keys/.test(error) && <Link href="/account" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Manage your keys</Link>}</p>}
    </article>
  );
}
