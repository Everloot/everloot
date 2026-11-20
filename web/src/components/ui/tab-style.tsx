// The look Tabs and LinkTabs share. Kept out of Tabs.tsx, a client module, so the server-rendered
// LinkTabs can call it.

/**
 * One tab: 32 px tall with 13 px text (40 px on a phone), the accent underline when open. An empty tab ("Sold by (0)")
 * is drawn quieter, regular weight in the muted colour with no hover, so the tabs with rows stand out.
 */
export const tabClass = (on: boolean, empty: boolean) =>
  `inline-flex min-h-control-sm shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-control transition-colors sm:min-h-control ${
    on ? "border-accent font-medium text-fg" : empty ? "border-transparent font-normal text-muted" : "border-transparent font-medium text-fg-2 hover:text-fg"}`;

/** A row of tabs that scrolls sideways on a phone without drawing a scrollbar under it. */
export const TAB_SCROLL = "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** "Dropped by (3)": the count beside the label, as data pages list it. */
export function TabCount({ count }: { count: number }) {
  // The space is for the text a screen reader or a copy gets; in the flex row the margin draws it.
  return <span className="ml-1 tabular-nums text-muted">{` (${count})`}</span>;
}

/**
 * The tabs a strip draws: the ones with rows, or with no count (a list that could not be read, a tab that is not a
 * count of rows). A "(0)" tab is left out; with none left the page says so in one line instead of a strip.
 */
export const filledTabs = <T extends { count?: number }>(tabs: readonly T[]): T[] => tabs.filter((t) => t.count !== 0);
