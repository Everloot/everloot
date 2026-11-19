import type { ObjectFacts } from "@kb/object-page";
import { computeRollups, loadInstanceFacts, loadItemFacts } from "./rollup-compute";

/** Object facts from the shared aggregates: the drop rollup, the agreed names, minimap sightings and pending windows, no second scan. */
export async function loadObjectFacts(): Promise<ObjectFacts & { unreachable: boolean; dataAsOf: string | null }> {
  const [rollup, items, seen] = await Promise.all([computeRollups(), loadItemFacts(), loadInstanceFacts()]);
  const unreachable = rollup.stats.unreachable || items.unreachable;
  return {
    rates: unreachable ? [] : rollup.rates,
    measuredZeros: unreachable ? [] : rollup.measuredZeros,
    names: unreachable ? [] : items.names,
    objects: unreachable ? [] : items.objects,
    sightings: unreachable ? [] : seen.sightings,
    pending: unreachable ? undefined : items.pending,
    unreachable,
    dataAsOf: rollup.stats.dataAsOf,
  };
}
