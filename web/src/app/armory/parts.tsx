import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { BLIZZARD_CREDIT, NAME_PATTERN, readLine, SURNAME_PATTERN } from "@/lib/armory";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

/**
 * What every armory page shares. The pages carry no ad component (Blizzard Developer API Terms): a test reads every
 * file in this folder for one.
 */

/** Every armory page stays out of search engines for now. */
export const NOINDEX = { index: false, follow: false } as const;
export const NOT_FOUND_METADATA: Metadata = { title: "Page not found", robots: NOINDEX };
export const armoryMetadata = (page: { title: string; description: string; path: string }): Metadata => ({ ...pageMetadata(page), robots: NOINDEX });

export const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export const day = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : null);

/** The credit line and the time of the newest read, on every armory page. */
export function ArmoryCredit({ at }: { at: string | null | undefined }) {
  return (
    <p className="text-meta text-muted" data-armory-credit>
      {BLIZZARD_CREDIT}. {at ? <time dateTime={at}>{readLine(at)}</time> : readLine(null)}.
    </p>
  );
}

export const Unreachable = () => <Card><p className="text-fg-2" role="status">{STORAGE_UNREACHABLE}</p></Card>;

/** Above a form when storage did not answer: the form still shows, and says sending may fail. */
export const FormUnreachable = () => <p role="status" className="text-meta text-warning">{STORAGE_UNREACHABLE} Sending this form may fail until it is back.</p>;

/** The newest of some read times, or null. */
export function newest(times: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const t of times) if (t && Number.isFinite(Date.parse(t)) && (best === null || Date.parse(t) > Date.parse(best))) best = t;
  return best;
}

/** The region, name and surname fields the hide and add forms share. */
export function CharacterFields({ region, name, surname }: { region?: string; name?: string; surname?: string }) {
  const field = "w-full min-h-11 rounded-control border border-edge bg-canvas px-3 text-fg placeholder:text-muted focus:border-accent";
  return (
    <>
      <div className="space-y-1">
        <label htmlFor="armory-region" className="text-sm text-fg">Region</label>
        <select id="armory-region" name="region" required defaultValue={region === "us" ? "us" : "eu"} className={field}>
          <option value="eu">Europe (EU)</option>
          <option value="us">Americas (US)</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="armory-name" className="text-sm text-fg">Name</label>
        <input id="armory-name" name="name" required minLength={2} maxLength={24} pattern={NAME_PATTERN} autoComplete="off" defaultValue={name ?? ""} className={field} />
      </div>
      <div className="space-y-1">
        <label htmlFor="armory-surname" className="text-sm text-fg">Surname</label>
        <input id="armory-surname" name="surname" required minLength={2} maxLength={24} pattern={SURNAME_PATTERN} autoComplete="off" defaultValue={surname ?? ""} className={field} />
      </div>
    </>
  );
}
