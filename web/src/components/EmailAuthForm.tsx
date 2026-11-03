"use client";

import { useState, type FormEvent } from "react";

type Mode = "sign-in" | "sign-up" | "request-reset" | "reset";

const input = "min-h-11 w-full rounded-control border border-edge bg-canvas px-3 text-sm text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const button = "btn btn-primary w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait";

// Where each form posts, and the body Better Auth expects.
function request(mode: Mode, form: FormData, token?: string, returnTo = "/account"): [string, object] {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  switch (mode) {
    case "sign-in": return ["/api/auth/sign-in/email", { email, password, callbackURL: returnTo }];
    case "sign-up": return ["/api/auth/sign-up/email", { name: String(form.get("name") ?? "").trim(), email, password, callbackURL: returnTo }];
    case "request-reset": return ["/api/auth/request-password-reset", { email, redirectTo: "/reset-password" }];
    case "reset": return ["/api/auth/reset-password", { newPassword: password, token }];
  }
}

const label: Record<Mode, [idle: string, busy: string]> = {
  "sign-in": ["Sign in", "Signing in…"],
  "sign-up": ["Make my account", "Making your account…"],
  "request-reset": ["Send reset link", "Sending…"],
  reset: ["Save new password", "Saving…"],
};

const done: Record<Mode, string> = {
  "sign-in": "",
  "sign-up": "Check your inbox: we sent a link to confirm your email. It works for one hour.",
  "request-reset": "If that email has an Everloot account, a reset link is on its way.",
  reset: "Your password is changed. Sign in with the new one.",
};

/**
 * The email forms on /sign-in, /sign-up and /reset-password. They post to Better Auth's routes on this site.
 * `returnTo` is where a sign-in, or the confirmation link of a sign-up, lands: a path the page has already checked;
 * /account without one.
 */
export default function EmailAuthForm({ mode, token, returnTo = "/account" }: { mode: Mode; token?: string; returnTo?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [url, body] = request(mode, new FormData(event.currentTarget), token, returnTo);
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { message?: string; code?: string };
      if (response.status === 429) throw new Error("Too many tries. Wait a minute and try again.");
      if (result.code === "EMAIL_NOT_VERIFIED") throw new Error("Confirm your email first: use the link we sent you.");
      if (!response.ok) throw new Error(result.message ?? "That did not work. Try again.");
      if (mode === "sign-in") { window.location.assign(returnTo); return; }
      setMessage(done[mode]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (message) return <p role="status" className="text-fg-2">{message}</p>;
  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-3">
      {mode === "sign-up" && (
        <label className="block text-sm text-fg-2">Name shown on Everloot
          <input name="name" required maxLength={40} autoComplete="nickname" className={`${input} mt-1`} />
        </label>
      )}
      {mode !== "reset" && (
        <label className="block text-sm text-fg-2">Email
          <input name="email" type="email" required autoComplete="email" className={`${input} mt-1`} />
        </label>
      )}
      {mode !== "request-reset" && (
        <label className="block text-sm text-fg-2">{mode === "reset" ? "New password" : "Password"}
          <input name="password" type="password" required minLength={mode === "sign-in" ? undefined : 10} maxLength={128}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"} className={`${input} mt-1`} />
          {mode !== "sign-in" && <span className="block mt-1 text-xs text-muted">At least 10 characters.</span>}
        </label>
      )}
      <button type="submit" className={button} disabled={busy} aria-busy={busy}>
        {label[mode][busy ? 1 : 0]}
      </button>
      {error && <p role="alert" className="text-sm text-fg">{error}</p>}
    </form>
  );
}
