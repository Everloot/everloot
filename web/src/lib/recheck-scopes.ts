import recheckFile from "../../../kb/curated/recheck.json";
import { RecheckFile, type RecheckScope } from "@kb/coverage";

/**
 * The recheck scopes in kb/curated/recheck.json, bundled like the other curated files; a malformed file scopes nothing.
 * The coverage score and the public readers take the same list, so a fact the score puts in recheck is one the pages
 * count only new reports for.
 */
export const RECHECK_SCOPES: readonly RecheckScope[] = (() => {
  const parsed = RecheckFile.safeParse(recheckFile);
  return parsed.success ? parsed.data.scopes : [];
})();
