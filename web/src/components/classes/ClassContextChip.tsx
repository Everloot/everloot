"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import {
  classHubHref, contextLabel, contextLinks, parseClassContext, readClassContext, sameContext, switchClassContext, withoutClassContext,
  type ClassContext, type ClassSlug, type ContextDestination, type ContextRead,
} from "@/lib/class-context";

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** The class this browser remembers, read after mount so the first client render agrees with the server's markup. */
function useRemembered(): ClassContext | null {
  const [saved, setSaved] = useState<ClassContext | null>(null);
  useEffect(() => {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* blocked site data: nothing remembered */ }
    setSaved(readClassContext(storage));
  }, []);
  return saved;
}

/**
 * On a page a class context leads to: the context its address carries, in a chip that opens the class's hub, with a
 * cross that takes the context off the address and keeps everything else (`here`). A context the page could not read
 * is named with its reason and left out. `children` say what the context does on the page, shown only with one. A
 * class this browser remembers is offered beside it, never put in its place. Nothing is sent anywhere.
 *
 * A page rendered per request reads its address on the server and passes `read` and `here`. A page built once has
 * one markup for every address, so there `inPlace` changes the address without loading anything, keeping the state
 * the page holds in its #fragment: `inPlace.fragment`, handed in by the page as it is now (the raid planner's raid),
 * never read back from the address. `className` spaces it: under a list's filters by default, under a title else.
 */
export default function ClassContextChip({ read, here, inPlace, className = "mt-2", children }: { read: ContextRead; here: string; inPlace?: { fragment: string }; className?: string; children?: ReactNode }) {
  const remembered = useRemembered();
  const context = read.ok ? read.context : null;
  const offer = remembered && !(context && sameContext(remembered, context)) ? remembered : null;
  if (read.ok && !context && !offer) return null;

  // In place, the real href keeps the fragment, so a new tab or a copied link opens the same raid. Only a plain left
  // click changes this tab's address; a modified or middle click is the browser's.
  const to = (href: string) => {
    if (!inPlace) return { href };
    const target = `${href}${inPlace.fragment}`;
    return {
      href: target,
      onClick: (e: MouseEvent) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        // The link goes with the old address. When focus is on it or elsewhere in the chip, it moves to the page's title
        // rather than falling to the page's end; focus anywhere else stays where it is.
        const title = document.querySelector<HTMLElement>("h1");
        if (title && e.currentTarget.closest("[data-class-context]")?.contains(document.activeElement)) {
          if (!title.hasAttribute("tabindex")) title.tabIndex = -1;
          title.focus();
        }
        window.history.pushState(null, "", target);
      },
    };
  };

  return (
    <div data-class-context className={`${className} flex flex-wrap items-center gap-x-3 gap-y-1 text-cell-2 text-fg-2`}>
      {!read.ok && (
        <span>{read.error} This page leaves the class out. <Link {...to(here)} className={LINK}>Remove it</Link></span>
      )}
      {context && (
        <span className="inline-flex h-6 items-center rounded-full border border-edge pl-2">
          <Link href={classHubHref(context)} className="text-fg hover:underline underline-offset-4">{contextLabel(context)}</Link>
          {/* A 24 px target for the cross, the whole height of the chip. */}
          <Link {...to(here)} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-fg">
            <span aria-hidden="true">×</span><span className="sr-only">Remove {contextLabel(context)}</span>
          </Link>
        </span>
      )}
      {context && children}
      {offer && (
        <span>
          This browser remembers {contextLabel(offer)}.{" "}
          <Link {...to(switchClassContext(here, offer))} className={LINK}>Use it</Link>
        </span>
      )}
    </div>
  );
}

type FromAddressProps = { className?: string; fragment?: string };

function ChipFromAddress({ className, fragment = "" }: FromAddressProps) {
  const search = useSearchParams() ?? new URLSearchParams();
  const path = usePathname() ?? "/";
  return <ClassContextChip read={parseClassContext(search)} here={withoutClassContext(path, search)} className={className} inPlace={{ fragment }} />;
}

/**
 * The chip on a page built once (the raid planner): the class is read from the address here, in the browser, since
 * the built page holds none. `fragment` is the page's own state for its #fragment, as it is now ("" for none).
 */
export function ClassContextChipFromAddress(props: FromAddressProps) {
  return <Suspense fallback={null}><ChipFromAddress {...props} /></Suspense>;
}

type HubLinkProps = { classSlug: ClassSlug; to: Exclude<ContextDestination, "hub">; className?: string; children: ReactNode };

const hrefTo = (ctx: ClassContext, to: ContextDestination) => contextLinks(ctx).find((l) => l.key === to)!.href;

function HubLinkFromAddress({ classSlug, to, className, children }: HubLinkProps) {
  const read = parseClassContext(useSearchParams() ?? new URLSearchParams(), classSlug);
  return <Link href={hrefTo((read.ok && read.context) || { classSlug }, to)} className={className}>{children}</Link>;
}

/**
 * A class hub's link to a page its context leads to, with the level and role of the hub's own address. The hub is
 * built once per deploy, so its markup links with the class alone and the browser adds the rest.
 */
export function ClassContextLink(props: HubLinkProps) {
  const plain = <Link href={hrefTo({ classSlug: props.classSlug }, props.to)} className={props.className}>{props.children}</Link>;
  return <Suspense fallback={plain}><HubLinkFromAddress {...props} /></Suspense>;
}
