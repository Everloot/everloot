import { CARD_SIZE, renderCard } from '@/lib/og-card';
export const alt = 'WoW Forever timers and event calendar on Everloot';
export const size = CARD_SIZE;
export const contentType = 'image/png';
export default function Image() {
  return renderCard({ label: 'Everloot', title: 'Timers and event calendar', subtitle: 'Client holiday dates and regional reset references · Forever timings unconfirmed' });
}
