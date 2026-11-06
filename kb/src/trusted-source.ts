/**
 * Everloot's own installs, trusted on their own while few players upload.
 *
 * The market and the census publish a number only when 3 reporters agree, so one person's scans can't put
 * forged prices or counts on the site. Before many players upload, that leaves the pages empty. The install
 * ids in EVERLOOT_TRUSTED_INSTALLS (comma-separated, a Worker secret) are Everloot's own: their scans and
 * census rows carry TRUSTED_REPORTER in place of the address hash, and a day or a count with that reporter
 * in it is public even under 3. Everyone else still needs 3. Pages that show such a value say so.
 *
 * Address hashes are 16 hex characters, so the marker can't match one.
 */

export const TRUSTED_REPORTER = "everloot";

/** What a page says beside a value that is public because Everloot's own installs reported it. */
export const TRUSTED_SOURCE_LABEL = "includes Everloot's own scans";

/** The install ids in a comma- or whitespace-separated list, such as EVERLOOT_TRUSTED_INSTALLS. */
export function trustedInstalls(list: string | undefined): ReadonlySet<string> {
  return new Set((list ?? "").split(/[\s,]+/).map((id) => id.trim()).filter(Boolean));
}
