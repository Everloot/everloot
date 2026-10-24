/** One visible image, one loading replacement, and at most one image finishing its fade. */
export function artHandoff<T>(load: (key: string) => { layer: T; ready: Promise<void> }, show: (layer: T, previous: T | null) => void, remove: (layer: T) => void, duration: number) {
  type Entry = { key: string; layer: T };
  let current: Entry | null = null, pending: Entry | null = null, retiring: Entry | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failed: string | null = null;
  const finish = () => {
    clearTimeout(timer);
    if (retiring) remove(retiring.layer);
    retiring = null;
  };
  return {
    set(key: string | null) {
      if (key !== null && key === failed) return;
      failed = null;
      if (key !== null && (pending?.key === key || (!pending && current?.key === key))) return;
      if (pending) remove(pending.layer);
      pending = null;
      finish();
      if (key === null) {
        if (current) remove(current.layer);
        current = null;
        return;
      }
      if (current?.key === key) return;
      const { layer, ready } = load(key);
      const next = { key, layer };
      pending = next;
      ready.then(() => {
        if (pending !== next) return;
        pending = null;
        retiring = current;
        current = next;
        show(layer, retiring?.layer ?? null);
        timer = setTimeout(finish, duration);
      }, () => {
        if (pending !== next) return;
        pending = null;
        failed = key;
        remove(layer);
      });
    },
  };
}
