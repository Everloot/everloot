import { Container } from "@/components/ui";

/**
 * What a profession page shows while its render runs (the recipes come from the game files on every request).
 * The same column as the page and a header the height of PageHeader's: a title block, a lede line and a meta
 * line, so nothing moves when the page arrives.
 */
export default function Loading() {
  return (
    <Container>
      <div role="status" aria-label="Loading" data-loading>
        <div aria-hidden="true" className="mb-4">
          <div className="h-[28px] w-64 rounded-sm bg-panel sm:h-[34px] sm:w-80" />
          <div className="mt-1 h-5 w-full max-w-[75ch] rounded-sm bg-panel" />
          <div className="mt-2 h-5 w-56 rounded-sm bg-panel" />
        </div>
      </div>
    </Container>
  );
}
