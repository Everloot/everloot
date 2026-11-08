import { Container } from "@/components/ui";

/**
 * What the database hub shows while its render runs (it reads the corpus on every request). The same column as
 * the page and a header the height of DataTitle's row, so nothing moves when the page arrives: a title block, a
 * meta line, the search field, then the row of scope chips SearchBar draws under it (`.ctl`: 40 px on a phone,
 * 32 px from `sm`). Only the hub: the lists and entity pages below /database keep their own 404s.
 */
export default function Loading() {
  return (
    <Container width="data">
      <div role="status" aria-label="Loading" data-loading>
        <div aria-hidden="true">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="h-[28px] w-48 rounded-sm bg-panel sm:h-[34px] sm:w-64" />
            <div className="h-5 w-72 max-w-full rounded-sm bg-panel" />
          </div>
          <div className="h-12 w-full rounded-control bg-panel" />
          <div className="mt-2 flex flex-wrap gap-2">
            {[10, 14, 14, 16, 16].map((w, i) => (
              <div key={i} className={`h-10 w-${w} rounded-[6px] bg-panel sm:h-8`} />
            ))}
          </div>
        </div>
      </div>
    </Container>
  );
}
