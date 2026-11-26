import { screenshotsOn } from "@/lib/screenshots";
import type { ScreenshotEntityType } from "@/lib/screenshots-shared";
import ScreenshotsSection from "./ScreenshotsSection";

/**
 * Player screenshots on an entity page, above its comments, by (type, id); `name` is the name the page shows, for the
 * pictures' alt text. Nothing at all unless EVERLOOT_SCREENSHOTS=1 (with profiles on). The page's HTML holds only the
 * empty section; approved pictures and the viewer load in the browser.
 */
export default function EntityScreenshots({ type, id, name }: { type: ScreenshotEntityType; id: number; name: string }) {
  return screenshotsOn() ? <ScreenshotsSection type={type} id={id} name={name} /> : null;
}
