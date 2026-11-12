# Private Operations Dashboard Implementation Plan

> For agentic workers: implement these independently owned tasks with test-driven development and review before integration.

**Goal:** Deliver and release the approved private operations dashboard, contributor explorer and compact realm presentation.
**Architecture:** The existing Worker collects bounded private aggregates into R2; authenticated humans and read-only agents consume the same snapshot. Installations remain pseudonymous unless contributors explicitly attribute a request to their own linked character.
**Tech stack:** Existing Next.js, TypeScript, Supabase, R2 and Cloudflare infrastructure.
**Spec:** Internal approved operations-dashboard design, including contributor explorer and realm display additions. No private identifiers belong in this repository.

## Constraints and review focus

- Deny unauthorized access before any private source read; use no-store responses.
- Preserve anonymous uploads, publication/suppression rules and successful receipt semantics.
- Capture time is not receipt time; installs are not people. Missing sources are not zero.
- Exclude known owner/test installs using private configuration; never commit their identifiers.
- No new paid provider; bounded collector, shared snapshot, no corpus replay on page views.
- Named associations need explicit opt-in, authenticated ownership and current visibility checks.

## Tasks

1. [ ] Backend metrics and collection: types, pure calculations, private R2 snapshot, bounded source reads, cron route, intake outcome/activity instrumentation and migration if needed. Write behavior tests first, prove failure, implement, run focused checks.
2. [ ] Access and API: fail-closed human authorization, separate read-only machine credentials, protected summary endpoint; tests for absent/forged/wrong-purpose credentials and no private reads before authorization.
3. [ ] UI and contributor attribution: responsive /ops, activity/health/cost/explorer, compact realm labels and accessible full-name details, request filters and explicit unavailable states. Add opt-in character association using existing verified owner links; protect current privacy on reads. Test before implementation.
4. [ ] Integrate and validate: targeted and full relevant suites, types, lint, production build, independent code review and fixes. Update operational documentation with exact required deployment configuration and recovery.
5. [ ] Release: commit/push, PR, link to task, resolve checks/reviews, merge, observe deployment, configure only the approved private dashboard prerequisites, verify unauthorized denial and authorized real metrics, then save the shared handoff.

Public code/docs use generic configuration names and synthetic fixtures only. Actual credentials, owner exclusions, account identity and service configuration remain private.
