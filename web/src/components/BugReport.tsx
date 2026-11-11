"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CONTACT_EMAIL, DISCORD_INVITE } from "@/lib/jsonld";
import { isProtectedPath } from "@/lib/document-boundary";

function reportPage(path: string): string {
  if (isProtectedPath(path) || /\/(?:auth|sign-in|sign-up|reset-password|invite|join|link|connect|upload|me|hide)(?:\/|$)/.test(path)) return "Private page (URL omitted)";
  return `https://everloot.app${path}`;
}

/** A report is only sent when the player finishes the existing form on GitHub, or contacts us themselves. */
export default function BugReport() {
  const pathname = usePathname();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => { dialog.current?.close(); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = before; };
  }, [open]);

  const query = new URLSearchParams({ template: "bug-report.yml", labels: "bug", page });

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Report a bug"
        aria-haspopup="dialog"
        title="Report a bug"
        className="fixed left-4 z-40 inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-edge bg-panel px-3 text-sm text-accent transition-colors hover:border-accent hover:bg-canvas"
        style={{ bottom: "calc(max(1rem, var(--cookie-clearance, 0px)) + env(safe-area-inset-bottom, 0px))" }}
        onClick={() => {
          setPage(reportPage(window.location.pathname));
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 3 1 2m5-2-1 2M8 9a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0V9Zm0 3h8m-4 0v7M4 7l4 3m12-3-4 3M3 13h5m8 0h5M4 19l4-3m12 3-4-3" />
        </svg>
        <span className="hidden sm:inline">Report a bug</span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="bug-report-heading"
        aria-describedby="bug-report-description"
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-card border border-edge bg-panel p-6 text-fg backdrop:bg-canvas/80"
        onClose={() => { setOpen(false); trigger.current?.focus(); }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>("button, a[href]");
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="bug-report-heading" className="text-lg font-semibold">Found a bug?</h2>
          <button type="button" aria-label="Close bug report" className="-mr-3 -mt-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-fg-2 hover:text-accent" onClick={() => dialog.current?.close()}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <p id="bug-report-description" className="mt-2 text-sm text-fg-2">Tell us what happened and what you expected. Steps to reproduce it and a screenshot help, too.</p>
        <div className="mt-4 rounded-control border border-line bg-canvas p-3 text-sm">
          <p className="font-medium">Included with your report</p>
          <p className="mt-1 break-all text-fg-2">{page}</p>
          <p className="mt-2 text-xs text-muted">Query strings, URL fragments and private page addresses are left out. No logs or account details are collected.</p>
        </div>
        <a href={`https://github.com/Everloot/everloot/issues/new?${query}`} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-5 min-h-11 w-full justify-center px-4 text-sm">Report on GitHub</a>
        <p className="mt-2 text-xs text-fg-2">Opens in a new tab. Requires a GitHub account. Review your report there before posting; GitHub issues are public.</p>
        <div className="mt-5 border-t border-line pt-4 text-sm text-fg-2">
          <p>No GitHub account?</p>
          <a href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Report in Discord</a>
          <span className="mx-2">or</span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="inline-flex min-h-11 items-center text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Email us</a>
        </div>
      </dialog>
    </>
  );
}
