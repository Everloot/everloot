# Website bug reporting implementation plan

**Goal:** Give every website page a recognizable bug-report control.
**Architecture:** One client component in the root layout; native dialog and existing support destinations. Reuse consent-banner measurement for clearance.
**Tech stack:** Existing React, Next.js, Tailwind, Vitest; no dependencies.
**Spec:** ../specs/2026-11-10-site-bug-report-design.md

## Constraints

Preserve the current design. No report is submitted automatically. Strip query strings and fragments; omit private routes. Match the existing GitHub form field IDs. Restore focus and scrolling when closing.

## Review focus

Private links; client navigation; small viewports and cookie banner resizing; keyboard dismissal; external links must not gain opener access.

## Task

- [x] Write and run failing behavior tests for the launcher, report context and dialog lifecycle.
- [x] Implement the component, root-layout integration and consent clearance.
- [x] Run focused regression tests, typecheck, lint and build; inspect responsive layout and native dialog behavior.
- [x] Review the final diff and record evidence in shared status.
