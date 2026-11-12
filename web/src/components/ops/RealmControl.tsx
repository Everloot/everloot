"use client";

import { useId, useState } from "react";
import { opsRealmLabel } from "@/lib/ops/realm";

export default function RealmControl({ realm, onFilter }: { realm: string; onFilter: (realm: string) => void }) {
  const { label, ruleset } = opsRealmLabel(realm);
  const id = useId();
  const [open, setOpen] = useState(false);
  return <span className="relative inline-flex flex-wrap items-center gap-1">
    <span className="group relative inline-flex">
      <button type="button" onClick={() => onFilter(realm)} aria-describedby={id} className="min-h-11 text-left text-fg-2 underline decoration-edge underline-offset-4 hover:text-accent">{label}</button>
      <span id={id} role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-10 hidden w-max max-w-64 rounded-control border border-edge bg-panel p-2 text-meta text-fg group-hover:block group-focus-within:block">{realm}</span>
    </span>
    {ruleset && <span className={`rounded-full border border-current px-2 text-xs ${ruleset === "PvP" ? "text-danger" : "text-blue-post"}`}>{ruleset}</span>}
    <button type="button" aria-label={`Realm details: ${realm}`} aria-expanded={open} aria-controls={`${id}-detail`} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }} className="min-h-11 min-w-11 text-muted hover:text-fg">ⓘ</button>
    {open && <span id={`${id}-detail`} className="basis-full break-words text-meta text-fg-2">{realm}</span>}
  </span>;
}
