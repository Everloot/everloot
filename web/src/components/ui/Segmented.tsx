import type { ReactNode } from "react";

export interface SegmentedOption<T> {
  value: T;
  label: ReactNode;
  /** Shown but not choosable; it stays in the tab order and says why through its label. */
  disabled?: boolean;
}

/**
 * A small set of choices that switch a view in place: talent set 1 or 2, raid size, which tree a
 * phone shows. Toggle buttons (aria-pressed) in one frame. Not Tabs: Tabs keep their state in the URL
 * hash, which these tools use for their share links.
 */
export default function Segmented<T extends string | number>({ label, options, value, onChange, stretch = false }: {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Fill the row, each option an equal share (a phone's tree switch). */
  stretch?: boolean;
}) {
  return (
    <div role="group" aria-label={label} data-segmented className={`${stretch ? "flex w-full" : "inline-flex"} max-w-full gap-0.5 rounded-control border border-line bg-canvas p-0.5`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            aria-disabled={!!o.disabled}
            onClick={() => { if (!o.disabled) onChange(o.value); }}
            className={`inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control border px-3 text-sm font-medium transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${stretch ? "flex-1" : ""} ${on ? "border-edge bg-panel text-fg" : "border-transparent text-fg-2 hover:text-fg"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
