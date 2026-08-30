# ULTRON — Advanced Personal Assistant: Master Plan

## Vision

Turn the existing ULTRON Orb UI (a voice/gesture-controlled 3D holographic front-end)
into a real, always-available personal assistant for **your own machine** that can:

- Open, search, move, and delete files/folders by voice.
- Launch and close **any** installed application, not just a hardcoded list.
- Find a person in your real WhatsApp contacts and actually send the message
  (not just open a pre-filled compose box).
- React visibly and immediately to your voice — the orb should look "alive":
  pulsing with your speech, shifting mood for greetings/errors/success.
- Understand a much wider vocabulary of spoken commands.
- See through the camera (object detection) and understand hand gestures,
  including using gestures to answer yes/no prompts.
- See what's on your **screen** when you ask — "detect the screen" reads and
  describes whatever's currently displayed.

This is a single-user, local-machine assistant. It is **not** meant to be exposed
to a network or to other users — the trust model throughout this plan assumes
"whoever can talk to the microphone on this PC is authorized."

## Current state (baseline, already reviewed)

- Next.js/React/Three.js orb UI, client-only.
- Voice via Web Speech API (`lib/voiceCommander.ts`), TTS also via Web Speech.
- Gestures via MediaPipe HandLandmarker (`lib/handTracker.ts`) — pinch-to-spin/zoom only.
- Object detection scaffold in `lib/objectDetector.ts`.
- Brain: `app/api/chat/route.ts` — Gemini function-calling if an API key is present,
  else a regex-based local intent engine. Both call the same tool executor.
- Tools today (`lib/tools/executor.ts`): open app/URL (hardcoded map), web search,
  recursive filename search (read-only), read file, list directory, WhatsApp deep-link
  (opens compose box, does not send), system telemetry, orb UI control.
- No delete/close/kill capability exists yet. No confirmation system. No audit log.
- `cli.js` and `ultron_terminal.py` duplicate the same command logic as standalone
  terminal front-ends.

## Target architecture

```
                    ┌─────────────────────────────────────────┐
                    │            ULTRON CORE SERVICE            │
                    │   (persistent local Node process)         │
                    │                                            │
  Web Orb UI  ──ws──►  Intent Router  ──►  Gemini function-calls │
  CLI (cli.js)──ws──►      │                     │                │
  Python term ──ws──►      │                     ▼                │
                    │      │              Tool Executor            │
                    │      │        (allow/deny paths, confirm     │
                    │      │         gate, audit log, undo stack)  │
                    │      ▼                     │                │
                    │  Confirmation Broker ◄──────┘                │
                    │  (voice "yes/no", thumbs-up/down gesture)    │
                    └─────────────────────────────────────────┘
                                     │
                     OS: file system, processes, WhatsApp session
```

Key architectural change from today: pull the tool-execution brain out of the
Next.js request/response cycle and into a **persistent background core service**
(Phase 5). Today everything only runs while a browser tab hits the Next dev/start
server — fine for the current feature set, but it blocks two things you asked for:
"always listening" wake-word behavior, and a WhatsApp session that has to stay
logged in across restarts. Phases 1–4 can still be built directly against the
current Next.js server; the core-service extraction is a refactor, not a rewrite,
and is scheduled last (Phase 5) so we get visible features first.

## Design principles used throughout this plan

1. **Everything destructive is reversible or confirmed.** Delete → Recycle Bin,
   never a permanent unlink. Close/kill app, send WhatsApp message → spoken or
   gestured confirmation by default (toggle-able per action type in settings).
2. **Every tool call is logged.** One append-only audit log so you can always see
   what Ultron actually did.
3. **Scope file/process access to what makes sense for a personal machine** —
   deny-list system directories (`C:\Windows`, `Program Files`, other user
   profiles) from delete/write operations.
4. **Fuzzy match voice input.** Speech-to-text is imperfect; app names, file
   names, and contact names should resolve via fuzzy/substring matching, not
   exact string equality.
5. **Ship incrementally.** Each phase below is independently useful and testable
   in the running app before moving to the next.

## Phase index

| Phase | Doc | Theme |
|---|---|---|
| 1 | [01-file-system-access.md](01-file-system-access.md) | Real file open/delete/move/rename with safety rails |
| 2 | [02-app-control.md](02-app-control.md) | Launch/close/list *any* installed app |
| 3 | [03-whatsapp-automation.md](03-whatsapp-automation.md) | Real contact lookup + real send |
| 4 | [04-voice-command-engine.md](04-voice-command-engine.md) | Wake word, confirmations, wider vocabulary |
| 5 | [05-reactive-animation.md](05-reactive-animation.md) | Orb reacts live to voice/mood |
| 6 | [06-object-detection.md](06-object-detection.md) | Vision upgrades (camera) |
| 6b | [06b-screen-vision.md](06b-screen-vision.md) | "What's on my screen" — screen capture + Gemini vision |
| 7 | [07-gesture-detection.md](07-gesture-detection.md) | Expanded gesture vocabulary incl. yes/no |
| 8 | [08-safety-and-permissions.md](08-safety-and-permissions.md) | Cross-cutting safety system all phases plug into |
| 9 | [09-roadmap-milestones.md](09-roadmap-milestones.md) | Build order, acceptance criteria, effort estimate |

Read [08-safety-and-permissions.md](08-safety-and-permissions.md) first if you only
read one other doc — it's the system every risky feature (1, 2, 3) plugs into.
