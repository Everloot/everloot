"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { viewHref } from "./overview";

export const REMEMBERED_SLOT = "everloot.completion.character.v1";

type Remembered = { install: string; character: string };

function read(): Remembered | null {
  try {
    const v = JSON.parse(localStorage.getItem(REMEMBERED_SLOT) ?? "null") as Partial<Remembered> | null;
    return v && typeof v.install === "string" && v.install && typeof v.character === "string" ? { install: v.install, character: v.character } : null;
  } catch {
    return null;
  }
}

/**
 * Keeps one install id and character key in this browser's storage, so the overview can be opened again
 * without typing them. Nothing is sent anywhere. With nothing chosen it offers the remembered one back.
 */
export default function RememberCharacter({ install, character }: { install: string; character: string }) {
  // Read after mount, so the server's markup and the first client render agree.
  const [saved, setSaved] = useState<Remembered | null>(null);
  useEffect(() => setSaved(read()), []);

  const current = install.trim() ? { install: install.trim(), character: character.trim() } : null;
  const isSaved = Boolean(current && saved && saved.install === current.install && saved.character === current.character);

  const remember = () => {
    if (!current) return;
    try { localStorage.setItem(REMEMBERED_SLOT, JSON.stringify(current)); } catch { /* storage off: nothing to keep */ }
    setSaved(read());
  };
  const forget = () => {
    try { localStorage.removeItem(REMEMBERED_SLOT); } catch { /* storage off */ }
    setSaved(null);
  };

  if (!current) {
    if (!saved) return null;
    return (
      <p data-remember className="text-sm text-fg-2">
        <Link href={viewHref({ install: saved.install, character: saved.character })} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">
          Open the character you remembered
        </Link>
        <span className="font-mono text-xs text-muted"> {saved.character || "all characters"}</span>
      </p>
    );
  }
  return (
    <div data-remember className="flex flex-wrap items-center gap-3 text-sm text-fg-2">
      {isSaved ? (
        <>
          <span role="status">Remembered on this browser.</span>
          <button type="button" onClick={forget} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Forget</button>
        </>
      ) : (
        <button type="button" onClick={remember} className="btn text-sm">Remember this character on this browser</button>
      )}
    </div>
  );
}
