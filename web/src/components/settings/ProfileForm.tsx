"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui";
import { PROFILE_LIMITS, shellChanged } from "@/lib/profiles";
import type { ProfileSettings } from "@/lib/account-shell";

const box = "h-4 w-4 shrink-0 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

/** Handle, display name, and whether /u/<handle> is public and what it shows. */
export default function ProfileForm({ profile, accountName }: { profile: ProfileSettings; accountName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPublic, setPublic] = useState(profile.publicProfile);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/me/profile", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: form.get("handle"), displayName: form.get("displayName"), publicProfile: isPublic,
          showCharacters: form.get("showCharacters") === "on", showBuilds: form.get("showBuilds") === "on", showStatus: form.get("showStatus") === "on",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "That did not work. Try again.");
      setSaved(true);
      shellChanged();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Profile" className="grid min-w-0 gap-x-4 gap-y-5 sm:grid-cols-2">
      <label className="block min-w-0 space-y-2 text-sm">
        <span className="block text-fg-2">Handle</span>
        <Input name="handle" defaultValue={profile.handle ?? ""} maxLength={PROFILE_LIMITS.handleMax} autoComplete="off" spellCheck={false}
          pattern="@?[A-Za-z0-9][A-Za-z0-9\-]{1,22}[A-Za-z0-9]" placeholder="3 to 24 letters, numbers or hyphens" />
        <span className="block text-xs text-muted">Your address: /u/handle. Up to 5 changes a day.</span>
      </label>
      <label className="block min-w-0 space-y-2 text-sm">
        <span className="block text-fg-2">Display name (optional)</span>
        <Input name="displayName" defaultValue={profile.displayName ?? ""} maxLength={PROFILE_LIMITS.displayName} autoComplete="off" placeholder={accountName} />
      </label>
      <fieldset className="min-w-0 space-y-3 rounded-control border border-line bg-panel p-4 text-sm sm:col-span-2">
        <legend className="sr-only">Public profile</legend>
        <label className="flex items-center gap-2 text-fg">
          <input type="checkbox" name="publicProfile" aria-describedby="profile-sharing-description" className={box} checked={isPublic} onChange={(e) => setPublic(e.target.checked)} />
          Public profile
        </label>
        <p id="profile-sharing-description" className="text-sm leading-relaxed text-fg-2">Off: nobody else sees anything. On: anyone can open your profile and sees only what you tick below. Never your BattleTag or email.</p>
        <div className="grid gap-x-5 gap-y-1 border-t border-line pt-2 sm:grid-cols-3">
          <label className="flex min-h-11 items-center gap-2 text-fg-2"><input type="checkbox" name="showCharacters" className={box} defaultChecked={profile.showCharacters} />Characters</label>
          <label className="flex min-h-11 items-center gap-2 text-fg-2"><input type="checkbox" name="showBuilds" className={box} defaultChecked={profile.showBuilds} />Shared builds</label>
          <label className="flex min-h-11 items-center gap-2 text-fg-2"><input type="checkbox" name="showStatus" className={box} defaultChecked={profile.showStatus} />Status</label>
        </div>
      </fieldset>
      <div className="flex min-w-0 flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn btn-primary min-h-11 px-4 text-sm" disabled={busy} aria-busy={busy}>Save profile</button>
        {saved && <p role="status" className="text-sm text-accent">Saved.</p>}
        {error && <p role="alert" className="w-full rounded-control border border-edge bg-panel px-3 py-2 text-sm text-fg [overflow-wrap:anywhere]">{error}</p>}
      </div>
    </form>
  );
}
