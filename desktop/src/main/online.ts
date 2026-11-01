/**
 * Calls `back` each time `isOnline` turns from false to true, checked every `everyMs`; returns the function that stops
 * it. Electron's `net.isOnline()` has no event, and the window that would get the page's `online` event may be closed.
 * Permanently offline or permanently online, it calls nothing.
 */
export function onReconnect(isOnline: () => boolean, back: () => void, everyMs = 30_000): () => void {
  let was = isOnline();
  const timer = setInterval(() => {
    const is = isOnline();
    if (is && !was) back();
    was = is;
  }, everyMs);
  return () => clearInterval(timer);
}
