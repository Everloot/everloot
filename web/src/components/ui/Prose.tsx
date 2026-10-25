import type { ReactNode } from "react";

/**
 * Running text at reading measure: legal pages, the lore article, an addon's description. Paragraphs,
 * lists, bold and code get one style here, so a document page writes plain elements and carries no
 * classes of its own. Section headings inside are SectionHeading; anchors clear the sticky header.
 */
export default function Prose({ children }: { children: ReactNode }) {
  return (
    <div
      data-prose
      className="max-w-[70ch] leading-relaxed [&>*+*]:mt-4 text-fg-2 [&_[id]]:scroll-mt-24 [&_a]:text-fg [&_a]:underline [&_a]:decoration-edge [&_a]:underline-offset-4 [&_a]:hover:decoration-fg [&_code]:font-mono [&_code]:text-fg [&_li]:mt-2 [&_li]:pl-1 [&_section]:mt-12 [&_section]:space-y-4 [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6"
    >
      {children}
    </div>
  );
}
