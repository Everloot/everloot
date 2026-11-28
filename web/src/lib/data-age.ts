import { utcStamp } from "./time";
/** One line a page can show beside figures: how old the uploads behind them are. */
export function dataAgeLabel(dataAsOf: string | null | undefined): string {
  const stamp = utcStamp(dataAsOf);
  return stamp ? `Data as of ${stamp}` : "Data age unrecorded";
}
