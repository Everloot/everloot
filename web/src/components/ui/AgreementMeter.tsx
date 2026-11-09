/** How many installs have reported a fact; three make it public. */
export type Agreement = 0 | 1 | 2 | 3;

export const AGREEMENT_NEEDED = 3;

/** "0 of 3 installs agree". Counts outside 0 to 3 are clamped; a fractional count rounds down. */
export function agreementLabel(count: number): string {
  return `${clampAgreement(count)} of ${AGREEMENT_NEEDED} installs agree`;
}

/** "1 of 3 installs reported": installs that reported the fact at all, whatever each one said. Clamped the same way. */
export function reportedLabel(count: number): string {
  return `${clampAgreement(count)} of ${AGREEMENT_NEEDED} installs reported`;
}

export function clampAgreement(count: number): Agreement {
  return Math.max(0, Math.min(AGREEMENT_NEEDED, Math.floor(Number.isFinite(count) ? count : 0))) as Agreement;
}

const SIZE = {
  sm: { gap: "gap-1.5", diamond: "h-2 w-2 border-[1.5px] rounded-[1px]" },
  lg: { gap: "gap-3.5", diamond: "h-5 w-5 border-2 rounded-[3px]" },
} as const;

/**
 * The logo's diamond, once per install: hollow until an install reports the fact, filled in the
 * accent when it has. Three filled means the fact is public. Read as one image with its count.
 */
export default function AgreementMeter({ count, size = "sm", withText = false }: { count: number; size?: "sm" | "lg"; withText?: boolean }) {
  const n = clampAgreement(count);
  const s = SIZE[size];
  return (
    <span className="inline-flex items-center gap-2" data-agreement={n}>
      <span role="img" aria-label={agreementLabel(n)} className={`inline-flex items-center ${s.gap} ${size === "lg" ? "px-1" : "px-0.5"}`}>
        {Array.from({ length: AGREEMENT_NEEDED }, (_, i) => (
          <span key={i} aria-hidden="true" className={`block rotate-45 ${s.diamond} ${i < n ? "border-accent bg-accent" : "border-edge"}`} />
        ))}
      </span>
      {withText && <span aria-hidden="true" className="font-mono text-xs tabular-nums text-muted">{n} of {AGREEMENT_NEEDED}</span>}
    </span>
  );
}
