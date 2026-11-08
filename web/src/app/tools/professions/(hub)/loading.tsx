import { Container } from "@/components/ui";

/**
 * What the profession hub shows while its render runs (its icons come from the asset upload on every request).
 * The same wide column as the page and a header the height of PageHeader's: a title block, a lede line and a
 * meta line, then the "Professions" heading and the grid of 64 px cards, so nothing moves when the page arrives.
 * Only the hub: a profession page below it keeps its own 404.
 */
export default function Loading() {
  return (
    <Container>
      <div role="status" aria-label="Loading" data-loading>
        <div aria-hidden="true">
          <div className="mb-4">
            <div className="h-[28px] w-64 rounded-sm bg-panel sm:h-[34px] sm:w-80" />
            <div className="mt-1 h-5 w-full max-w-[75ch] rounded-sm bg-panel" />
            <div className="mt-2 h-5 w-56 rounded-sm bg-panel" />
          </div>
          <div className="space-y-4">
            <div className="h-6 w-32 rounded-sm bg-panel" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="min-h-16 rounded-card border border-line bg-panel" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}
