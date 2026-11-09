import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { CONTACT_EMAIL } from "@/lib/jsonld";
import { REPO_URL } from "@/lib/source";
import { longDate } from "@/data/wow-forever";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, PageHeader, Prose, SectionHeading } from "@/components/ui";

const description = "What Everloot aims for in accessibility, what is in place, what has been checked and what has not yet, and how to tell us when something is in the way.";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Accessibility", description, path: "/accessibility" }),
};

const UPDATED = "2026-10-18";
/** The date of the last automated audit named below; update it with the page list when the audit is re-run. */
const AUDITED = "2026-10-18";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}

export default function AccessibilityPage() {
  return (
    <Container width="reading">
      <article>
        <PageHeader trail={trailFor("/accessibility")!} title="Accessibility" meta={<span>Last updated: {longDate(UPDATED)}</span>} />
        <Prose>
          <p>
            Everloot should work with a keyboard, a screen reader, a phone, zoomed text or a high-contrast mode. This page
            says what we aim for, what is in place, what we have checked, what we have not checked yet, and how to tell us
            when something is in the way.
          </p>

          <Section id="aim" title="What we aim for">
            <p>
              The target for everloot.app is the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. We do not
              claim full conformance; the sections below say exactly what has been checked and what has not.
            </p>
          </Section>

          <Section id="in-place" title="What is in place">
            <ul>
              <li>Every page has one main landmark, a heading outline that starts at a single top heading, and real links and buttons.</li>
              <li>A &ldquo;Skip to content&rdquo; link is the first thing the Tab key reaches on every page.</li>
              <li>Keyboard focus is always visible: every control shows a 2 px ring with a 2 px offset.</li>
              <li>Links in running text are underlined, so colour is not their only cue.</li>
              <li>
                Motion is small and short: 150 ms colour and opacity fades, a button sinking a little under a press, the
                loading bar at the top of the page, a sheet sliding up on phones, and Glint, the raven on the home page and in
                the footer, who breathes, blinks, cocks his head and flaps his wings when you hover or tap him, while the lines in his
                speech bubble fade from one to the next. All of it stops when your system asks for reduced motion.
              </li>
              <li>In forced-colours (high-contrast) mode, buttons keep a real border so they stay visible.</li>
              <li>Footer links and form controls are at least 44 px tall, and nothing on the page stops you from zooming.</li>
              <li>The page language is declared as English, so screen readers pick the right voice.</li>
            </ul>
          </Section>

          <Section id="checked" title="What we have checked">
            <p>
              On {longDate(AUDITED)} we ran an automated axe-core audit (the WCAG 2.0, 2.1 and 2.2 A and AA rules plus best
              practices) at phone and desktop widths on the home page, the database index, the upload page, search, the
              patch notes, How we count, Connect, About, Contact, the privacy policy, the terms and the security page. It
              reported no violations after one fix, the underlined links above. Automated checks find only part of the
              problems, so this is a floor, not a result.
            </p>
            <p>
              Automated tests in the{" "}
              <a href={REPO_URL} rel="noopener">repository</a> check the roles and names of the header,
              the footer, the cookie banner, the account controls, the ad slots and the calculators, so a change that breaks
              them fails before it ships.
            </p>
          </Section>

          <Section id="not-checked" title="What we have not checked yet">
            <ul>
              <li>A full walk through the site with a screen reader such as NVDA or VoiceOver.</li>
              <li>
                The interactive tools: the <Link href="/map">world map</Link>, the{" "}
                <Link href="/tools/talents">talent calculator</Link> and the gold calculators have not been
                through the audit for keyboard and screen-reader use.
              </li>
              <li>The item, creature and quest pages and the lore archive, which are generated from game data and wiki text, for heading structure and image descriptions.</li>
              <li>
                The ads and the consent message are Google&apos;s; their accessibility is Google&apos;s and we cannot change
                it. There are no ads on this page, the upload page, the privacy policy, account pages or the lore archive.
              </li>
            </ul>
          </Section>

          <Section id="report" title="Tell us what is in the way">
            <p>
              If a page or a tool does not work for you, email{" "}
              <a href={`mailto:${CONTACT_EMAIL}?subject=Accessibility`}>{CONTACT_EMAIL}</a> with
              &ldquo;Accessibility&rdquo; in the subject, or open an issue on{" "}
              <a href={`${REPO_URL}/issues/new/choose`} rel="noopener">GitHub</a>. Say which page, what you
              were using (browser, screen reader, zoom level) and what went wrong. We answer by email and fix what we can;
              the <Link href="/contact">contact page</Link> lists the other ways to reach us.
            </p>
          </Section>
        </Prose>
      </article>
    </Container>
  );
}
