## What changed

## How you tested it

- [ ] The title reads `type(scope): plain sentence`, for example `fix(addon): auction rows keep the per-unit price` (types and scopes are in CONTRIBUTING.md)
- [ ] Commits are signed off (`git commit -s`, see CONTRIBUTING.md)
- [ ] No scraped, datamined or spoiler data ([data policy](https://github.com/Everloot/everloot/blob/main/docs/DATA_POLICY.md)); any new source is in docs/sources/LEDGER.md
- [ ] For an addon change: the zip is rebuilt with `python scripts/package-addon.py`
- [ ] `CHANGELOG.md` has one line under `[Unreleased]` with a prefix such as `Site:` or `Addon:` (or the change has no user-visible effect)
- [ ] The area label is set (the release notes are grouped by it)
- [ ] Docs are updated if behaviour changed
