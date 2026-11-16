"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { CLASSES } from "@/design/tokens";
import { classLabel, forgetClassContext, parseClassContext, readClassContext, rememberClassContext, type ClassContext } from "@/lib/class-context";
import { startHref, type StartTile } from "@/lib/start-here";

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
const Choice = createContext<{ context: ClassContext | null; choose: (value: string) => void; failure: string | null }>({ context: null, choose: () => {}, failure: null });

/** The server's links remain usable before hydration; only the class links change after reading this device. */
export function StartClassProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<ClassContext | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { setContext(readClassContext(storage())); }, []);
  const choose = (value: string) => {
    const read = parseClassContext(value ? { class: value } : {});
    if (!read.ok) return;
    const next = read.context && context?.classSlug === read.context.classSlug ? context : read.context;
    setContext(next);
    const kept = next ? rememberClassContext(storage(), next) : forgetClassContext(storage());
    setFailure(kept ? null : `This browser could not ${read.context ? "remember your class" : "forget your class"}. Your choice works on this page only.`);
  };
  return <Choice.Provider value={{ context, choose, failure }}>{children}</Choice.Provider>;
}

export function ClassSelect() {
  const { context, choose, failure } = useContext(Choice);
  const id = useId();
  return (
    <div className="mb-4 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={id} className="font-medium text-fg">Your class</label>
        <select id={id} value={context?.classSlug ?? ""} onChange={(e) => choose(e.target.value)} aria-describedby={`${id}-note`}
          className="min-h-11 rounded-control border border-edge bg-panel px-3 py-2 text-base text-fg">
          <option value="">All classes</option>
          {CLASSES.map((slug) => <option key={slug} value={slug}>{classLabel(slug)}</option>)}
        </select>
        <span id={`${id}-note`} className="text-muted">Remember on this device for talent and class links. Changing class replaces any remembered level and role.</span>
      </div>
      <p role="status" className="text-warning">{failure}</p>
    </div>
  );
}

export function ClassStartLink({ tile, children }: { tile: StartTile; children: ReactNode }) {
  const { context } = useContext(Choice);
  return <Link href={startHref(tile, context)} prefetch={false} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{children}</Link>;
}
