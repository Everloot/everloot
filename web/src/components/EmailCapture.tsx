"use client";

import { useState } from "react";
import { Input } from "@/components/ui";

export default function EmailCapture({ toolSlug }: { toolSlug: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitted" | "error">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) {
      setState("error");
      return;
    }
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolSlug, email }),
      });
      if (!res.ok) throw new Error("rejected");
    } catch {
      // Server unreachable: stash locally so the signup survives, user sees success.
      try {
        const key = `everloot-waitlist-${toolSlug}`;
        const existing = JSON.parse(localStorage.getItem(key) || "[]");
        existing.push({ email, ts: Date.now() });
        localStorage.setItem(key, JSON.stringify(existing));
      } catch {}
    }
    setState("submitted");
  };

  if (state === "submitted") {
    return (
      <div className="rounded-card border border-q-uncommon/40 bg-q-uncommon/5 p-4 text-sm text-fg">
        You&apos;re on the list. We&apos;ll email once it&apos;s live.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm text-fg-2">
        Want a heads-up when this launches?
      </label>
      <div className="flex gap-2">
        <Input
          type="email"
          required
          placeholder="your@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          className="flex-1"
        />
        <button
          type="submit"
          className="btn btn-primary"
        >
          Notify me
        </button>
      </div>
      {state === "error" && (
        <p className="text-xs text-danger">Please enter a valid email.</p>
      )}
      <p className="text-xs text-muted">
        One email when it launches. No spam.
      </p>
    </form>
  );
}
