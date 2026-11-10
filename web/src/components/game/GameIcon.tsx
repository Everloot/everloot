import { QUALITY_BORDER, type Quality } from "@/components/ui/quality";

// A game icon beside a text label that already names the thing, so it is decorative: empty alt and
// hidden from screen readers. Fixed width and height, so it takes its place before the file arrives.
// Rendered only when the page has an icon URL; without the asset URL nothing here is drawn.
export default function GameIcon({ src, size = 20, quality, className = "" }: { src: string; size?: number; quality?: Quality; className?: string }) {
  return (
    // The files come from the asset bucket as they are (already small WebP); next/image would only proxy them.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      data-game-icon
      className={`inline-block shrink-0 rounded-sm border ${quality ? QUALITY_BORDER[quality] : "border-[#3d3a2e]"} align-middle ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
