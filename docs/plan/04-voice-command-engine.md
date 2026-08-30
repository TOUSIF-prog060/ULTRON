# Phase 4 — Voice Command Engine (wider vocabulary, wake word, confirmations)

## Goal

Understand "every possible command" as broadly as practical, activate without
pressing a key, and support yes/no confirmation for the risky actions
introduced in Phases 1–3.

## What already works well

`app/api/chat/route.ts`'s Gemini function-calling path is already a good,
general NLU layer — it maps free-form speech to the tool schema in
`lib/tools/definitions.ts` without needing per-phrase regexes. As we add tools
(Phases 1–3), this path scales automatically: **expanding
`ASSISTANT_TOOLS` is most of "understanding more commands."** The regex-based
`executeLocalIntentEngine` fallback (for when there's no Gemini key) is
necessarily narrower and will need matching updates for the highest-value new
commands (open/delete file, close app), but doesn't need to cover everything —
it's explicitly the "no API key" fallback, not the primary brain.

## Wake word ("Hey Ultron")

Currently voice listening is toggled by pressing `V` or clicking a button.
For a more assistant-like feel, add always-on wake-word detection:

- Use [Porcupine](https://picovoice.ai/platform/porcupine/) (on-device,
  works offline, has a free tier for personal use) with a custom "Hey Ultron"
  keyword, or a simpler open-source keyword spotter if avoiding a third-party
  SDK is preferred.
- Wake-word listener runs continuously at low resource cost; on detection, it
  triggers full `VoiceCommander` speech recognition for the actual command,
  same as pressing `V` today.
- This only makes full sense once Phase 5's background core service exists —
  a browser tab has to stay open and focused for continuous mic access
  otherwise. Until then, ship this phase with manual activation retained and
  wake-word as a stretch add-on if the browser-tab constraint is acceptable to
  you.

## Confirmation subsystem

A cross-cutting addition used by Phases 1–3: any tool definition gains a
`requiresConfirmation: boolean` (default true for `delete_file`, `close_app`,
`whatsapp_send_message`; default false for read-only tools). Flow:

1. Gemini (or the local engine) decides to call a guarded tool.
2. Instead of executing immediately, the orchestrator emits a spoken/UI prompt:
   *"Delete report.docx — are you sure?"*
3. User responds "yes"/"confirm"/"do it" (voice) or a thumbs-up gesture
   (Phase 7), or "no"/"cancel"/thumbs-down to abort.
4. Only on affirmative confirmation does `executeTool` actually run.

This needs a small piece of conversation state (pending action + timeout,
e.g. auto-cancel after 15s of silence) added to `JarvisOrb.tsx`'s command
handling loop.

## Settings for confirmation policy

A simple `data/settings.json` (or extend the existing localStorage-based config
panel already visible in `JarvisOrb.tsx`) lets you toggle confirmation
requirements per action type, e.g. "always confirm deletes" (recommended, on by
default) vs "never confirm app closes" (fine to turn off since Phase 2 already
tries a graceful close first).

## Acceptance criteria

- [ ] Every new tool from Phases 1–3 is reachable via natural free-form speech
      through the Gemini path, no exact-phrase matching required.
- [ ] A guarded action (delete/close/send) always pauses for confirmation
      unless explicitly disabled in settings for that action type.
- [ ] Saying "no"/"cancel" during a confirmation prompt cleanly aborts with no
      side effects.
