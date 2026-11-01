# scripts/

Repository-level tools. Site-specific maintainer scripts are in `web/scripts/`.

| Script | What it does |
|---|---|
| `package-addon.py` | Builds `web/public/downloads/Everloot-<version>.zip` from `addon/`. CI checks the committed zip matches. |
| `check_internal_paths.py` | CI guard: fails when a file names a maintainer's private workspace, secrets folder or personal paths. Its tests are `test_check_internal_paths.py`. |
| `check_dco.py` | CI guard on pull requests: fails when a commit has no `Signed-off-by:` line and prints the fix. Its tests are `test_check_dco.py`. |
| `discord_bridge.py` | Run by the Discord bridge workflow: turns `#bug-reports` posts into GitHub issues and posts status changes back, keeps `#known-issues` current, and posts releases, discussions, commits and pull requests to their channels. Its tests are `test_discord_bridge.py`. |
| `check_changes_files.py` | Used by `.github/workflows/changes.yml`: exits 0 only if the data pull request touches nothing but `kb/changes/blue-posts.json` and `kb/changes/builds.json`. Its tests are `test_check_changes_files.py`. |
| `check_no_ai_credit.py` | CI guard on pull requests: fails when a commit or the PR description credits an AI tool (co-author lines, vendor addresses, "generated with" footers). Its tests are `test_check_no_ai_credit.py`. |
| `check_pr_title.py` | CI guard on pull requests: fails unless the title reads `type(scope): plain sentence` (see CONTRIBUTING.md). Its tests are `test_check_pr_title.py`. |
| `check_md_links.py` | CI guard: fails when a relative link or image in a tracked Markdown file points at a missing file. |
| `generate-snapshot.ps1` | Builds a public knowledge release from a source database (wraps `npm run kb -- snapshot`). |
| `issue-publication-grant.ts` | Maintainer-only: issues a scoped publication grant after an officer's authority was verified out of band. |
| `cleanup-test-data.ps1` | Maintainer-only: runs the launch maintenance preflight or cleanup against production configuration. |
| `news-hero/` | Renders the Everloot cards (type and data, no Blizzard material) used as news post heroes. See its README. |

Run the Python ones from the repository root.
