import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";

/** Words and no figures: "Not read", "unrecorded", "Officers, no date". "2 of 3", "5g 64s" and "1.2k" stay mono. */
const isWords = (text: string) => /\p{L}{2}/u.test(text) && !/\p{N}/u.test(text);

/**
 * A numeric cell's content with its words set in the sans face: mono is for numbers, ids, builds and dates. A piece
 * of text with figures in it stays as it is, and the cell keeps its tabular figures. Walks strings, fragments and
 * plain elements; a component (Coins, a link) and screen-reader-only text are left alone.
 */
export function sansWords(node: ReactNode): ReactNode {
  if (typeof node === "string") return isWords(node) ? <span className="font-sans">{node}</span> : node;
  if (Array.isArray(node)) {
    const next = node.map(sansWords);
    return next.every((child, i) => child === node[i]) ? node : next.map((child, i) => <Fragment key={i}>{child}</Fragment>);
  }
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode; className?: string }>;
  if (element.type !== Fragment && typeof element.type !== "string") return node;
  const { children, className } = element.props;
  if (children === undefined || className?.split(" ").includes("sr-only")) return node;
  const next = sansWords(children);
  return next === children ? node : cloneElement(element, undefined, next);
}
