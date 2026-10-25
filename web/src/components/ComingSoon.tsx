import Link from "next/link";
import { Tool } from "@/data/tools";
import EmailCapture from "./EmailCapture";

export default function ComingSoon({
  tool,
  previewSections,
}: {
  tool: Tool;
  previewSections: { title: string; body: string; href?: string; hrefLabel?: string }[];
}) {
  return (
    <article className="space-y-10">
      <header className="space-y-3">
        <p className="font-mono text-xs text-muted">
          Coming soon · {tool.shortTitle}
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-fg">
          {tool.title}
        </h1>
        <p className="text-lg text-fg-2 max-w-2xl">{tool.description}</p>
      </header>

      <div className="rounded-2xl border border-line bg-panel p-6 max-w-xl">
        <EmailCapture toolSlug={tool.slug} />
      </div>

      <section className="space-y-6">
        <h2 className="text-2xl text-fg">
          What it will do
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {previewSections.map((s) => (
            <div
              key={s.title}
              className="rounded-xl border border-line p-5 bg-panel"
            >
              <h3 className="text-lg font-semibold text-accent">
                {s.title}
              </h3>
              <p className="mt-1 text-sm text-fg-2">{s.body}</p>
              {s.href && (
                <Link
                  href={s.href}
                  className="mt-3 inline-block text-sm text-fg underline decoration-edge underline-offset-4 hover:decoration-fg"
                >
                  {s.hrefLabel ?? "Open"}
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="pt-4 border-t border-line">
        <p className="text-sm text-fg-2">
          In the meantime, check live prices in the{" "}
          <Link
            href="/tools/auctions"
            className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg"
          >
            Auction House
          </Link>.
        </p>
      </section>
    </article>
  );
}
