// ═══════════════════════════════════════════════════════════════════
//  CameraObjectDetector — Gemini-vision-powered "what's in my hand"
//
//  Rewritten from the ground up. The previous version ran a fully local
//  MediaPipe/EfficientDet model (fixed to ~80 generic COCO classes like
//  "cup", "bottle", "person") and never used the AI brain at all. This
//  version follows the same shape/flow as HandTracker (lib/handTracker.ts)
//  — constructor(video, overlay, callbacks), start()/stop(), a status
//  callback the UI reacts to — but instead of a local ML model, it opens
//  the camera, draws a lightweight scanning HUD, and periodically sends a
//  frame to /api/vision-scan, which asks Gemini to identify what's being
//  held up to the camera. This means detection understands *anything*
//  Gemini can recognize, not just a fixed label set.
//
//  Quota note: Gemini's free tier is extremely small (as low as ~20
//  requests/day, shared across this app's chat AND vision features). This
//  is why scanning is manual-first (one scan on open + a `scanNow()` you
//  can wire to a button or voice command) rather than a tight polling
//  loop — a naive "scan every few seconds forever" loop would exhaust the
//  entire day's Gemini budget in minutes. Continuous auto-scan is
//  supported (`setAutoScan(true)`) but opt-in and rate-limit aware.
// ═══════════════════════════════════════════════════════════════════

export type VisionState = "idle" | "scanning" | "detected" | "cooldown" | "error";

export interface VisionStatus {
  state: VisionState;
  label?: string;
  cooldownSeconds?: number;
  message?: string;
}

export interface DetectedObjectInfo {
  label: string;
  detectedAt: number;
}

export interface ObjectDetectorCallbacks {
  onStatus: (status: VisionStatus) => void;
  onObjectsDetected: (objects: DetectedObjectInfo[]) => void;
  onError?: (err: string) => void;
}

// Conservative auto-scan cadence — well under Gemini's free-tier
// requests-per-minute cap even if left running continuously.
const AUTO_SCAN_INTERVAL_MS = 20000;
const DEFAULT_COOLDOWN_SECONDS = 30;

export class CameraObjectDetector {
  private video: HTMLVideoElement;
  private overlay: HTMLCanvasElement;
  private callbacks: ObjectDetectorCallbacks;

  private stream: MediaStream | null = null;
  private running = false;
  private rafId = 0;
  private autoScanTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownInterval: ReturnType<typeof setInterval> | null = null;

  private autoScanEnabled = false;
  private scanning = false;
  private lastLabel: string | null = null;
  private scanStartedAt = 0;

  constructor(
    video: HTMLVideoElement,
    overlay: HTMLCanvasElement,
    callbacks: ObjectDetectorCallbacks
  ) {
    this.video = video;
    this.overlay = overlay;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      this.video.srcObject = this.stream;

      await new Promise<void>((resolve) => {
        if (this.video.readyState >= 2) resolve();
        else {
          this.video.onloadeddata = () => resolve();
          setTimeout(resolve, 1500);
        }
      });

      try {
        await this.video.play();
      } catch {}

      if (this.video.videoWidth) {
        this.overlay.width = this.video.videoWidth;
        this.overlay.height = this.video.videoHeight;
      }

      this.running = true;
      this.drawHudLoop();
      this.callbacks.onStatus({ state: "idle" });

      // No automatic scan on open — cloud vision quota is precious, so a
      // scan only happens on an explicit button press / voice command
      // ("what is this?"). Continuous identification should use the local
      // MediaPipe path, not this endpoint.
    } catch (err: any) {
      console.error("[CameraObjectDetector] start error:", err);
      this.stop();
      this.callbacks.onError?.(
        err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow webcam access in browser."
          : `Vision camera failed to start (${err.message || "unknown error"})`
      );
      throw err;
    }
  }

  stop(): void {
    this.running = false;
    this.autoScanEnabled = false;
    cancelAnimationFrame(this.rafId);
    if (this.autoScanTimer) {
      clearTimeout(this.autoScanTimer);
      this.autoScanTimer = null;
    }
    if (this.cooldownInterval) {
      clearInterval(this.cooldownInterval);
      this.cooldownInterval = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.lastLabel = null;

    const ctx = this.overlay.getContext("2d");
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  /** Opt into continuous scanning at a conservative, quota-aware interval. */
  setAutoScan(enabled: boolean): void {
    this.autoScanEnabled = enabled;
    if (enabled && this.running && !this.scanning) {
      this.scheduleAutoScan();
    } else if (!enabled && this.autoScanTimer) {
      clearTimeout(this.autoScanTimer);
      this.autoScanTimer = null;
    }
  }

  /** Trigger an identification pass right now (button click, voice command, or the internal auto-scan timer). */
  async scanNow(): Promise<void> {
    if (!this.running || this.scanning) return;
    this.scanning = true;
    this.scanStartedAt = Date.now();
    this.callbacks.onStatus({ state: "scanning" });

    try {
      let frame = this.captureSnapshot();
      if (!frame) {
        await new Promise((r) => setTimeout(r, 400));
        frame = this.captureSnapshot();
      }
      if (!frame) {
        this.callbacks.onStatus({ state: "idle" });
        return;
      }

      const res = await fetch("/api/vision-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: frame }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "rate_limited") {
          this.enterCooldown(data.retryAfterSeconds || DEFAULT_COOLDOWN_SECONDS);
          return;
        }
        throw new Error(data.message || `Vision scan failed (${res.status})`);
      }

      if (data.detected && data.label) {
        this.lastLabel = data.label;
        this.callbacks.onStatus({ state: "detected", label: data.label });
        this.callbacks.onObjectsDetected([{ label: data.label, detectedAt: Date.now() }]);
      } else {
        this.lastLabel = null;
        this.callbacks.onStatus({ state: "idle" });
        this.callbacks.onObjectsDetected([]);
      }
    } catch (err: any) {
      console.warn("[CameraObjectDetector] scan error:", err);
      this.callbacks.onStatus({ state: "error", message: err.message || "Vision scan failed" });
      this.callbacks.onError?.(err.message || "Vision scan failed");
    } finally {
      this.scanning = false;
      if (this.autoScanEnabled) this.scheduleAutoScan();
    }
  }

  private scheduleAutoScan(): void {
    if (this.autoScanTimer) clearTimeout(this.autoScanTimer);
    this.autoScanTimer = setTimeout(() => {
      if (this.autoScanEnabled && this.running) void this.scanNow();
    }, AUTO_SCAN_INTERVAL_MS);
  }

  private enterCooldown(seconds: number): void {
    if (this.cooldownInterval) clearInterval(this.cooldownInterval);
    let remaining = seconds;
    this.callbacks.onStatus({ state: "cooldown", cooldownSeconds: remaining });
    this.cooldownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(this.cooldownInterval!);
        this.cooldownInterval = null;
        this.callbacks.onStatus({ state: "idle" });
        if (this.autoScanEnabled) this.scheduleAutoScan();
      } else {
        this.callbacks.onStatus({ state: "cooldown", cooldownSeconds: remaining });
      }
    }, 1000);
  }

  /** Grabs the current frame as a base64 JPEG — used for scans and for attaching a frame to a manual chat message. */
  captureSnapshot(): string | null {
    if (!this.video || !this.video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(this.video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  /** Pure-visual scanning HUD — corner brackets + a sweeping scan line — no ML inference involved. */
  private drawHudLoop = (): void => {
    if (!this.running) return;
    const ctx = this.overlay.getContext("2d");
    if (ctx) {
      const w = this.overlay.width;
      const h = this.overlay.height;
      ctx.clearRect(0, 0, w, h);

      const isActive = this.scanning;
      const color = isActive ? "rgba(0, 255, 200, 0.9)" : "rgba(0, 212, 255, 0.6)";
      const inset = 14;
      const cornerLen = 22;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      const corners: [number, number, number, number][] = [
        [inset, inset, 1, 1],
        [w - inset, inset, -1, 1],
        [inset, h - inset, 1, -1],
        [w - inset, h - inset, -1, -1],
      ];
      for (const [x, y, dx, dy] of corners) {
        ctx.beginPath();
        ctx.moveTo(x, y + cornerLen * dy);
        ctx.lineTo(x, y);
        ctx.lineTo(x + cornerLen * dx, y);
        ctx.stroke();
      }

      if (isActive) {
        const t = (Date.now() - this.scanStartedAt) % 1400;
        const sweepY = inset + (h - inset * 2) * (t / 1400);
        ctx.strokeStyle = "rgba(0, 255, 200, 0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(inset, sweepY);
        ctx.lineTo(w - inset, sweepY);
        ctx.stroke();
      } else if (this.lastLabel) {
        ctx.font = "bold 11px 'Courier New', monospace";
        const text = this.lastLabel.toUpperCase();
        const metrics = ctx.measureText(text);
        const tagW = metrics.width + 10;
        ctx.fillStyle = "rgba(0, 20, 15, 0.8)";
        ctx.fillRect(inset, h - inset - 18, tagW, 18);
        ctx.fillStyle = "#00ffc8";
        ctx.fillText(text, inset + 5, h - inset - 5);
      }
    }
    this.rafId = requestAnimationFrame(this.drawHudLoop);
  };
}
