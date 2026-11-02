// A small game picture (a loading screen, a zone's map) at the start of a list row whose link already names
// the place, so it is decorative like GameIcon: empty alt, hidden from screen readers. Fixed width and height,
// so the row keeps its height before the file arrives. Rendered only when the page has the picture.
export default function ArtThumb({ src, width = 48, height = 28 }: { src: string; width?: number; height?: number }) {
  return (
    // The files come from the asset bucket as they are (already sized WebP); next/image would only proxy them.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      data-art-thumb
      className="inline-block shrink-0 rounded-sm border border-line object-cover align-middle"
      style={{ width, height }}
    />
  );
}
