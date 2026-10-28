# Reviewed speech-to-text drafts in Chat

Status: approved by Carlos for implementation, 2026-10-25. Carlos selected speech-to-text with review before sending; full spoken conversation is excluded.

## Approach and experience

Proposed first version: browser speech recognition where supported. It adds no speech-provider key or paid transcription integration. A microphone control starts only after a deliberate click, shows Listening with a Stop action, and appends the completed transcript to the existing draft. It never sends a message automatically. The player can edit or discard the text before pressing Send.

Alternative: a hosted transcription endpoint would offer more consistent browser support but require a new audio integration, retention rules and cost controls. That is outside this version. An always-listening conversational mode is also excluded.

## Privacy and failure behavior

Before first use, explain that the browser may send audio to its speech service. Do not claim that recognition is on-device, offline or supported everywhere. Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition (checked 2026-10-25).

Everloot does not record, persist or upload raw audio. Only a transcript the player explicitly sends becomes an account/local chat message under the selected storage behavior. Unsent drafts do not sync. The existing chosen model receives the submitted text through the existing chat flow.

The current global Permissions-Policy blocks microphones. Proposed necessary configuration change: permit `microphone=(self)` only on `/chat` and its subpaths, including the served game-version prefix. Keep microphone access blocked on public pages, `/account`, `/settings` and other origins. This permits the user-initiated browser prompt; it does not grant permission or start recording automatically. The enforced CSP and third-party-script exclusion remain unchanged. Verify header-rule precedence and both prefixed/unprefixed routes.

Request microphone access only after a deliberate action. Stop on user Stop, page exit, conversation/project switch, error or Send. Never restart automatically. Preserve the previous draft on permission refusal, no speech, unsupported browsers or recognition failure. Make unsupported availability and the typing fallback clear.

Use final recognition segments once; do not duplicate interim segments. Keep transcript length inside the existing composer limit and preserve the player's typed edits. Provide a language selector, initially matching the browser language. Listening state and errors must be keyboard-accessible and announced to assistive technology.

## Verification

Test supported/unsupported APIs, permission refusal, start/stop/unmount, duplicated events, existing draft edits, language changes, length limits and no automatic Send. Tests and browser checks must use simulated recognition rather than recording the operator's real microphone. Test the scoped microphone policy as well as the unchanged CSP; no external loader is part of this change.
