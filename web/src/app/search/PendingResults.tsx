"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The /search results under the page's search box. The box is a plain GET form, so the browser keeps this page up
 * until the next one is rendered; a new query submitted from the box swaps the results for the searching line at once,
 * so the last query's results (or its "No results for …") never read as the new query's answer. A page shown again
 * from the history gets its results back.
 */
export default function PendingResults({ q, children }: { q: string; children: ReactNode }) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const submitted = (e: SubmitEvent) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || !form.matches("[data-search-bar]")) return;
      const next = String(new FormData(form).get("q") ?? "").trim();
      if (next && next !== q) setPending(true);
    };
    const shown = () => setPending(false);
    document.addEventListener("submit", submitted);
    window.addEventListener("pageshow", shown);
    return () => { document.removeEventListener("submit", submitted); window.removeEventListener("pageshow", shown); };
  }, [q]);
  return pending ? <p role="status" className="py-4 text-cell text-fg-2">Searching…</p> : <>{children}</>;
}
