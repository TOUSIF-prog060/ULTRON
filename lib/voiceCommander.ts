// ═══════════════════════════════════════════════════════════════════
//  VoiceCommander — Google Gemini Live-style voice assistant engine
//  Key fix: recognition is FULLY STOPPED while TTS speaks, then
//  restarted cleanly after a cooldown — no feedback loop possible.
// ═══════════════════════════════════════════════════════════════════

export type VoiceTheme = "gold" | "crimson" | "jarvis" | "emerald" | "amethyst" | "ice";

export interface VoiceThemeConfig {
  id: VoiceTheme;
  name: string;
  primary: string;
  bright: string;
  dim: string;
  glow: string;
  colorHex: number;
  chromaticTone: [number, number, number];
}

export const VOICE_THEMES: Record<VoiceTheme, VoiceThemeConfig> = {
  gold: {
    id: "gold",
    name: "PROTOCOL GOLD",
    primary: "#ffaa30",
    bright: "#ffcc66",
    dim: "#884400",
    glow: "rgba(255, 170, 48, 0.6)",
    colorHex: 0xffaa30,
    chromaticTone: [1.15, 0.85, 0.55],
  },
  crimson: {
    id: "crimson",
    name: "PROTOCOL CRIMSON",
    primary: "#ff2a2a",
    bright: "#ff6666",
    dim: "#880000",
    glow: "rgba(255, 42, 42, 0.75)",
    colorHex: 0xff2a2a,
    chromaticTone: [1.3, 0.5, 0.5],
  },
  jarvis: {
    id: "jarvis",
    name: "PROTOCOL JARVIS",
    primary: "#00d4ff",
    bright: "#80eaff",
    dim: "#005577",
    glow: "rgba(0, 212, 255, 0.65)",
    colorHex: 0x00d4ff,
    chromaticTone: [0.5, 0.95, 1.3],
  },
  emerald: {
    id: "emerald",
    name: "PROTOCOL EMERALD",
    primary: "#00ff88",
    bright: "#80ffc0",
    dim: "#006633",
    glow: "rgba(0, 255, 136, 0.65)",
    colorHex: 0x00ff88,
    chromaticTone: [0.5, 1.25, 0.7],
  },
  amethyst: {
    id: "amethyst",
    name: "PROTOCOL AMETHYST",
    primary: "#bf55ec",
    bright: "#e099ff",
    dim: "#551177",
    glow: "rgba(191, 85, 236, 0.65)",
    colorHex: 0xbf55ec,
    chromaticTone: [1.1, 0.6, 1.3],
  },
  ice: {
    id: "ice",
    name: "PROTOCOL ICE",
    primary: "#d8ecf8",
    bright: "#ffffff",
    dim: "#557788",
    glow: "rgba(216, 236, 248, 0.7)",
    colorHex: 0xd8ecf8,
    chromaticTone: [1.0, 1.05, 1.15],
  },
};

export interface VoiceActionCallbacks {
  onRotate?: (dt: number, dp: number) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetView?: () => void;
  onAutoSpin?: (speed: number) => void;
  onToggleGestures?: (enable?: boolean) => void;
  onSetTheme?: (theme: VoiceTheme) => void;
  onPulse?: () => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onResponse?: (reply: string) => void;
  onAssistantDirective?: (phrase: string) => void;
  onError?: (err: string) => void;
  onListeningChange?: (listening: boolean) => void;
  onAudioLevel?: (level: number, frequencyData: Uint8Array) => void;
}

interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
}

export class VoiceCommander {
  private callbacks: VoiceActionCallbacks;

  // State flags
  private active = false;          // User wants voice to be running
  private isMuted = false;         // TTS output muted
  private isSpeaking = false;      // TTS currently playing
  private isRecognizing = false;   // SpeechRecognition.start() called and active

  // Recognition
  private recognition: ISpeechRecognition | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  // Deduplication — prevent same phrase firing twice
  private lastPhrase = "";
  private lastPhraseTime = 0;

  // Failure tracking — back off instead of restart-looping silently forever
  private consecutiveErrors = 0;
  private lastErrorSurfacedAt = 0;

  // Cached voice list (getVoices() is empty until the async 'voiceschanged' fires)
  private cachedVoices: SpeechSynthesisVoice[] = [];

  // Web Audio (visualiser + SFX)
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private freqData: Uint8Array | null = null;
  private animFrameId = 0;

  constructor(callbacks: VoiceActionCallbacks) {
    this.callbacks = callbacks;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      this.cachedVoices = window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        this.cachedVoices = window.speechSynthesis.getVoices();
      });
    }
  }

  static isSupported(): boolean {
    if (typeof window === "undefined") return false;
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  // ─── PUBLIC LIFECYCLE ────────────────────────────────────────────

  async start(): Promise<void> {
    if (!VoiceCommander.isSupported()) {
      throw new Error("Speech recognition is not supported in this browser. Use Chrome or Edge.");
    }
    if (this.active) return;

    this.active = true;
    await this.initAudio();
    this.startRecognition();
    this.callbacks.onListeningChange?.(true);

    // Greet — mic is paused during this
    this.speak("Hi, I'm listening. How can I help you?");
  }

  stop(): void {
    this.active = false;
    this.stopRecognition();
    this.stopAudio();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.isSpeaking = false;
    this.consecutiveErrors = 0;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.callbacks.onListeningChange?.(false);
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.isMuted && typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    return this.isMuted;
  }

  getIsMuted() { return this.isMuted; }
  getIsListening() { return this.active; }

  // ─── RECOGNITION ENGINE ──────────────────────────────────────────

  private buildRecognition(): ISpeechRecognition {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r: ISpeechRecognition = new SR();
    r.continuous = false;        // ← Single utterance mode: no looping on its own
    r.interimResults = true;
    r.lang = "en-US";

    r.onstart = () => {
      this.isRecognizing = true;
      this.consecutiveErrors = 0; // a clean start proves the mic pipeline is alive again
      this.clearWatchdog();
    };

    r.onresult = (event: any) => {
      // If TTS is playing, discard everything
      if (this.isSpeaking) return;

      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (interim) this.callbacks.onTranscript?.(interim.trim(), false);

      if (final) {
        const clean = final.trim();
        const now = Date.now();

        // Deduplicate: skip if exact same phrase within 3 seconds
        if (
          clean.toLowerCase() === this.lastPhrase &&
          now - this.lastPhraseTime < 3000
        ) return;

        this.lastPhrase = clean.toLowerCase();
        this.lastPhraseTime = now;
        this.callbacks.onTranscript?.(clean, true);
        this.processCommand(clean);
      }
    };

    r.onerror = (event: any) => {
      this.isRecognizing = false;
      this.clearWatchdog();
      console.warn(`[VoiceCommander] recognition error: "${event.error}" (consecutive: ${this.consecutiveErrors + 1})`);

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.callbacks.onError?.("Microphone access denied. Please allow microphone access for this site in your browser settings.");
        this.stop();
        return;
      }

      // "no-speech" / "aborted" / "network" (and anything else) are transient —
      // retry, but with exponential backoff so a persistent failure (e.g. no
      // internet reaching the browser's speech backend) doesn't spin silently
      // forever and *look* like nothing is happening.
      this.consecutiveErrors++;
      if (this.active && !this.isSpeaking) {
        this.scheduleRestart(this.backoffDelay());
      }
      this.maybeSurfacePersistentFailure(event.error);
    };

    r.onend = () => {
      this.isRecognizing = false;
      this.clearWatchdog();
      // Only restart if user has not stopped and TTS is not playing
      if (this.active && !this.isSpeaking) {
        this.scheduleRestart(this.consecutiveErrors > 0 ? this.backoffDelay() : 150);
      }
    };

    return r;
  }

  /** Exponential backoff capped at 5s, reset whenever recognition starts cleanly. */
  private backoffDelay(): number {
    return Math.min(5000, 300 * Math.pow(1.7, this.consecutiveErrors));
  }

  /**
   * If recognition keeps failing for several seconds straight, tell the user
   * instead of retrying silently forever — this is what made the old
   * behavior look like voice "just doesn't work" with no explanation.
   */
  private maybeSurfacePersistentFailure(errorType: string) {
    if (this.consecutiveErrors < 5) return;
    const now = Date.now();
    if (now - this.lastErrorSurfacedAt < 15000) return; // don't spam repeated banners
    this.lastErrorSurfacedAt = now;

    const hint =
      errorType === "network"
        ? "Speech recognition needs an internet connection (Chrome/Edge send audio to Google's speech service) — check your connection."
        : "Speech recognition keeps failing to start. Try reloading the page, or check that no other app/tab is using the microphone.";
    this.callbacks.onError?.(`Voice recognition is having trouble (${errorType}). ${hint}`);
  }

  /**
   * Some environments (blocked mic at the OS level, a stuck browser
   * permission prompt) never fire onstart/onerror/onend at all after
   * start() — recognition just silently never begins. Detect that stall
   * and force a retry instead of hanging forever in "listening" state.
   */
  private armWatchdog() {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      if (!this.isRecognizing && this.active && !this.isSpeaking) {
        console.warn("[VoiceCommander] watchdog: recognition never started — forcing retry");
        this.consecutiveErrors++;
        this.recognition = null;
        this.startRecognition();
        this.maybeSurfacePersistentFailure("stalled");
      }
    }, 4000);
  }

  private clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private startRecognition() {
    if (this.isSpeaking || !this.active) return;
    if (this.isRecognizing) return;

    // Build a fresh recognition instance each time (avoids Chrome state bugs)
    this.recognition = this.buildRecognition();
    try {
      this.recognition.start();
      this.armWatchdog();
    } catch (err) {
      // start() throwing synchronously (e.g. "already started" InvalidStateError)
      // used to be silently ignored, which left recognition dead with no retry
      // scheduled at all — that's a likely cause of voice "just stopping" for
      // no visible reason. Treat it the same as any other failure.
      console.warn("[VoiceCommander] recognition.start() threw:", err);
      this.isRecognizing = false;
      this.consecutiveErrors++;
      if (this.active && !this.isSpeaking) {
        this.scheduleRestart(this.backoffDelay());
      }
    }
  }

  private stopRecognition() {
    this.isRecognizing = false;
    this.clearWatchdog();
    if (this.recognition) {
      try { this.recognition.abort(); } catch {}
      this.recognition = null;
    }
  }

  private scheduleRestart(delayMs: number) {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.active && !this.isSpeaking && !this.isRecognizing) {
        this.startRecognition();
      }
    }, delayMs);
  }

  // ─── TTS (GEMINI LIVE-STYLE) ─────────────────────────────────────

  speak(rawText: string): void {
    if (this.isMuted || typeof window === "undefined" || !window.speechSynthesis) return;

    // Clean text for speech — strip markdown, file paths, URLs, brackets
    let text = rawText
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/[#`_>[\]]/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[A-Z]:\\[^\s]+/gi, "")
      .replace(/\/[a-z0-9/_.-]+\.[a-z]{2,4}/gi, "")
      .trim();

    // If still multi-line (e.g. a file listing), pick just the first meaningful sentence
    if (text.split("\n").length > 2) {
      text = text.split("\n").find((l) => l.trim().length > 8) ?? "Done.";
    }

    if (!text) return;

    // ── STOP MIC BEFORE SPEAKING ──────────────────────────────────
    // This is the critical anti-loop fix: abort recognition, speak, then restart after.
    this.stopRecognition();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    window.speechSynthesis.cancel();
    this.isSpeaking = true;

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    // Voice selection: prefer Neural / Natural voices.
    // getVoices() is unreliable synchronously (it's often empty until the
    // async 'voiceschanged' event fires) — use the cache populated at
    // construction time, falling back to a live call just in case.
    const voices = this.cachedVoices.length > 0 ? this.cachedVoices : window.speechSynthesis.getVoices();
    const pick = (
      voices.find((v) => v.lang.startsWith("en") && v.name === "Google US English") ||
      voices.find((v) => v.lang.startsWith("en") && v.name === "Google UK English Female") ||
      voices.find((v) => v.lang.startsWith("en") && (v.name.includes("Natural") || v.name.includes("Online"))) ||
      voices.find((v) => v.lang.startsWith("en") && v.name.includes("Jenny")) ||
      voices.find((v) => v.lang.startsWith("en") && v.name.includes("Aria")) ||
      voices.find((v) => v.lang.startsWith("en") && v.name.includes("Guy")) ||
      voices.find((v) => v.lang.startsWith("en") && v.name.includes("Samantha")) ||
      voices.find((v) => v.lang.startsWith("en") && !v.name.includes("Desktop"))
    );
    if (pick) utter.voice = pick;

    utter.onend = () => {
      this.isSpeaking = false;
      // ── RESTART MIC AFTER SPEAKING + SAFETY BUFFER ───────────────
      // 600 ms gap guarantees TTS audio has fully cleared before mic opens.
      if (this.active) {
        this.scheduleRestart(600);
      }
    };

    utter.onerror = (e: any) => {
      console.warn("[VoiceCommander] speechSynthesis error:", e?.error || e);
      this.isSpeaking = false;
      if (this.active) this.scheduleRestart(400);
    };

    window.speechSynthesis.speak(utter);
  }

  // ─── COMMAND PROCESSOR ──────────────────────────────────────────

  processCommand(phrase: string): void {
    const t = phrase.toLowerCase().replace(/[^\w\s]/g, "").trim();

    // Orb controls — respond instantly without hitting the AI backend
    if (t.includes("zoom in") || t === "closer" || t === "magnify") {
      this.playConfirmSound(); this.callbacks.onZoomIn?.();
      this.respond("Zooming in."); return;
    }
    if (t.includes("zoom out") || t === "step back") {
      this.playConfirmSound(); this.callbacks.onZoomOut?.();
      this.respond("Zooming out."); return;
    }
    if (t.includes("rotate left") || t.includes("turn left") || t.includes("spin left")) {
      this.playConfirmSound(); this.callbacks.onRotate?.(0.65, 0);
      this.respond("Rotating left."); return;
    }
    if (t.includes("rotate right") || t.includes("turn right") || t.includes("spin right")) {
      this.playConfirmSound(); this.callbacks.onRotate?.(-0.65, 0);
      this.respond("Rotating right."); return;
    }
    if (t.includes("tilt up") || t === "look up") {
      this.playConfirmSound(); this.callbacks.onRotate?.(0, -0.45);
      this.respond("Tilting up."); return;
    }
    if (t.includes("tilt down") || t === "look down") {
      this.playConfirmSound(); this.callbacks.onRotate?.(0, 0.45);
      this.respond("Tilting down."); return;
    }
    if (t === "reset" || t.includes("recalibrate") || t.includes("center view")) {
      this.playConfirmSound(); this.callbacks.onResetView?.(); this.callbacks.onAutoSpin?.(0);
      this.respond("View reset."); return;
    }
    if (t.includes("auto spin") || t.includes("start spinning")) {
      this.playConfirmSound(); this.callbacks.onAutoSpin?.(0.015);
      this.respond("Auto spin active."); return;
    }
    if (t.includes("stop spin") || t === "freeze" || t === "halt") {
      this.playConfirmSound(); this.callbacks.onAutoSpin?.(0);
      this.respond("Rotation stopped."); return;
    }
    if (t.includes("overdrive") || t.includes("pulse") || t.includes("maximum power")) {
      this.playPulseSound(); this.callbacks.onPulse?.();
      this.respond("Energy pulse triggered."); return;
    }
    if (t.includes("crimson") || t.includes("red alert")) {
      this.playConfirmSound(); this.callbacks.onSetTheme?.("crimson");
      this.respond("Switching to Crimson."); return;
    }
    if (t.includes("protocol jarvis") || t.includes("blue mode") || (t.includes("jarvis") && !t.includes("open"))) {
      this.playConfirmSound(); this.callbacks.onSetTheme?.("jarvis");
      this.respond("Switching to Jarvis blue."); return;
    }
    if (t.includes("emerald") || t.includes("matrix mode")) {
      this.playConfirmSound(); this.callbacks.onSetTheme?.("emerald");
      this.respond("Switching to Emerald."); return;
    }
    if (t.includes("amethyst") || t.includes("purple mode")) {
      this.playConfirmSound(); this.callbacks.onSetTheme?.("amethyst");
      this.respond("Switching to Amethyst."); return;
    }
    if (t.includes("protocol ice") || t.includes("frost mode")) {
      this.playConfirmSound(); this.callbacks.onSetTheme?.("ice");
      this.respond("Switching to Ice."); return;
    }
    if ((t.includes("gold") || t.includes("amber")) && !t.includes("open")) {
      this.playConfirmSound(); this.callbacks.onSetTheme?.("gold");
      this.respond("Switching to Gold."); return;
    }
    if (t.includes("gestures on") || t.includes("gesture on") || t.includes("hand tracking on")) {
      this.playConfirmSound(); this.callbacks.onToggleGestures?.(true);
      this.respond("Hand tracking enabled."); return;
    }
    if (t.includes("gestures off") || t.includes("gesture off") || t.includes("hand tracking off")) {
      this.playConfirmSound(); this.callbacks.onToggleGestures?.(false);
      this.respond("Hand tracking disabled."); return;
    }
    if (t === "mute" || t === "silence") {
      this.isMuted = true; this.callbacks.onResponse?.("Muted."); return;
    }
    if (t === "unmute" || t.includes("voice on")) {
      this.isMuted = false; this.respond("Voice active."); return;
    }

    // Everything else → AI brain (app launch, web search, file search, WhatsApp, questions)
    this.playConfirmSound();
    this.callbacks.onAssistantDirective?.(phrase);
  }

  private respond(text: string) {
    this.callbacks.onResponse?.(text);
    this.speak(text);
  }

  // ─── WEB AUDIO ───────────────────────────────────────────────────

  private async initAudio() {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.audioCtx = new AC();
      if (this.audioCtx.state === "suspended") await this.audioCtx.resume();

      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const src = this.audioCtx.createMediaStreamSource(this.mediaStream);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 64;
        src.connect(this.analyser);
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
        this.startVisualiserLoop();
      } catch {}
    } catch {}
  }

  private startVisualiserLoop() {
    const tick = () => {
      if (!this.active) return;
      if (this.analyser && this.freqData) {
        this.analyser.getByteFrequencyData(this.freqData as any);
        let sum = 0;
        for (let i = 0; i < this.freqData.length; i++) sum += this.freqData[i];
        this.callbacks.onAudioLevel?.(Math.min(1, sum / this.freqData.length / 128), this.freqData);
      }
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopAudio() {
    if (this.animFrameId) { cancelAnimationFrame(this.animFrameId); this.animFrameId = 0; }
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  // ─── SFX ─────────────────────────────────────────────────────────

  playConfirmSound() {
    if (!this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      const g = this.audioCtx.createGain();
      g.gain.setValueAtTime(0.07, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      g.connect(this.audioCtx.destination);
      [587.33, 880].forEach((freq, i) => {
        const o = this.audioCtx!.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.connect(g);
        o.start(now + i * 0.07);
        o.stop(now + 0.15);
      });
    } catch {}
  }

  playPowerUpSound() {
    if (!this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      const o = this.audioCtx.createOscillator();
      const g = this.audioCtx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(220, now);
      o.frequency.exponentialRampToValueAtTime(660, now + 0.25);
      g.gain.setValueAtTime(0.05, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      o.connect(g); g.connect(this.audioCtx.destination);
      o.start(now); o.stop(now + 0.3);
    } catch {}
  }

  playPulseSound() {
    if (!this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      const o = this.audioCtx.createOscillator();
      const g = this.audioCtx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(240, now);
      o.frequency.exponentialRampToValueAtTime(60, now + 0.5);
      g.gain.setValueAtTime(0.18, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      o.connect(g); g.connect(this.audioCtx.destination);
      o.start(now); o.stop(now + 0.5);
    } catch {}
  }
}
