# Screen Vision — "What's on my screen?"

## Goal

"Detect the screen" / "what's on my screen" / "read my screen" / "what am I
looking at" → Ultron captures what's currently displayed and gives you a
spoken description or answers a specific question about it — "summarize this
article", "what does this error say", "what's this code doing".

## Why this is separate from camera object detection

Camera vision ([06-object-detection.md](06-object-detection.md)) sees the
physical world through the webcam. Screen vision sees the desktop itself —
browser tabs, open documents, code editors, error dialogs. Different capture
source, same downstream flow: grab one frame, send it to Gemini multimodal,
speak back the answer — this reuses the exact `imageBase64` path already wired
up in `app/api/chat/route.ts` for camera vision.

## Recommended approach: browser Screen Capture API, not a silent native screenshot

There are two ways to grab "what's on the screen," and the choice here matters
more than it looks:

**A) Browser `getDisplayMedia()` — recommended.**
`navigator.mediaDevices.getDisplayMedia()` triggers the OS's own native
"choose what to share" picker — the same dialog you'd see sharing your screen
on a video call (pick a specific window, an app, or the whole screen). Grab a
single frame from the returned stream onto an off-screen `<canvas>`, export it
as a JPEG data URL, send it to `/api/chat` as `imageBase64`. Stop the stream
immediately after capturing that one frame — don't leave a live
screen-recording session running — unless you deliberately turn on a
continuous "watch my screen" mode.

**B) Native OS screenshot** (e.g. a PowerShell `System.Drawing` /
`Windows.Graphics.Capture` call triggered directly by the tool executor, the
same pattern `open_app_or_file` already uses to shell out) — technically
simpler, no browser API needed, **but has no visible consent step**. A spoken
phrase would silently capture literally anything on screen at that instant —
a password manager left unlocked in another window, a private chat, a banking
dashboard — with zero on-screen indication it happened. That's a meaningfully
bigger privacy exposure than anything else in this plan, bigger than file
delete, bigger than camera vision (a webcam at least has a hardware light;
an instant background screenshot has no equivalent tell).

**Recommendation: build option A only.** Option B is documented here so the
trade-off is explicit, not because it's the plan — don't build the silent
native path unless you've deliberately decided you want it despite the above.

## Flow (option A)

1. You say "detect the screen" / "what's on my screen".
2. If no screen-share session is active yet this session, the browser's
   native picker opens (you choose a window/app/whole screen) — this happens
   once per browser session, not on every single request, unless you revoke
   sharing in between.
3. Ultron grabs one frame from the shared stream and immediately stops the
   stream (default one-shot mode) — or keeps it alive only if you've
   explicitly enabled continuous "watch my screen" mode.
4. The frame is sent to Gemini multimodal alongside your spoken
   question/instruction, exactly like the existing camera vision flow.
5. The answer comes back and is spoken, same as any other response.

## New tool

| Tool | Behavior |
|---|---|
| `read_screen` | Captures one frame via `getDisplayMedia()` and calls the existing chat endpoint with `imageBase64` + your question. |

Because the capture step has to happen in the browser — the Node process
running the Next.js server has no access to your monitor's framebuffer on its
own — `read_screen` is best modeled as **client-initiated**: when
Gemini's function-calling decides to call `read_screen` with no `imageBase64`
attached yet, `components/JarvisOrb.tsx` intercepts that specific tool call,
performs the capture, and re-sends the message with the frame attached, rather
than the server trying to execute it the way the other OS-level tools in
`lib/tools/executor.ts` run headlessly.

## Privacy notes

- Every screen read sends that frame to Google's Gemini API — same as the
  existing camera "what is this" flow, but screen content is more likely to
  contain sensitive material (open emails, financial dashboards, private
  messages) than a webcam frame. A one-time spoken/UI notice the first time
  it's used per session ("Screen captures are sent to Gemini for analysis —
  go ahead?") is a better fit than requiring confirmation on every single
  read, which would get old fast for something you'd likely use often. This
  is a one-time acknowledgment, distinct from the per-action confirmation
  gate in [08-safety-and-permissions.md](08-safety-and-permissions.md), which
  is reserved for destructive actions.
- Never auto-select "entire screen" as a default — let the browser's own
  picker apply its default, and log every screen read in the same audit log
  as every other tool call ([08-safety-and-permissions.md](08-safety-and-permissions.md)).
- One-shot capture is the default. A "watch my screen continuously" mode is a
  bigger step — effectively a standing screen-share — and should be opt-in,
  with the orb showing a distinct, persistent "screen-watching" visual state
  (per the emotion-state system in [05-reactive-animation.md](05-reactive-animation.md))
  for the entire time it's active, not just at the moment you trigger it.

## Acceptance criteria

- [ ] "What's on my screen" opens the native share picker once, captures a
      frame, and returns an accurate spoken description of the actual screen
      contents.
- [ ] "What does this error say" (with an error dialog visible) reads out the
      real error text, not a generic description.
- [ ] No screenshot is ever taken without the OS-level picker appearing at
      least once per session — no silent background captures.
- [ ] The screen-share stream stops immediately after each one-shot capture
      (verify the browser's tab/toolbar "sharing" indicator disappears)
      unless continuous mode is explicitly enabled.
