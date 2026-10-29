import { deployedCommit } from "./platform";

/** Everloot's public repository. The AGPL asks the site to offer the source it runs. */
export const REPO_URL = "https://github.com/Everloot/everloot";

const SHA = /^[0-9a-f]{7,40}$/i;

/** The deployed commit when the Worker names a well-formed one, otherwise nothing. */
export function deployedSha(sha = deployedCommit(process.env)): string | undefined {
  return sha && SHA.test(sha) ? sha : undefined;
}

/** The deployed commit's tree when the host names one, otherwise the repository. */
export function sourceUrl(sha = deployedCommit(process.env)): string {
  const known = deployedSha(sha);
  return known ? `${REPO_URL}/tree/${known}` : REPO_URL;
}
