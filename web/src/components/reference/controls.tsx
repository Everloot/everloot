"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CodeBlock, CopyButton } from "@/components/ui";
import { tabClass } from "@/components/ui/tab-style";
import { CLASS_LAYOUTS, REFERENCE_CLASSES, type AbilityRole } from "@/data/reference-spells";

const BUTTON = "rounded-control border border-line bg-panel px-3 py-2 text-sm text-fg hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
export interface ChecklistItem { id: string; text: string; href?: string; linkText?: string }

export function Checklist({ storageKey, items }: { storageKey: string; items: ChecklistItem[] }) {
  const [checked, setChecked] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let stored: string | null;
    try {
      stored = localStorage.getItem(storageKey);
    } catch { setUnavailable(true); return; }
    try {
      const saved: unknown = JSON.parse(stored ?? "[]");
      setChecked(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string" && items.some((item) => item.id === id)) : []);
    } catch { setChecked([]); }
  }, [storageKey, items]);
  function toggle(id: string) {
    const next = checked.includes(id) ? checked.filter((v) => v !== id) : [...checked, id];
    setChecked(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setUnavailable(false); }
    catch { setUnavailable(true); }
  }
  return <div className="space-y-3">
    <p className="text-sm text-muted">Your checklist stays on this device. It is not sent to Everloot.</p>
    <ul className="space-y-3">{items.map((item) => <li key={item.id}>
      <label className="flex items-start gap-3"><input type="checkbox" checked={checked.includes(item.id)} onChange={() => toggle(item.id)} className="mt-1 h-5 w-5 accent-accent" /><span>{item.text}</span></label>
      {item.href && <Link href={item.href} className="ml-8 text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{item.linkText ?? "Database entry"}</Link>}
    </li>)}</ul>
    {unavailable && <p role="status" className="text-sm text-warning">This browser cannot save the checklist. You can still use it until you leave this page.</p>}
  </div>;
}

export function CopyMacro({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState("");
  return <div className="space-y-2">
    <CodeBlock label={`${label} macro`}>{text}</CodeBlock>
    <CopyButton text={text} label="Copy" aria-label={`Copy ${label} macro`} onResult={(ok) => setStatus(ok ? "Copied." : "Select and copy the macro text above. Clipboard access is unavailable.")} />
    <p role="status" className="text-sm text-muted">{status}</p>
  </div>;
}

const ROLES: Record<AbilityRole, string> = { interrupt: "Interrupt", defensive: "Defensive", "crowd-control": "Crowd control", cooldowns: "Cooldowns" };
const KEYS: { key: string; role?: AbilityRole; movement?: string }[][] = [
  [{ key: "1" }, { key: "2" }, { key: "3" }, { key: "4" }, { key: "5" }],
  [{ key: "Q", role: "interrupt" }, { key: "W", movement: "Move forward" }, { key: "E", role: "crowd-control" }, { key: "R", role: "cooldowns" }],
  [{ key: "A", movement: "Strafe left" }, { key: "S", movement: "Move backward" }, { key: "D", movement: "Strafe right" }, { key: "F", role: "defensive" }],
  [{ key: "Space", movement: "Jump" }],
];
const className = (name: string) => name[0].toUpperCase() + name.slice(1);

export function KeyboardMap() {
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<ReactNode>("Select a key to read its purpose. Every suggested binding can be changed in game.");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const classSlug = REFERENCE_CLASSES[selected];
  const layout = CLASS_LAYOUTS[classSlug];
  function select(index: number, focus = false) {
    setSelected(index); setDetail("Select a key to read its purpose. Every suggested binding can be changed in game.");
    if (focus) tabs.current[index]?.focus();
  }
  return <div className="space-y-5">
    <div role="tablist" aria-label="Class keyboard layouts" className="flex flex-wrap gap-2 border-b border-line">{REFERENCE_CLASSES.map((cls, i) => <button key={cls} type="button" role="tab" id={`${id}-${cls}`} aria-controls={`${id}-panel`} aria-selected={selected === i} tabIndex={selected === i ? 0 : -1} ref={(node) => { tabs.current[i] = node; }} className={tabClass(selected === i, false)} onClick={() => select(i)} onKeyDown={(event) => {
      let next: number;
      if (event.key === "ArrowRight") next = (i + 1) % REFERENCE_CLASSES.length;
      else if (event.key === "ArrowLeft") next = (i + REFERENCE_CLASSES.length - 1) % REFERENCE_CLASSES.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = REFERENCE_CLASSES.length - 1;
      else return;
      event.preventDefault(); select(next, true);
    }}>{className(cls)}</button>)}</div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${classSlug}`} className="space-y-4">
      <p className="text-sm text-muted">Suggested layout, not the client defaults. This map covers a left-hand keyboard cluster. Number keys are left for your own attacks or heals.</p>
      <div className="space-y-2" aria-label={`${className(classSlug)} keyboard map`}>{KEYS.map((row, i) => <div key={i} className="flex flex-wrap gap-2">{row.map(({ key, role, movement }) => {
        const spell = role ? layout[role] : undefined;
        const purpose = movement ?? (role ? `${ROLES[role]}: ${spell?.name ?? "Not confirmed yet"}` : "Unassigned: choose your own ability");
        return <button key={key} type="button" data-key={key} aria-label={`${key}: ${purpose}`} className={`${BUTTON} min-h-16 min-w-16 flex-1`} onClick={() => setDetail(<>{key}: {purpose}{spell && <span className="mt-2 block">Game-file tooltip: {spell.evidence.replaceAll("[?]", "[Not confirmed yet]")}</span>}</>)}><span className="block font-mono font-semibold">{key}</span><span className="block text-xs text-muted">{movement ?? (role ? ROLES[role] : "Unassigned")}</span></button>;
      })}</div>)}</div>
      <p role="status" className="rounded-card border border-line bg-panel p-4">{detail}</p>
      <p className="text-sm text-muted">Unresolved tooltip values are marked “Not confirmed yet”. Restrictions in the tooltip still apply.</p>
      <dl className="space-y-3">{Object.entries(ROLES).map(([role, label]) => { const spell = layout[role as AbilityRole]; return <div key={role}><dt className="font-semibold">{label}</dt><dd>{spell ? <Link href={`/database/spells/${spell.id}`} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{spell.name}</Link> : "Not confirmed yet — left empty in this draft."}</dd></div>; })}</dl>
    </div>
  </div>;
}
