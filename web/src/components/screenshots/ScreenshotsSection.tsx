"use client";

/* eslint-disable @next/next/no-img-element -- screenshots are WebPs the server already sized; next/image would only add an optimizer hop and a second copy. */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { SectionHeading } from "@/components/ui";
import { signInPath } from "@/lib/auth/return-to";
import {
  OWN_SCREENSHOTS_ROUTE, SCREENSHOTS_ROUTE, SCREENSHOT_ACCEPT, SCREENSHOT_LIMITS, screenshotFileHref, screenshotReviewHref,
  type GalleryScreenshot, type OwnScreenshot, type OwnScreenshotsView, type ScreenshotEntityType,
} from "@/lib/screenshots-shared";

const TRY_AGAIN = "That did not work. Try again.";
const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const QUIET = "btn min-h-11 px-4 text-sm";
const SMALL = "min-h-11 px-2 text-sm text-fg-2 underline decoration-edge underline-offset-4 hover:text-fg hover:decoration-fg";
const MB = SCREENSHOT_LIMITS.fileBytes / 1024 / 1024;
const TYPES = SCREENSHOT_ACCEPT.split(",");
const STATUS: Record<OwnScreenshot["status"], string> = { pending: "Waiting for review", approved: "Shown on this page", rejected: "Not approved" };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

type Note = { kind: "ok" | "error"; text: string } | null;

/**
 * Player screenshots on an entity page. Nothing loads until the section is close to the screen. The gallery comes from
 * /screenshots without cookies, the same answer for everyone, so it is cached and the page's HTML never carries it; the
 * viewer and their own uploads come from /screenshots/mine, never cached. Only approved screenshots are in the gallery.
 */
export default function ScreenshotsSection({ type, id, name }: { type: ScreenshotEntityType; id: number; name: string }) {
  const pathname = usePathname();
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [gallery, setGallery] = useState<GalleryScreenshot[] | null>(null);
  const [own, setOwn] = useState<OwnScreenshotsView | null>(null);
  const [failed, setFailed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: "600px 0px" });
    if (section.current) observer.observe(section.current);
    return () => observer.disconnect();
  }, []);

  const load = useCallback(async () => {
    try {
      const query = `?type=${type}&id=${id}`;
      const [shots, mine] = await Promise.all([
        fetch(`${SCREENSHOTS_ROUTE}${query}`, { credentials: "omit" }),
        fetch(`${OWN_SCREENSHOTS_ROUTE}${query}`, { cache: "no-store" }),
      ]);
      if (!shots.ok || !mine.ok) throw new Error("unavailable");
      setGallery(((await shots.json()) as { screenshots: GalleryScreenshot[] }).screenshots);
      setOwn(await mine.json() as OwnScreenshotsView);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [type, id]);
  useEffect(() => { if (near) void load(); }, [near, load]);

  function pick(chosen: File | null) {
    setNote(null);
    if (chosen && chosen.size > SCREENSHOT_LIMITS.fileBytes) {
      setFile(null);
      setNote({ kind: "error", text: `A screenshot can be up to ${MB} MB.` });
      return;
    }
    if (chosen && chosen.type && !TYPES.includes(chosen.type)) {
      setFile(null);
      setNote({ kind: "error", text: "Choose a PNG, JPEG or WebP picture." });
      return;
    }
    setFile(chosen);
  }

  async function send(request: () => Promise<Response>, done: string): Promise<boolean> {
    setBusy(true);
    setNote(null);
    try {
      const response = await request();
      const answer = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setNote({ kind: "error", text: answer.error ?? TRY_AGAIN });
        return false;
      }
      setNote({ kind: "ok", text: done });
      await load();
      return true;
    } catch {
      setNote({ kind: "error", text: TRY_AGAIN });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    const viewer = own?.viewer;
    if (!viewer || !file || !confirmed) return;
    const form = new FormData();
    form.append("type", type);
    form.append("id", String(id));
    form.append("confirm", "yes");
    form.append("file", file);
    const ok = await send(
      () => fetch(SCREENSHOTS_ROUTE, { method: "POST", headers: { "x-everloot-expected-owner": viewer.id }, body: form }),
      "Thanks. A moderator will look at it before it shows here.",
    );
    if (ok) {
      setFile(null);
      setConfirmed(false);
      setFormKey((k) => k + 1);
    }
  }

  async function remove(shot: OwnScreenshot) {
    const viewer = own?.viewer;
    if (!viewer) return;
    const ok = await send(() => fetch(OWN_SCREENSHOTS_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json", "x-everloot-expected-owner": viewer.id },
      body: JSON.stringify({ action: "delete", screenshotId: shot.id }),
    }), "Your screenshot is deleted.");
    if (ok) setDeleting(null);
  }

  function form() {
    if (!own) return null;
    const viewer = own.viewer;
    if (!viewer) {
      return <p className="text-sm text-fg-2"><a href={signInPath(`${pathname}#screenshots`)} className={LINK}>Sign in</a> to add a screenshot.</p>;
    }
    if (!viewer.handle) {
      return (
        <p className="text-sm text-fg-2">
          Choose a handle on <a href="/settings" className={LINK}>your settings page</a> to add a screenshot. Screenshots are credited to your handle, never your BattleTag.
        </p>
      );
    }
    return (
      <form key={formKey} onSubmit={(e) => void upload(e)} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="block text-muted">Add a screenshot as @{viewer.handle}</span>
          <input type="file" name="file" accept={SCREENSHOT_ACCEPT} onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="block w-full max-w-full text-sm text-fg-2 file:mr-3 file:min-h-11 file:rounded-control file:border file:border-edge file:bg-canvas file:px-4 file:text-fg" />
        </label>
        <label className="flex items-start gap-2 text-sm text-fg-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 size-4 shrink-0" />
          <span>
            I took this screenshot myself, and I give Everloot a licence to show it on this site, credited to my handle (<a href="/terms#screenshots" className={LINK}>terms</a>).
          </span>
        </label>
        <p className="text-xs text-muted">
          PNG, JPEG or WebP, up to {MB} MB, {SCREENSHOT_LIMITS.perDay} a day. We save a copy as WebP, at most {SCREENSHOT_LIMITS.maxSide} px wide, with
          its hidden details (camera, place, editing app) removed. A moderator checks every screenshot before it shows. Keep chat, names and other
          players&apos; details out of the picture.
        </p>
        <button type="submit" className="btn btn-primary min-h-11 px-4 text-sm" disabled={busy || !file || !confirmed} aria-busy={busy}>Upload screenshot</button>
      </form>
    );
  }

  function mine() {
    const shots = own?.mine ?? [];
    if (!own?.viewer || !shots.length) return null;
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-fg">Your screenshots on this page</h3>
        <ul className="border-b border-edge">
          {shots.map((shot) => (
            <li key={shot.id} className="flex flex-wrap items-center gap-3 border-t border-edge py-3">
              {shot.status !== "rejected" && (
                <img src={shot.status === "pending" ? screenshotReviewHref(shot.id) : screenshotFileHref(shot.id)} alt="" width={96} height={54}
                  loading="lazy" decoding="async" className="h-14 w-24 rounded-control border border-edge object-cover" />
              )}
              <p className="min-w-0 flex-1 text-sm text-fg-2">
                <span className="font-medium text-fg">{STATUS[shot.status]}</span> · <time dateTime={shot.createdAt}>{day(shot.createdAt)}</time>
              </p>
              {deleting === shot.id
                ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <button type="button" className={QUIET} disabled={busy} onClick={() => void remove(shot)}>Delete screenshot</button>
                    <button type="button" className={QUIET} onClick={() => setDeleting(null)}>Cancel</button>
                  </span>
                )
                : <button type="button" data-delete className={SMALL} onClick={() => setDeleting(shot.id)}>Delete</button>}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section ref={section} aria-labelledby="screenshots" className="mt-8">
      <SectionHeading id="screenshots" note="Players' own pictures of this, checked by a moderator before they show.">Screenshots</SectionHeading>
      <div className="space-y-4">
        {failed
          ? <p role="status" className="text-sm text-fg-2">Screenshots are unavailable right now. <button type="button" className={SMALL} onClick={() => void load()}>Try again</button></p>
          : !gallery
            ? <p role="status" className="text-sm text-muted">{near ? "Loading screenshots…" : "Screenshots load as you scroll here."}</p>
            : gallery.length
              ? (
                <>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {gallery.map((shot) => (
                    <li key={shot.id}>
                      <figure className="space-y-1">
                        <a href={screenshotFileHref(shot.id)} className="block">
                          <img src={screenshotFileHref(shot.id)} width={shot.width} height={shot.height} loading="lazy" decoding="async"
                            alt={`Screenshot of ${name}${shot.author ? `, by @${shot.author}` : ""}`}
                            className="h-auto w-full rounded-control border border-edge bg-canvas" />
                        </a>
                        <figcaption className="text-xs text-muted">
                          {shot.author ? `@${shot.author}` : "A player"} · <time dateTime={shot.approvedAt}>{day(shot.approvedAt)}</time>
                        </figcaption>
                      </figure>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">
                  Game art in these screenshots © Blizzard Entertainment, shown as fan-site use; each picture by the player named. Not affiliated with or endorsed by Blizzard.
                </p>
                </>
              )
              : <p className="text-sm text-muted">No screenshots yet.</p>}
        {form()}
        {note && <p role={note.kind === "error" ? "alert" : "status"} className="text-sm text-fg">{note.text}</p>}
        {mine()}
      </div>
    </section>
  );
}
