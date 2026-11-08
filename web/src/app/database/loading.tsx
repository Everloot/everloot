import { Container } from "@/components/ui";

/**
 * What a database page shows while its render runs (the hub and the lists read the corpus on every request).
 * The same column as the page and a header the height of DataTitle's row, so nothing moves when the page
 * arrives: a title block, a meta line, then the search field.
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
        </div>
      </div>
    </Container>
  );
}
