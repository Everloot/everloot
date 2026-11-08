/**
 * What the world map shows while its render runs (the pins come from the corpus on every request). The same fixed
 * shell as WorldMapView, header to bottom edge, with the open sidebar's column on a desk (the rail only shows once
 * the sidebar is collapsed, world-map.css), so the map lands in place without a jump. `data-map-shell` keeps the
 * footer off and the body still while it loads, as for the real shell (globals.css). Only /map: a continent page
 * below it keeps its own 404.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" data-loading data-map-shell className="fixed inset-x-0 bottom-0 top-header z-30 flex flex-col bg-canvas md:flex-row">
      <div aria-hidden="true" className="hidden bg-panel md:block md:w-80 md:shrink-0 md:border-r md:border-line" />
    </div>
  );
}
