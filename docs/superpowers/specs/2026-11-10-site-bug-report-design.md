# Website bug reporting

Carlos asked for a visible bug item on the Everloot website and authorized implementation without further design questions.

Use a small fixed bug button, with a text label on wider screens, matching the existing green accent and panel tokens. Keep it above the cookie banner and phone safe area. A native modal dialog offers the existing GitHub bug form and Discord, with email as an alternative. GitHub remains the place to describe and submit the issue; opening the dialog does not send anything.

Attach only the public page path (no query or fragment). Omit private page URLs. Show the attached context before the player follows the report link. No automatic logs, account details, screenshots, tracking or backend intake.

Approaches: a bare external link is smaller but does not explain the GitHub account requirement or alternatives. A new intake service adds storage and moderation without an existing owner. Reusing the existing bug form with a small on-site dialog fits the request and current support workflow.

Verify: all-page integration, generated issue-form URL, private-page redaction, keyboard focus/Escape, phone layout, consent clearance, existing component checks and production build.
