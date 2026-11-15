import { Container, PageHeader, SectionHeading } from '@/components/ui';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbJsonLd, serializeJsonLd, webApplicationJsonLd } from '@/lib/jsonld';
import { RESET_SOURCES } from '@/lib/timers/schedules';
import calendar from '@/data/game-data/client-calendar.json';
import Timers from './Timers';
const description = 'Browse client holiday dates, regional reset reference countdowns and a calendar download for WoW: Forever, with unconfirmed timings clearly labelled.';
export const metadata = pageMetadata({ title: 'WoW Forever timers and event calendar', description, path: '/tools/timers', image: '/tools/timers/opengraph-image' });
const trail = [{ name: 'Home', path: '/' }, { name: 'Tools', path: '/tools' }, { name: 'Timers and event calendar', path: '/tools/timers' }];
export default function TimersPage() {
  return <Container width="data">
    <PageHeader title="Timers and event calendar" lede="Regional reset references and the holiday dates found in Forever’s game files." trail={trail} />
    <Timers />
    <section aria-labelledby="sources" className="mt-10 space-y-3">
      <SectionHeading id="sources">Sources and limits</SectionHeading>
      <p className="text-sm text-muted">Source: Blizzard game files, build {calendar.build.version} ({calendar.build.product}), extracted {calendar.build.extractedAt.slice(0, 10)}. Holidays, HolidayNames and HolidayDescriptions supply the catalog. These client dates do not confirm that an event is enabled on live realms.</p>
      <p className="text-sm text-muted">Source: Blizzard reset announcements below. They describe Legion and modern WoW, not a confirmed Forever schedule. The EU announcement establishes a weekly reference only; no daily reference is assumed. KR and TW remain available as regions, with no guessed reset clocks.</p>
      <ul className="space-y-2 text-sm">{RESET_SOURCES.map(source => <li key={source.url}><a href={source.url} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{source.label}</a></li>)}</ul>
      <p className="text-sm text-muted">{calendar.credit}</p>
    </section>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd(trail)) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(webApplicationJsonLd({ name: 'Timers and event calendar', path: '/tools/timers', description })) }} />
  </Container>;
}
