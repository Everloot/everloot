import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { REVOKED_KEPT_DAYS, USAGE_KEPT_DAYS } from "@/lib/api-keys";
import { OPERATOR } from "@/lib/jsonld";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, PageHeader, Prose, SectionHeading, ReadingLayout, type TocItem } from "@/components/ui";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Privacy Policy", description: "How Everloot handles your data, cookies and usage statistics, and what happens to the addon files you upload to the WoW: Forever database.", path: "/privacy" }),
};

const SECTIONS: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "controller", label: "Who is responsible" },
  { id: "collect", label: "Information we collect" },
  { id: "analytics", label: "Analytics" },
  { id: "advertising", label: "Advertising and Google AdSense" },
  { id: "choices", label: "Your privacy choices" },
  { id: "rights", label: "Your rights" },
  { id: "retention", label: "How long we keep things" },
  { id: "children", label: "Children" },
  { id: "contact", label: "Contact" },
];

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  const label = SECTIONS.find((s) => s.id === id)!.label;
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id}>{label}</SectionHeading>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  const updated = "24 October 2026";
  return (
    <article>
      <Container width="reading">
        <PageHeader trail={trailFor("/privacy")!} title="Privacy Policy" meta={<span>Last updated: {updated}</span>} />
      </Container>
      <ReadingLayout items={SECTIONS}>
        <Prose>
          <Section id="overview">
            <p>
              Everloot (&ldquo;we&rdquo;, &ldquo;us&rdquo;) provides free utility
              tools for World of Warcraft players. We value your privacy and try to
              collect the minimum information possible.
            </p>
          </Section>

          <Section id="controller">
            <p>
              Everloot is an independent fan project run by {OPERATOR}, which decides
              what the site collects and is responsible for it under privacy law (the
              &ldquo;controller&rdquo;, where that term applies). You
              reach us at{" "}
              <a href="mailto:hello@everloot.app">hello@everloot.app</a>.
              The <Link href="/terms">Terms of Use</Link> cover the
              service itself; this page covers your data.
            </p>
          </Section>

          <Section id="collect">
            <p>
              Most of our tools run entirely in your browser. Data you enter into a
              calculator stays in your browser. A calculator share link encodes those
              values in the URL; anyone you give that link to can read them.
            </p>
            <ul>
              <li>
                <strong>Analytics:</strong> the tools listed under &ldquo;Analytics&rdquo;
                below. Each one is switched on only when we configure it, and the
                ones that use cookies or browser storage wait for your consent.
              </li>
              <li>
                <strong>Our own counters:</strong> our servers keep a daily count of
                calls to our API and to the public MCP endpoint, by endpoint or tool
                name. These counts contain no IP address, install id, search text or
                other detail about who made the call. Rate limiting separately keeps
                a one-way hash of an address for a short time to enforce limits.
              </li>
              <li>
                <strong>Email (optional):</strong> if you sign up to be notified when
                an upcoming tool launches, we store your email to send you that single
                notification.
              </li>
              <li>
                <strong>Battle.net sign-in:</strong> we store your Battle.net Account ID
                and BattleTag to manage your account and sharing choices. The current
                sign-in flow requests identity and World of Warcraft profile permissions,
                but reads only your identity and BattleTag. We don&apos;t keep your
                Battle.net access token, or any other token Battle.net sends, after you
                sign in. Your session is a random token in an essential cookie. It ends
                at most 30 days after your last visit. It is stored with no IP address
                and no browser details, and signing out ends it. Signing in does not
                publish your named addon records or establish guild officer authority.
              </li>
              <li>
                <strong>Email account (optional):</strong> if you make an account with
                your email instead of Battle.net, we store the email, the name you
                choose and a one-way hash of your password, never the password itself.
                We use the email only for account mail: the link that confirms it and
                password-reset links. That mail is sent through Resend, which handles
                the address only to deliver it. Sessions work as described for
                Battle.net above.
              </li>
              <li>
                <strong>API keys (optional):</strong> if you make a free API key on your
                account page, we store a one-way hash of it, the last four characters,
                its name, what you say it is for, its permissions, which account it
                belongs to, when it was made, when it expires, when it was last used and
                revoked, and a daily count of its requests per endpoint. Not what was
                asked. Revoking a key stops it at once, and so does its end date. Daily
                counts are kept {USAGE_KEPT_DAYS} days. A revoked key and its counts are deleted{" "}
                {REVOKED_KEPT_DAYS} days after it was revoked, or at once when you delete it on your
                account page. To delete
                your account and everything tied to it, email us (below).
              </li>
              <li id="saved-builds">
                <strong>Saved builds (optional):</strong> if you save a build in the talent
                calculator while signed in, we store its share codes, the game build, the name
                and notes you type, and the character you file it under. A character is only a
                label you type: a name, a class, and a realm and note if you add them. We don&apos;t
                check it against the game, and nobody else sees it, unless you show your characters
                on a public profile. Each build has a short link,
                on unless you turn it off. Anyone you give it to can see the build&apos;s name,
                notes and talents, but not your character or your name, unless you choose to show
                your name. Turning the link off or deleting the build stops it at once. You can
                delete builds and characters on My builds. Deleting your account deletes them all.
              </li>
              <li id="profiles">
                <strong>Profile (optional):</strong> on Settings you can choose a handle, a display
                name, a status (an emoji and a short line, cleared when you say), a main character
                and the character you are playing now. We store what you choose and nothing else.
                Your profile is private: only you see it. If you turn on your public profile, anyone
                can open it at its address and sees your handle, your display name, and only the
                parts you tick: your characters (name, class and realm), your shared builds and your
                status. It never shows your BattleTag, your email or a build you did not share, and
                search engines index it only while it is public. Turning it off hides it at once.
                Deleting your account deletes your profile with it.
              </li>
              <li>
                <strong>Uploads:</strong> files you send on the upload page
                (addon records plus a random install id — no account, no character
                login). Your anonymous observations are published as individual
                records without the install id, each with a per-install pseudonym (a keyed
                hash that cannot be turned back into the id), so anyone can check our counts. The
                facts the site states, such as drop rates, spawn points and recipe
                ranges, appear only after at least three installs report them.
                Install IDs are not proof of independent people. An upload that contains a scan is stored with a keyed
                one-way hash of the address it came from, never the address, so we can count distinct reporters; the hash
                stays in private storage with the upload and is never published. The private completion rollup records
                which address hash and install produced each entry until it is rebuilt. Guild data publishes only through an authorized officer upload. A
                character owner with a verified sharing grant can opt out on the upload
                page; anyone else can ask us by email (below). Uploads build the public database; we never
                sell them. Player rows are not part of the public records. A Polestar Recorder file you choose
                is converted in your browser into NPC positions, quests, loot, dungeon entrances, boss encounters and treasures; its character names, realms,
                session names and notes are not sent. Its install id is made by our server from a keyed hash of
                the character and one of the address the upload came from, and the upload keeps a keyed hash of
                the address like a scan does. Neither is published.
              </li>
              <li>
                <strong>Census (optional):</strong> on in a new install of the addon,
                which says so once in chat; an install from before the census keeps it
                off until you type <code>/everloot census on</code>.{" "}
                <code>/everloot census off</code> stops it and deletes its rows from your
                file. It leaves your computer only if you allowed it in the Everloot
                Desktop App (a box on its setup screen and a switch in its settings) or
                send your file from the upload page. It records race, class,
                level and faction for your own characters, with the realm name, and for
                players you target, mouse over or group with. It never reads another
                player&apos;s name, guild, gear or position. Before anything is stored,
                the game&apos;s id for each character is replaced with a keyed one-way
                hash, and only the number of the server the character is on is kept
                from it. Census rows are never published one by one. We show counts
                only, and only when a count covers at least 10 characters reported by
                at least 3 installs. The separate players module is different: when you
                turn it on with{" "}
                <code>/everloot players on</code>, it does read names and guilds, and
                what it collects is described next.
              </li>
              <li id="player-pages">
                <strong>Player pages (optional for uploaders, public for characters):</strong> if you
                turn on <code>/everloot players on</code> in the game, the addon records the name,
                realm, race, class, level and guild of your own characters, and of players you
                target, mouse over or group with, and the day it saw them. It never records where a
                player is, what they wear or what they do. You send these rows only from the upload
                page, after a preview, or from the Everloot Desktop App if you turn on{" "}
                <em>Send the player pages with the uploads</em> in its settings. We keep one row per
                character, the newest, and show it on a
                public page you can find by searching for the name. The row says nothing about who
                reported it, and we delete it 90 days after the character was last seen. The players
                it names have not been asked. Anyone can have a character hidden, without an
                account, on the{" "}
                <Link href="/players/opt-out">hide form</Link>; a hidden character is deleted and not
                recorded again. If you play a character and do not want a page, hide it. You can also
                email{" "}
                <a href="mailto:hello@everloot.app">hello@everloot.app</a>.
                {" "}The same module also records your own guild&apos;s boss kills: the guild, the realm, your
                faction, the boss and the time, with no names. If the site has guild pages on, a kill is shown on
                the guild&apos;s page once two players&apos; uploads report it, and a guild page lists the
                characters seen in that guild, labelled as sightings, not the game&apos;s member list. Anyone can
                hide a guild, without an account or an officer rank, on the{" "}
                <Link href="/guilds/hide">guild hide form</Link>; its kills are then not kept. Its characters
                keep their own pages, which the character hide form covers.
              </li>
              <li>
                <strong>Cookies:</strong> an essential login cookie if you sign in (plus a
                short-lived one, 10 minutes, that holds the sign-in state while you are at
                Battle.net), and your cookie choice, which is saved in your browser. Optional analytics
                cookies are off unless you accept them. Advertising cookies come from
                Google AdSense and are covered below.
              </li>
            </ul>
          </Section>

          <Section id="analytics">
            <p>
              We may use the following, and only while they are configured. Anything
              that sets cookies or stores an identifier in your browser loads only
              after you accept analytics in the cookie banner.
            </p>
            <ul>
              <li>
                <strong>Google Search Console and Bing Webmaster Tools</strong> show us
                how our pages appear in search. They place a verification tag in the
                page and collect nothing from your visit.
              </li>
              <li>
                <strong>Cloudflare Web Analytics</strong> counts page views and page
                speed without cookies. It does not run if your browser sends Do Not
                Track or Global Privacy Control.
              </li>
              <li>
                <strong>PostHog</strong> (consent required) records which features are
                used, such as a search or an upload finishing. We send no search text,
                names or file contents, and session recording is off.
              </li>
              <li>
                <strong>Google Analytics</strong> (consent required) measures page views
                and visits using cookies.
              </li>
              <li>
                <strong>Metricool</strong> (consent required) measures visits and the
                pages viewed. Its tracker receives the page URL, referrer and browser
                window size. Metricool states that this tracker uses no cookies.
              </li>
            </ul>
          </Section>

          <Section id="advertising">
            <p>
              Everloot shows ads from Google AdSense, each one labelled
              &ldquo;Advertisement&rdquo;, on the tools, the patch notes, the home page and
              database pages that have content. There are no ads on the upload page, this
              page, account pages or the lore archive. Google and its partners may use
              cookies to serve ads based on your prior visits to this site or other
              sites. In the EEA, the UK and Switzerland, Google&apos;s consent message asks
              you first and ads use only what you allow. In US states with privacy
              laws, the same message lets you opt out of the sale or sharing of your
              information. You can opt out of personalized advertising anywhere by
              visiting{" "}
              <a
                href="https://www.google.com/settings/ads"
                target="_blank"
                rel="noreferrer"
              >
                Google Ads Settings
              </a>
              . For more detail, see{" "}
              <a
                href="https://policies.google.com/technologies/ads"
                target="_blank"
                rel="noreferrer"
              >
                How Google uses advertising cookies
              </a>
              .
            </p>
          </Section>

          <Section id="choices">
            <p>
              You can accept or reject optional cookies in the banner and reopen Cookie
              preferences from the footer on any page. The choice is stored locally.
              The banner covers analytics; rejecting it loads none of the analytics
              scripts. Advertising consent, where the law requires it, is Google&apos;s
              message described above. If an optional script already loaded,
              withdrawing consent reloads the page without it and deletes the
              Google Analytics and PostHog cookies and stored keys it set on this
              site where your browser allows. Cloudflare Web Analytics, which sets
              no cookies, is the one tool that runs without a choice; it is skipped
              when your browser sends Do Not Track or Global Privacy Control. You can
              also clear local storage through your browser settings.
            </p>
          </Section>

          <Section id="rights">
            <p>
              Wherever you live, you can ask us what we hold about you, have it
              corrected or deleted, object to or restrict how we use it, and withdraw
              a consent you gave. Email{" "}
              <a href="mailto:hello@everloot.app">hello@everloot.app</a>{" "}
              and say which of these you want. Where we need to be sure the request
              is yours, we may ask you to send it from the address tied to your
              request or to prove the sharing grant or install id involved. We answer
              within a month. If you are in the EEA or the UK you can also complain
              to your data protection authority.
            </p>
            <ul>
              <li>
                <strong>Sharing grants</strong> for named records can be withdrawn
                on the upload page at any time, without emailing us.
              </li>
              <li>
                <strong>API keys</strong> are revoked and deleted on the Connect page.
              </li>
              <li>
                <strong>Saved builds and characters</strong> are deleted, and short links turned
                off, on My builds.
              </li>
              <li>
                <strong>Your profile</strong> is changed, cleared or made private again on Settings.
              </li>
              <li>
                <strong>Uploads</strong> you ask us to remove are deleted, and the
                next rollup rebuild removes anything derived from them.
              </li>
            </ul>
          </Section>

          <Section id="retention">
            <ul>
              <li><strong>Login cookie:</strong> at most 30 days after your last visit, or until you sign out.</li>
              <li><strong>Cookie choice:</strong> in your browser until you clear it or change it.</li>
              <li><strong>Battle.net Account ID and BattleTag:</strong> until you ask us to delete your account.</li>
              <li><strong>Account email, name and password hash:</strong> until you ask us to delete your account. Unused confirmation and reset links expire after one hour.</li>
              <li><strong>API key usage counts:</strong> {USAGE_KEPT_DAYS} days. A revoked key and its counts: {REVOKED_KEPT_DAYS} days after revocation, or at once when you delete it.</li>
              <li><strong>Saved builds and characters:</strong> until you delete them or your account.</li>
              <li><strong>Handle, display name, status and profile choices:</strong> until you change them or delete your account. A status with a clear-after time stops showing at that time.</li>
              <li><strong>Rate-limit hashes:</strong> a short time, long enough to enforce the limit, then discarded.</li>
              <li><strong>Uploads:</strong> until you ask us to remove them. They are the public database.</li>
              <li><strong>Census rows:</strong> as long as the upload they came in, and removed with it. They hold the character&apos;s hash, never its id, and a one-way hash of the address they came from, never the address. They are only ever published as counts.</li>
              <li><strong>Upload address hash:</strong> as long as the upload it belongs to. The completion rollup keeps its link between an address hash and an install until the rollup is next rebuilt.</li>
              <li><strong>Player rows:</strong> 90 days after the character was last seen. A hidden character is deleted at once and is not recorded again.</li>
              <li><strong>Launch-notification email:</strong> until you ask us to remove it.</li>
            </ul>
          </Section>

          <Section id="children">
            <p>
              Everloot is not directed at children under 13 and we do not knowingly
              collect personal information from them. If you believe a child has
              given us some, email us and we will delete it.
            </p>
          </Section>

          <Section id="contact">
            <p>
              Questions? Email{" "}
              <a href="mailto:hello@everloot.app">
                hello@everloot.app
              </a>
              .
            </p>
          </Section>
        </Prose>
      </ReadingLayout>
    </article>
  );
}
