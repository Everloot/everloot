import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { Container, PageHeader, SectionHeading } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Contact", description: "Contact the Everloot team by email at hello@everloot.app for corrections, privacy requests, bug reports and partnership questions about the WoW: Forever tools.", path: "/contact" }),
};

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

export default function ContactPage() {
  return (
    <Container width="reading">
      <PageHeader
        title="Contact Everloot"
        lede="Everloot is an independent fan project run by a small team; the fastest way to reach us is email."
        trail={trailFor("/contact")!}
        actions={<a className="btn btn-primary" href="mailto:hello@everloot.app">hello@everloot.app</a>}
      />

      <div className="space-y-12">
        <section aria-labelledby="what">
          <SectionHeading id="what">What to email about</SectionHeading>
          <ul className="list-disc space-y-1 pl-6 text-fg-2">
            <li>Data corrections or wrong drop rates</li>
            <li>
              Privacy and data requests (see also our{" "}
              <Link href="/privacy" className={link}>Privacy Policy</Link>
              )
            </li>
            <li>
              Copyright or takedown requests (how to, in the{" "}
              <Link href="/terms#takedown" className={link}>Terms of Use</Link>
              )
            </li>
            <li>Bug reports</li>
            <li>Partnership questions</li>
          </ul>
        </section>

        <section aria-labelledby="support">
          <SectionHeading id="support">Game or account support</SectionHeading>
          <p className="text-fg-2">
            For Battle.net login, billing, bans or in-game problems, contact{" "}
            <a href="https://support.blizzard.com/" rel="noopener" className={link}>Blizzard Support</a>.
          </p>
        </section>
      </div>
    </Container>
  );
}
