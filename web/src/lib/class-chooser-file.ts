import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHOOSER_FILES, parseClassChooser, type ClassChooserData } from "../../../kb/src/guides/class-chooser";
import { chooserReviewed } from "./class-chooser";
import { guidesDir } from "./guides";

/**
 * The class chooser's two files as the site reads them, apart from lib/class-chooser.ts, which the chooser in the
 * browser loads too. Null when one is missing or breaks a rule, as the guide check refuses it.
 */
export function loadChooser(): ClassChooserData | null {
  try {
    const read = (name: string) => readFileSync(join(guidesDir(), name), "utf8");
    return parseClassChooser(read(CHOOSER_FILES.roles), read(CHOOSER_FILES.chooser));
  } catch {
    return null;
  }
}

/** /classes/choose asks to be indexed, and the sitemap lists it, once both files are reviewed. */
export const chooserIndexable = (data: ClassChooserData | null): boolean => data !== null && chooserReviewed(data);
