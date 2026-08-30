# Phase 6 — Object Detection (Gemini Vision)

## Goal

Point the camera at something and ask "what is this" for a real answer.

## Current state (implemented 2026-08-27, superseding the original plan below)

`lib/objectDetector.ts`'s `CameraObjectDetector` was rewritten from scratch.
The original plan (below, kept for history) called for a local MediaPipe
EfficientDet model with COCO-class bounding boxes, upgraded with a Gemini
snapshot flow layered on top. In practice the local-model approach turned out
to be a real source of bugs (a relative model path that MediaPipe's WASM
runtime could resolve against the wrong origin, silently swallowed by an
overly defensive fallback chain) and was fundamentally limited to ~80 generic
COCO labels ("cup", "bottle", "person") — nowhere near good enough to answer
"what am I holding" for anything specific.

**What's there now instead:**

- No local ML model, no MediaPipe `ObjectDetector`, no `.tflite` asset. The
  camera opens (same shared `#webcam-video` / `#camera-overlay-canvas`
  elements gesture mode uses — same right-side panel, same flow) and draws a
  lightweight pure-canvas scanning HUD (corner brackets + sweep line), no ML
  inference involved in that visual.
- Identification is a real Gemini vision call: `lib/objectDetector.ts` posts
  a captured frame to a new dedicated endpoint, `app/api/vision-scan/route.ts`,
  which asks Gemini to identify the object in view and returns a short label.
  This means detection understands *anything* Gemini can recognize, not a
  fixed 80-class list.
- `lib/gemini.ts` is a new shared helper (used by both `/api/chat` and
  `/api/vision-scan`) that handles the model-candidate fallback list and
  self-healing model-name resolution — this exists because Google retired
  `gemini-2.5-flash` mid-project and every call was silently falling back to
  a dumb local engine; see the git history / prior session notes on that bug
  for the full story.
- **Quota-aware by design.** Gemini's free tier is extremely small (as low as
  ~20 requests/day, confirmed by hitting it during testing — shared across
  this app's chat AND vision features). A naive "scan every frame" or even
  "scan every few seconds forever" loop would exhaust the whole day's budget
  in minutes. So: one scan happens automatically when Vision mode opens, then
  further scans are manual — a "🔍 SCAN OBJECT" dock button, or saying
  "what is this" / "what am I holding" while Vision mode is active (both call
  `CameraObjectDetector.scanNow()` directly). Continuous auto-scan exists
  (`setAutoScan(true)`, 20s interval — safely under the free tier's 5
  requests/minute cap) but is opt-in, not the default.
- Rate-limit handling is explicit, not silent: a 429 from Gemini surfaces as
  a `"cooldown"` vision state with a live countdown in the HUD badge
  (`CAM: VISION [QUOTA COOLDOWN 47s]`), not a silently-empty result.

## Acceptance criteria

- [x] Vision mode opens the same camera panel gesture mode uses, no separate UI.
- [x] Opening Vision mode gives an initial identification automatically.
- [x] "What am I holding" / "what is this" while Vision mode is active triggers
      a fresh scan and gives a specific, Gemini-generated answer, not a fixed
      COCO label or a generic filler.
- [x] Hitting the Gemini rate limit shows a visible cooldown instead of
      silently doing nothing.
- [ ] Verified end-to-end with a real webcam (blocked in the sandboxed
      environment used to build this — needs manual verification on your
      machine: open Vision, grant camera permission, confirm a label appears
      and the SCAN button re-triggers it).

---

## Original plan (superseded, kept for history)

Point the camera at something and ask "what is this" for a real answer, with
visible on-screen recognition rather than a background-only feed.

`lib/objectDetector.ts`'s `CameraObjectDetector` already runs live detection
and feeds labels into `app/api/chat/route.ts` as `detectedObjects`, which
Gemini receives as context text alongside the camera frame
(`imageBase64` multimodal input already wired up). This is a solid foundation —
this phase is about tightening the loop, not building from scratch.

1. **On-screen bounding boxes / labels** — currently detection presumably feeds
   labels into state without a visible overlay (verify against current
   component during implementation); add a canvas overlay drawing boxes +
   confidence-labeled tags over the live camera feed so you can see what
   Ultron sees.
2. **"What is this" snapshot flow** — a dedicated `capture_and_identify` tool:
   grabs one frame at the moment you ask, sends it to Gemini multimodal with
   the current `detectedObjects` as a hint, and reads back a specific answer
   ("That looks like a Nintendo Switch controller") instead of a generic
   "I have optical tracking active" filler currently returned when
   `detectedObjects` is empty.
3. **Continuous vs. on-demand modes** — keep continuous light-weight detection
   for the HUD label feed, but only send a frame to Gemini (network call) on
   explicit request, to avoid constant API usage/latency.
4. **Model check** — confirm which model `CameraObjectDetector` currently loads
   (MediaPipe `ObjectDetector` task vs. something else) and, if it's a small
   default model, evaluate swapping to `EfficientDet-Lite2` for better accuracy
   at an acceptable perf cost on your hardware — this is a one-line model asset
   swap once confirmed, not a rewrite.
