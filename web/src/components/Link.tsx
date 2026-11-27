import NextLink from "next/link";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof NextLink>;

const DATABASE = /^\/database(?:[/?#]|$)/;

/**
 * Whether a link may prefetch. /database/* sits behind an edge rate limit (10 requests per 10 s per IP) and a bot
 * challenge, so a page full of database links prefetching on view or hover gets the visitor rate limited before they
 * click anything. Those links load only when clicked; every other link keeps what its caller asked for.
 */
export function prefetchFor(href: Props["href"], requested: Props["prefetch"]): Props["prefetch"] {
  const path = typeof href === "string" ? href : href.pathname ?? "";
  return DATABASE.test(path) ? false : requested;
}

/** next/link, except a link into /database never prefetches. Every link on the site goes through this one. */
export default function Link({ href, prefetch, ...rest }: Props) {
  return <NextLink href={href} prefetch={prefetchFor(href, prefetch)} {...rest} />;
}
