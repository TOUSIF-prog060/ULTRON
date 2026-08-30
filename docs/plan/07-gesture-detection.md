# Phase 7 — Expanded Gesture Vocabulary

## Goal

Beyond today's pinch-to-spin/zoom, add a small set of high-value gestures,
most importantly **hands-free yes/no** so the confirmation flow from Phase 4
doesn't always require speaking.

## Current state

`lib/handTracker.ts`'s `HandTracker` already tracks landmarks with pinch
hysteresis for one-hand spin and two-hand zoom (`GestureMode = "idle" | "spin" |
"zoom"`). The landmark pipeline (MediaPipe HandLandmarker) already gives us
everything needed for more gesture classification — this is additive
recognition logic on data already being computed, not a new tracking system.

## New gestures

| Gesture | Recognition | Action |
|---|---|---|
| Thumbs-up | Thumb tip extended away from a closed fist, pointing up | Confirm ("yes") for a pending confirmation prompt (Phase 4) |
| Thumbs-down | Same shape, pointing down | Deny ("no") for a pending confirmation prompt |
| Open palm hold (~1s) | All 5 fingertips extended and roughly stationary | Toggle mute, matching the `M` key today |
| Closed fist hold (~1s) | All fingertips curled near palm | "Stop" — halts auto-spin / cancels an in-progress confirmation, matching "freeze"/"halt" voice commands |
| Two-hand twist | Both hands pinching, rotating relative to each other | Fine rotation control (supplements today's zoom-by-spreading) |

Each gesture needs a short hold/hysteresis window (similar to the existing
pinch hysteresis) to avoid false triggers during natural hand movement.

## Wiring into the confirmation system

`HandTrackerCallbacks` gains `onConfirm()` / `onDeny()` callbacks, which
`JarvisOrb.tsx` treats identically to the voice "yes"/"no" path from Phase 4 —
one confirmation resolver, two possible input methods (voice or gesture).

## Acceptance criteria

- [ ] A thumbs-up/down gesture resolves a pending confirmation exactly like
      saying "yes"/"no" would.
- [ ] New gestures don't cause false positives during normal spin/zoom use
      (tested by deliberately doing rapid spin/zoom motions and confirming no
      accidental confirm/deny/mute triggers).
