/**
 * What the map shows while its render runs (the pins come from the corpus on every request). The same fixed
 * shell as WorldMapView, header to bottom edge, with the sidebar's column on a desk, so the map lands in
 * place without a jump.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" data-loading className="fixed inset-x-0 bottom-0 top-header z-30 flex flex-col bg-canvas md:flex-row">
      <div aria-hidden="true" className="hidden w-12 shrink-0 border-r border-line bg-panel md:block" />
      <div aria-hidden="true" className="hidden bg-panel md:block md:w-80 md:shrink-0 md:border-r md:border-line" />
    </div>
  );
}
