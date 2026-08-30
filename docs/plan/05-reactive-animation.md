# Phase 5 — Reactive Orb Animation (looks alive when you talk to it)

## Goal

When you speak, the orb visibly reacts in real time — not just a static
listening indicator. Saying "hello" gets a distinct friendly animation; errors
look different from success; the orb pulses in sync with your voice and with
its own spoken replies.

## What already exists to build on

`lib/voiceCommander.ts` already sets up a Web Audio `AnalyserNode` on the
microphone stream for the equalizer wave visualizer, and `lib/orbScene.ts`
exposes an `OrbSceneApi` with theme/pulse control. The wiring between "live
audio amplitude" and "core geometry" isn't fully connected yet — the equalizer
bars react, but the orb's core shells/emissive intensity don't.

## Emotion state machine

Add `setEmotionState(state: EmotionState)` to `OrbSceneApi` in `lib/orbScene.ts`,
with states:

| State | Trigger | Visual treatment |
|---|---|---|
| `idle` | Default, nothing happening | Slow ambient rotation, baseline glow |
| `listening` | Mic active, waiting for speech | Core pulses with live mic amplitude (see below), outer ring brightens |
| `thinking` | Waiting on Gemini API response | Faster inward-spiraling particle motion, subtle color desaturation |
| `speaking` | TTS is playing the response | Core pulses with **TTS output** amplitude (a "talking" look) |
| `executing` | A tool call is running (opening app, deleting file, etc.) | Quick outward pulse burst + scan-ring sweep |
| `greeting` | Wake word / "hello" detected | A one-off bright, friendly full-color pulse + brief rotation flourish, distinct from `overdrive` |
| `success` | Tool call completed OK | Short green-tinted ring flash (independent of active theme color) regardless of current protocol, so success always reads clearly |
| `error` | Tool call failed / API error | Short red flicker + slight shake/jitter on the core |
| `confirm_pending` | Waiting on a yes/no confirmation (Phase 4) | Slow amber double-pulse "waiting for input" look, distinct from `listening` |

Each state is a small, self-contained animation preset (color tint, pulse
frequency/amplitude, particle behavior) layered on top of the existing theme
system (crimson/jarvis/gold/etc.) — theme picks the base palette, emotion state
picks the transient behavior on top of it.

## Audio-amplitude-driven core pulse

Feed the existing `AnalyserNode` amplitude data (already computed for the
equalizer) into the orb core's scale/emissive-intensity each frame while in
`listening` state, and do the same using an analyser on the **TTS output**
audio while in `speaking` state (Web Speech API TTS doesn't expose raw audio
directly, so approximate this with an envelope generator synced to
utterance start/duration, or route TTS through the Web Audio API via
`speechSynthesis` + a `MediaElementAudioSourceNode` where the browser allows it —
document that a real amplitude-accurate lip-sync isn't fully achievable with
Web Speech TTS everywhere, and an approximated envelope is an acceptable v1).

## Acceptance criteria

- [ ] Speaking louder/softer while Ultron is listening visibly changes the
      orb's pulse in real time (not just the equalizer bars).
- [ ] Saying "hello" produces a distinct, recognizable greeting animation vs.
      idle state.
- [ ] A failed action visibly looks different (red flicker) from a successful
      one (green flash) without checking the text log.
- [ ] A pending confirmation (Phase 4) has its own clearly distinct look so you
      know Ultron is waiting on you specifically.
