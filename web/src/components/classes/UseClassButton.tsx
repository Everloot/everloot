"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  classHubHref, classLabel, contextExtras, contextLabel, forgetClassContext, parseClassContext, readClassContext, rememberClassContext, sameContext,
  type ClassContext, type ClassSlug,
} from "@/lib/class-context";

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const NOT_KEPT = "This browser did not keep it: its site storage is off or full.";
const NOT_FORGOTTEN = "This browser could not forget it: its site storage is off.";

/** This browser's localStorage, or null when the browser refuses it (blocked site data). */
function deviceStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** What the browser remembers, read after mount so the first client render agrees with the server's markup. */
function useRemembered(): [ClassContext | null | undefined, (next: ClassContext | null) => void] {
  const [saved, setSaved] = useState<ClassContext | null | undefined>(undefined);
  useEffect(() => setSaved(readClassContext(deviceStorage())), []);
  return [saved, setSaved];
}

function Choice({ classSlug }: { classSlug: ClassSlug }) {
  // The page's class is its address, and the link's level and role come with it, read whole or not at all.
  const read = parseClassContext(useSearchParams() ?? new URLSearchParams(), classSlug);
  const context: ClassContext = (read.ok && read.context) || { classSlug };
  const extras = contextExtras(context);
  const [saved, setSaved] = useRemembered();
  const [failure, setFailure] = useState<string | null>(null);

  // Both report what reading the storage back shows, never what was asked for.
  const remember = () => {
    setFailure(rememberClassContext(deviceStorage(), context) ? null : NOT_KEPT);
    setSaved(readClassContext(deviceStorage()));
  };
  const forget = () => {
    setFailure(forgetClassContext(deviceStorage()) ? null : NOT_FORGOTTEN);
    setSaved(readClassContext(deviceStorage()));
  };

  return (
    <div data-class-context className="space-y-2 text-sm text-fg-2">
      {!read.ok && <p>{read.error} This page leaves the link&apos;s level and role out.</p>}
      {extras.length > 0 && (
        <p>
          From this link: {extras.join(", ")}.{" "}
          <Link href={classHubHref({ classSlug })} className={LINK}>Show {classLabel(classSlug)} without them</Link>
        </p>
      )}
      {saved !== undefined && (
        <div className="flex flex-wrap items-center gap-3">
          {saved && sameContext(saved, context) ? (
            <>
              <span role="status">Remembered on this browser.</span>
              <button type="button" onClick={forget} className={LINK}>Forget</button>
            </>
          ) : (
            <>
              {saved && <span>This browser remembers {contextLabel(saved)}. <Link href={classHubHref(saved)} className={LINK}>Open it</Link></span>}
              <button type="button" onClick={remember} className="btn text-sm">
                {saved ? `Remember ${contextLabel(context)} instead` : `Remember ${contextLabel(context)} on this browser`}
              </button>
            </>
          )}
        </div>
      )}
      {failure && <p role="alert" className="text-warning">{failure}</p>}
    </div>
  );
}

/**
 * On a class hub: the level and role the link adds, and a button that keeps the class with them on this browser.
 * A class the browser already remembers is named with a link to its hub; it never changes the page, its links or
 * the context the button keeps. Nothing is sent anywhere. The hub is built once per deploy, so the address is read
 * here, in the browser: the built page holds nothing in this place.
 */
export default function UseClassButton({ classSlug }: { classSlug: ClassSlug }) {
  return <Suspense fallback={null}><Choice classSlug={classSlug} /></Suspense>;
}

/** On the class index: the class this browser remembers, as a link to its hub. Nothing when there is none. */
export function RememberedClass() {
  const [saved] = useRemembered();
  if (!saved) return null;
  return (
    <p className="mb-4 text-sm text-fg-2">
      Remembered on this browser: <Link href={classHubHref(saved)} className={LINK}>{contextLabel(saved)}</Link>
    </p>
  );
}
