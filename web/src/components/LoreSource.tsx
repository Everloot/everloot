/** The Warcraft Wiki, where the lore archive's pages come from. */
export const WIKI_URL = "https://warcraft.wiki.gg/";
const LICENCE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

/**
 * The one credit line a lore page keeps, because CC BY-SA asks for the source, a link to it and the
 * licence on the page itself (density spec, 2026-10-20). Everything else about sources lives on
 * /methodology#credits. `href` is the page's own source when there is one. For the wiki the line
 * names its contributors, the authors the licence asks to be credited.
 */
export default function LoreSource({ href = WIKI_URL, name = "Warcraft Wiki", wiki = true, licence = "CC BY-SA 4.0", className = "mt-8" }: { href?: string; name?: string; wiki?: boolean; licence?: string; className?: string }) {
  return (
    <p data-lore-source className={`${className} text-xs text-muted`}>
      Source: <a href={href} rel="noopener" className="hover:text-accent">{name}</a>{wiki ? " contributors" : ""},{" "}
      {licence === "CC BY-SA 4.0" ? <a href={LICENCE_URL} rel="license noopener" className="hover:text-accent">{licence}</a> : licence}
    </p>
  );
}
