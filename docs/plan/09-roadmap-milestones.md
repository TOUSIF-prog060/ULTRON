# Roadmap & Milestones

Build order is chosen so every phase ships something you can actually use
before starting the next, and so the safety system (Phase 8) is in place
*before* the first destructive tool (delete) goes live — not bolted on after.

## Milestone 1 — Safe file & app control (Phases 8 + 1 + 2)

The biggest capability jump with the least new external dependency risk
(no third-party services, everything is local OS calls).

- Safety system: soft-delete helper, confirmation gate, deny-list config, audit log.
- File tools: `open_file` (fuzzy, indexed), `search_files` (upgraded), `delete_file`
  (Recycle Bin + confirm), `move_file`, `rename_file`, `create_file`/`create_folder`,
  `close_file` (best-effort via session-opened registry).
- App tools: dynamic catalog via `Get-StartApps`, fuzzy `open_app_or_file`,
  `list_running_apps`, `close_app` (graceful → forced + confirm), `switch_to_app`.
- Voice engine: expand `ASSISTANT_TOOLS`, wire confirmation prompts into
  `JarvisOrb.tsx`'s command loop (voice yes/no only — gesture yes/no comes in
  Milestone 3).

**Done when:** you can say "open my resume", "delete that old screenshot",
"close Discord", "what's running", and each works correctly with a delete/close
confirmation you can accept or reject by voice.

## Milestone 2 — Real WhatsApp (Phase 3)

Gated on you being comfortable with the ToS/account-risk trade-off described in
[03-whatsapp-automation.md](03-whatsapp-automation.md).

- `whatsapp-web.js` integration + one-time QR pairing.
- Real contact list replacing the placeholder `data/contacts.json`, plus a
  small nickname-alias file for "brother"/"mom"-style commands.
- `whatsapp_send_message` now actually sends, gated by confirmation.

**Done when:** "message my brother saying I'm on my way" finds your real
brother in WhatsApp and delivers the message after a confirm.

## Milestone 3 — The orb feels alive (Phases 5 + 7)

Pure front-end work, no new external services — good to interleave with
Milestone 1/2 if you want visible progress sooner since it doesn't depend on
them.

- Emotion state machine in `orbScene.ts` (idle/listening/thinking/speaking/
  executing/greeting/success/error/confirm_pending).
- Live mic-amplitude-driven core pulse while listening; TTS-envelope-driven
  pulse while speaking.
- Gesture additions: thumbs-up/down wired to the confirmation resolver from
  Milestone 1, open-palm-hold mute, fist-hold stop.

**Done when:** the orb visibly and distinctly reacts to greetings, errors,
success, and a pending confirmation — and you can thumbs-up/down a
confirmation instead of speaking.

## Milestone 4 — Vision upgrade (Phase 6 + Screen Vision)

- On-screen bounding boxes for detected objects.
- `capture_and_identify` tool for a specific "what is this" answer.
- Model upgrade if warranted after checking the current model in
  `lib/objectDetector.ts`.
- `read_screen` tool: `getDisplayMedia()`-based one-shot screen capture routed
  through the same Gemini multimodal path, per
  [06b-screen-vision.md](06b-screen-vision.md) — including the one-time
  "screen captures are sent to Gemini" notice and the visible
  "screen-watching" orb state if continuous mode is ever added.

**Done when:** pointing the camera at something and asking "what is this"
gives a specific, accurate spoken answer with a visible box around the object,
**and** saying "what's on my screen" opens the native share picker once,
captures a frame, and gives an accurate spoken description of what's actually
displayed.

## Milestone 5 — Always-on core service (Phase 5's architectural piece)

The bigger refactor: extract the tool executor + Gemini orchestration + the
WhatsApp session out of the per-request Next.js API route into a persistent
background Node process that the web orb, `cli.js`, and `ultron_terminal.py`
all connect to (e.g. over a local WebSocket), plus wake-word listening
("Hey Ultron") that doesn't require a focused browser tab.

This is scheduled last deliberately — it's a structural change, highest effort,
and everything in Milestones 1–4 works and is testable without it (just with
the current constraint that the browser tab needs to be open/focused, and the
WhatsApp session reconnects per Next.js server restart rather than truly
persisting).

**Done when:** you can say "Hey Ultron, open Spotify" without a browser tab
focused or a key pressed, and it works.

## Suggested first step

Start Milestone 1 with just Phase 8 (safety system) + `delete_file` +
`open_file` end-to-end, as the smallest slice that proves the whole
confirm → execute → audit-log loop works, before building out the rest of the
file/app tool surface on top of a pattern you've already seen work.
