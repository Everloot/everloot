# Desktop and platform readiness handoff

Date: 2026-10-28. This closes the current source-hardening pass. Merge and CI receipts belong on the
pull request; source tests do not establish native installation, live-game or deployed-runtime acceptance.

## Next terminal goal

Prepare the next Desktop release for isolated Windows acceptance (REL-09), with a concrete publisher-trust
decision and a recorded install/upgrade/uninstall recovery matrix. Do not start another general platform
audit or claim that the full player hub is implemented.

1. Read the current shared project status and migration handoff, then this document and the
   [gap register](2026-10-28-platform-gap-register.md). Check current main and the active terminal's files.
2. Inspect the existing release/signing workflow and artifact verification. Document what the current
   GitHub release plus SHA256SUMS proves, and propose publisher authentication/key rotation options.
   Do not buy a certificate/service, create signing keys or change release secrets without an accepted decision.
3. Prepare a test package and an isolated data directory. Record the exact commit and artifact hash;
   preserve real settings, uploads, backups and the game directory. No version/tag/public release is implied.
4. With the operator, record clean install, upgrade over the current release, settings/data retention,
   tray/reopen, uninstall/reinstall, bad checksum, unavailable/quarantined installer and failed launch.
   Separate simulated failures from native observations. A spawned process is not proof of a completed install.
5. Resolve actual failures, run relevant tests, and leave a release recommendation with rollback steps.
   Keep any unsupported or unexecuted case explicit.

## Source changes delivered by this pass

- Addon swap rollback and preservation of recovery copies across retries.
- Bounded upload requests and useful refusal messages; accepted-only durable progress, contradictory receipt
  protection, and continuation past exact all-row rejections in Desktop/CLI and the browser.
- Shared rename/error-recovering watcher for Desktop and CLI; generated slot interface parity tests.
- Per-origin Retry-After deadlines, protection across settings restarts, manual/wake retry recovery and
  a fresh retry budget for a queued manual run.
- Player opt-out invalidation across URL aliases; actual deployed cache invalidation still needs acceptance.
- Updater URL/name/version checks, bounded streamed downloads, complete writes before checksum acceptance,
  verified replacement, failed-launch redownload and successful-spawn confirmation before quitting.
- Clearer asking-price, per-unit and realm/house wording on shared price answers and selected UI surfaces.

Each functional slice has targeted regression evidence in this session's status and commits. Reviews were
independent; small findings were corrected and verified by the coordinator. The final updater review found
a short-write blocker, which was reproduced and corrected; do not describe that review as an unconditional
pass on the corrected revision. CI on the final merged base remains the integration gate.

## Still open after merging

- **REL-06:** network returning without a system wake, fresh retry budget on pause/resume, and native wake
  behavior. Rate-limit deadlines survive settings restarts in memory, not process exit.
- **REL-09:** independent publisher trust/signing and real native package acceptance described above.
- **ECON-E01:** [audit](2026-10-28-economy-terminology-audit.md) F1/F2/F3/F5 remain in KB/protocol descriptions.
  Coordinate ownership with the Cloudflare/knowledge lane; keep generated protocol output and changelog consistent.
- **Live client:** execute the [capability kit](2026-10-28-live-client-capability-checklist.md) when servers
  return. Completion/reputation APIs, recipes, bags/bank, auction throttle, slot loading, save ordering,
  encounter events, PvP and combat-log format remain unverified by this pass.
- **Private identity and team operations:** the
  [identity ADR](design/specs/2026-10-28-owned-character-identity.md) and
  [maintainer proposal](design/specs/2026-10-28-maintainer-access-and-support.md) are proposed designs.
  The owner accepted freezing both competing links and linked dashboards pending review. Consent/source
  schema, contested sources, dispute evidence/contact, staff permissions/sign-in strength and retention
  remain decisions. No staff access or private-sync flags were enabled.
- **Player platform:** character linking flow, authenticated private completion, eligibility-aware totals,
  per-character history, profiles/alts, staff case views and dedicated PvE/PvP/combat dashboards are not built
  by these planning documents. Continue in the [implementation plan](superpowers/plans/2026-10-28-platform-readiness.md)
  only after the corresponding decisions and evidence are ready.

## Coordination and delivery boundaries

Cloudflare is a separate active lane. Its current main integration includes the Worker/D1 read path;
resource import, deployed route parity, cache purge, single-writer schedulers, DNS and cutover remain owned
there. Follow the latest owner decision and migration runbook rather than the superseded after-launch date.
Do not duplicate deployment, rotate credentials or change flags during Desktop acceptance.

No game files, raw combat logs, private player evidence or credentials belong in public fixtures or this handoff.
No installer/addon version or release tag was changed in this pass. The source bundle is not a signed installer.
