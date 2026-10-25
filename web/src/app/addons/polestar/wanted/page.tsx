import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { PACK_IDEAS, POLESTAR, POLESTAR_HELP } from "@/data/polestar";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, Entry, EntryList, PageHeader, SectionHeading } from "@/components/ui";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Polestar Pack Ideas for WoW Forever", description: "Guide packs nobody has built yet for Polestar, the WoW: Forever leveling addon: why each one is still open, and how Polestar itself needs help.", path: "/addons/polestar/wanted" }),
};

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

export default function WantedPage() {
  return (
    <Container width="reading">
      <article>
        <PageHeader
          trail={trailFor("/addons/polestar/wanted")!}
          title="Routes and guides worth building"
          lede="Guide packs nobody has listed yet, each with the reason it is open."
        />
        <p className="text-fg-2">
          To start one, follow Polestar&apos;s <a className={link} href={POLESTAR.handbook}>pack handbook</a>: from a clone of
          Polestar (Node 24 and Lua 5.1), <span className="font-mono">polestar new &lt;folder&gt;</span> sets up a pack that
          already lints, plays and builds.
        </p>

        <div className="mt-12 space-y-12">
          <section aria-labelledby="ideas">
            <SectionHeading id="ideas">Pack ideas</SectionHeading>
            <EntryList label="Pack ideas">
              {PACK_IDEAS.map((idea) => (
                <Entry key={idea.title} as="h3" title={idea.title} meta={<>Source: <a className={link} href={idea.source.url}>{idea.source.label}</a></>}>
                  <p>{idea.why}</p>
                  {idea.start.length > 0 && (
                    <p>
                      On Everloot:{" "}
                      {idea.start.map((item, i) => (
                        <span key={item.href}>{i > 0 && " · "}<Link className={link} href={item.href}>{item.label}</Link></span>
                      ))}
                    </p>
                  )}
                </Entry>
              ))}
            </EntryList>
          </section>

          <section aria-labelledby="help">
            <SectionHeading id="help">Help Polestar itself</SectionHeading>
            <EntryList label="Where Polestar needs help">
              {POLESTAR_HELP.map((item) => (
                <Entry key={item.title} as="h3" title={<a className={link} href={item.url}>{item.title}</a>}>
                  <p>{item.why}</p>
                </Entry>
              ))}
            </EntryList>
          </section>
        </div>

        <p className="mt-12 border-t border-line pt-4 text-sm text-muted">
          Built a pack? <Link className={link} href="/addons/polestar/packs">List it</Link>. Ideas checked against
          Polestar&apos;s repository on {POLESTAR.checked}.
        </p>
      </article>
    </Container>
  );
}
