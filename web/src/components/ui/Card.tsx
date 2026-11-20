import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "className" | "children"> {
  /** A card that is one link: the whole card is the target, and its border answers the pointer. */
  href?: string;
  /** Dashed edge: what the card shows comes from the game files and no player has confirmed it. */
  unconfirmed?: boolean;
  /**
   * `default` is 24 px, `sm` 16 px for tiles and list cards. `none` for a card whose content (a table, a list with its
   * own rows) runs to the edge. `custom` leaves the padding to `className` (a responsive or uneven inset).
   */
  padding?: "default" | "sm" | "none" | "custom";
  as?: "div" | "section" | "article" | "li";
  className?: string;
  children: ReactNode;
  [data: `data-${string}`]: string | number | boolean | undefined;
}

const PADDING: Record<NonNullable<CardProps["padding"]>, string> = { default: "p-6", sm: "p-4", none: "overflow-hidden", custom: "" };

/** The one card: panel fill, hairline edge, 12 px corners, no shadow. */
export default function Card({ href, unconfirmed = false, padding = "default", as: Tag = "div", className = "", children, ...rest }: CardProps) {
  const classes = [
    "block min-w-0 rounded-card border bg-panel",
    unconfirmed ? "border-dashed border-edge" : "border-line",
    PADDING[padding],
    href ? "transition-colors hover:border-accent" : "",
    className,
  ].filter(Boolean).join(" ");
  if (href) return <Link href={href} className={classes} data-card {...rest}>{children}</Link>;
  return <Tag className={classes} data-card {...rest}>{children}</Tag>;
}
