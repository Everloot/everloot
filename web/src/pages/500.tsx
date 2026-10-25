import Link from "next/link";

// The page for any server failure, in practice a lore page whose release could not be opened.
// Failed renders are not cached, so visitors see this until the release opens again.
export default function ServerError() {
  return (
    <article className="space-y-4 max-w-4xl">
      <p className="font-mono text-xs text-muted">Lore archive</p>
      <h1 className="text-3xl font-bold text-fg">Lore archive unavailable</h1>
      <p className="text-fg-2">The lore archive couldn&apos;t load right now. Try again in a few minutes.</p>
      <p className="text-sm">
        <a href="" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Try again</a>
        {" · "}
        <Link href="/lore" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Lore archive</Link>
      </p>
    </article>
  );
}
