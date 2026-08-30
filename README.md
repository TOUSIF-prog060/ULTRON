# ULTRON Orb UI

An Iron Man–inspired holographic orb built with **Next.js**, **Three.js**, **Web Speech API**, and **MediaPipe** hand tracking — control it with your voice and bare hands through your webcam & microphone.

> 🔮 This is the open-source **interface** of [ULTRON](https://sagartamang.com/projects/ultron) — my AI that talks in real time and controls Android devices by itself. **[Read the write-up](https://sagartamang.com/projects/ultron)** or **[the X post](https://x.com/sagar_builds/status/2077277583646101921)**

> 📱 **[Watch the demo on Instagram](https://www.instagram.com/p/DayJ17OTwvx/)**

![ULTRON orb UI](docs/screenshot.png)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Making ULTRON actually smart

Out of the box it only has the Gemini free tier (~20 requests/day, shared
between chat **and** vision), so it runs dry fast and drops to a limited
regex intent engine. Copy `.env.example` to `.env.local` and add **at
least one** real brain key:

| Key | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Primary brain (Claude) — best tool use |
| `OPENAI_API_KEY` | Brain + vision fallback (GPT) |
| `PERPLEXITY_API_KEY` | Live web research (`research_web` tool) |
| `GEMINI_API_KEY` | Optional extra vision/brain |
| — (Ollama) | Offline brain/vision, no key — see `docker-compose.yml` |

Providers are tried in order (`claude → openai → gemini → ollama`) and it
falls through on any failure. Check what's live at
[`/api/health`](http://localhost:3000/api/health).

### Persistent memory

ULTRON remembers across sessions. Say *"remember that…"* / *"my name
is…"* and it's saved to `data/memory/`. Correct it (*"no, I meant…"*) and
the correction is stored and injected into every future prompt so it
doesn't repeat the mistake. Inspect or wipe it via
[`/api/memory`](http://localhost:3000/api/memory). See
[docs/MEMORY.md](docs/MEMORY.md).

## Controls

### 🎙️ Voice Commands (Microphone)

Click **`VOICE OFF (V)`** (or press `V`) to activate speech recognition. Speak any of the following natural directives:

| Category | Spoken Commands | Action |
| --- | --- | --- |
| **Navigation** | *"Zoom in"*, *"Enhance"*, *"Closer"* | Magnify the orb |
| | *"Zoom out"*, *"Step back"*, *"Farther"* | Zoom out / expand view |
| | *"Rotate left"*, *"Turn left"*, *"Spin left"* | Revolve orb left |
| | *"Rotate right"*, *"Turn right"*, *"Spin right"* | Revolve orb right |
| | *"Tilt up"*, *"Look up"* / *"Tilt down"*, *"Look down"* | Pitch view angle |
| | *"Reset"*, *"Recalibrate"*, *"Center"*, *"Home"* | Reset to default view |
| **Movement** | *"Auto spin"*, *"Start spinning"* | Continuous orbital revolution |
| | *"Faster"*, *"Speed up"* / *"Slower"*, *"Slow down"* | Adjust rotational velocity |
| | *"Stop spin"*, *"Freeze"*, *"Halt"* | Lock rotation in place |
| | *"Overdrive"*, *"Pulse"*, *"Maximum power"* | Trigger high-energy surge |
| **Protocols (Themes)** | *"Protocol Crimson"*, *"Red alert"*, *"Ultron mode"* | Ultron Crimson Red |
| | *"Protocol Jarvis"*, *"Blue mode"*, *"Cyan"* | Holographic Cyan/Blue |
| | *"Protocol Gold"*, *"Amber"*, *"Standard mode"* | Classic Amber Gold |
| | *"Protocol Emerald"*, *"Matrix mode"* | Matrix Emerald Green |
| | *"Protocol Amethyst"*, *"Purple theme"* | Violet Amethyst Core |
| | *"Protocol Ice"*, *"White theme"* | Cryo Frost Silver |
| **System** | *"Gestures on"*, *"Camera on"* / *"Gestures off"* | Toggle webcam hand tracking |
| | *"Status"*, *"Diagnostics"*, *"Telemetry"* | System status report |
| | *"Mute"* / *"Unmute"* | Toggle AI speech synthesis voice |
| | *"Help"*, *"Show commands"* | Open voice directives dialog |

---

### ✋ Hand Gestures (Webcam)

Click **GESTURES OFF** (or press `G`) and allow camera access:

| Gesture | Action |
| --- | --- |
| Pinch (thumb + index) one hand and move it | Spin the orb |
| Pinch with **both** hands, spread apart / bring together | Zoom in / out |
| 👍 Thumbs up (hold) | Confirm a pending action |
| 👎 Thumbs down (hold) | Cancel a pending action |
| 🖐️ Open palm (hold) | Toggle AI voice mute |
| ✊ Closed fist (hold) | Emergency stop (halt spin / cancel) |
| ☝️ Index point (hold) | Focus / zoom in pulse |
| ✌️ Peace sign (hold) | Cycle hologram colour theme |
| 🤟 Three fingers (hold) | Toggle auto-spin |
| 🖐️ Open-palm fast swipe ◀ ▶ | Rotate the orb left / right |

---

### ⌨️ Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `V` | Toggle Voice Command listening |
| `G` | Toggle webcam hand gestures |
| `P` | Trigger Overdrive energy pulse |
| `H` | Open/Close Voice Directives manual |
| `M` | Mute / Unmute AI voice synthesis |
| `R` | Reset the view |
| `+` / `−` | Zoom in / out |

---

### 🖱️ Mouse / Touch

| Input | Action |
| --- | --- |
| Drag | Spin the orb |
| Scroll / Pinch | Zoom in & out |

## How it works

- **`lib/voiceCommander.ts`** — Web Speech recognition engine, Web Audio SFX synthesizer, microphone frequency analyzer for live equalizer wave visualizer, and TTS voice feedback.
- **`lib/orbScene.ts`** — Three.js holographic scene: multi-layered wireframe shells, dynamic theme color grading, spiral core, orbiting debris, code particles, scan rings, and post-processing bloom.
- **`lib/handTracker.ts`** — MediaPipe HandLandmarker running on the webcam feed with pinch hysteresis detection.
- **`components/JarvisOrb.tsx`** — Sci-Fi HUD terminal, voice equalizer, quick command chips, and input orchestration.

## License

MIT
