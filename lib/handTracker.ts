import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Landmark indices (MediaPipe hand model)
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;
const MIDDLE_MCP = 9;

// Pinch hysteresis: thumb–index distance relative to hand size
const PINCH_ON = 0.42;
const PINCH_OFF = 0.58;

const ROTATE_SPEED = 6.0;
const SMOOTHING = 0.4;

export type GestureMode =
  | "idle"
  | "spin"
  | "zoom"
  | "thumbs_up"
  | "thumbs_down"
  | "palm"
  | "fist"
  | "point"
  | "peace"
  | "three"
  | "swipe_left"
  | "swipe_right";

export interface TrackerStatus {
  hands: number;
  mode: GestureMode;
}

export interface HandTrackerCallbacks {
  /** Called when a single pinched hand drags: deltas in mirrored normalized coords. */
  onRotate(deltaTheta: number, deltaPhi: number): void;
  /** Called when both hands pinch and spread/close: multiply camera distance by factor. */
  onZoom(factor: number): void;
  onStatus(status: TrackerStatus): void;
  /** Phase 7: Hands-free confirmations and controls */
  onConfirm?(): void;
  onDeny?(): void;
  onMuteToggle?(): void;
  onEmergencyStop?(): void;
  /** Expanded vocabulary (Phase 7+) */
  onPoint?(): void;        // ☝️ index only — zoom in / focus
  onPeace?(): void;        // ✌️ index + middle — cycle theme
  onThree?(): void;        // 🤟 three fingers — toggle auto-spin
  onSwipe?(dir: "left" | "right"): void; // open-hand fast horizontal sweep — rotate
}

interface Point {
  x: number;
  y: number;
}

interface HandState {
  pinching: boolean;
  grab: Point;
}

export class HandTracker {
  private video: HTMLVideoElement;
  private overlay: HTMLCanvasElement;
  private callbacks: HandTrackerCallbacks;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private running = false;
  private lastVideoTime = -1;

  private handStates = new Map<string, HandState>();
  private prevMode: GestureMode = "idle";
  private prevSpinGrab: Point | null = null;
  private prevZoomDist: number | null = null;
  private lastStatus: TrackerStatus = { hands: 0, mode: "idle" };

  // Gesture hold timers to avoid twitch triggers
  private gestureHoldTimer = 0;
  private activeSpecialGesture: string | null = null;
  private swipeSample: { x: number; t: number } | null = null;
  private lastSwipeAt = 0;

  constructor(
    video: HTMLVideoElement,
    overlay: HTMLCanvasElement,
    callbacks: HandTrackerCallbacks,
  ) {
    this.video = video;
    this.overlay = overlay;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
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

    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" as const },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" as const },
      });
    }

    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.landmarker?.close();
    this.landmarker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.handStates.clear();
    this.prevMode = "idle";
    this.prevSpinGrab = null;
    this.prevZoomDist = null;
    const ctx = this.overlay.getContext("2d");
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.emitStatus({ hands: 0, mode: "idle" });
  }

  private loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    this.processHands(result.landmarks, result.handedness.map((h) => h[0]?.categoryName ?? "?"));
    this.drawOverlay(result.landmarks);
  };

  private processHands(
    landmarks: NormalizedLandmark[][],
    labels: string[],
  ): void {
    const pinchedGrabs: Point[] = [];
    const seen = new Set<string>();
    let detectedSpecialGesture: GestureMode | null = null;

    landmarks.forEach((lm, i) => {
      const label = labels[i];
      seen.add(label);

      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      if (handScale < 1e-6) return;
      const pinchRatio = dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / handScale;

      const raw: Point = {
        x: 1 - (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2,
        y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2,
      };

      let state = this.handStates.get(label);
      if (!state) {
        state = { pinching: false, grab: raw };
        this.handStates.set(label, state);
      }

      if (state.pinching && pinchRatio > PINCH_OFF) state.pinching = false;
      else if (!state.pinching && pinchRatio < PINCH_ON) state.pinching = true;

      state.grab = {
        x: state.grab.x + (raw.x - state.grab.x) * SMOOTHING,
        y: state.grab.y + (raw.y - state.grab.y) * SMOOTHING,
      };

      if (state.pinching) pinchedGrabs.push(state.grab);

      // Phase 7+: single-hand static gesture vocabulary
      if (!state.pinching && landmarks.length === 1) {
        const dIndex = dist2d(lm[INDEX_TIP], lm[WRIST]);
        const dMiddle = dist2d(lm[MIDDLE_TIP], lm[WRIST]);
        const dRing = dist2d(lm[RING_TIP], lm[WRIST]);
        const dPinky = dist2d(lm[PINKY_TIP], lm[WRIST]);

        // Per-finger "extended" (tip clearly further from wrist than the knuckle span).
        const idxUp = dIndex > handScale * 1.55;
        const midUp = dMiddle > handScale * 1.7;
        const ringUp = dRing > handScale * 1.55;
        const pinkyUp = dPinky > handScale * 1.35;
        const extendedCount = [idxUp, midUp, ringUp, pinkyUp].filter(Boolean).length;

        const fingersCurled = dIndex < handScale * 1.15 && dMiddle < handScale * 1.15 && dRing < handScale * 1.15;
        const fingersOpen = extendedCount >= 4;

        const isThumbUp = fingersCurled && lm[THUMB_TIP].y < lm[WRIST].y - handScale * 0.25;
        const isThumbDown = fingersCurled && lm[THUMB_TIP].y > lm[WRIST].y + handScale * 0.25;
        const isFist = dIndex < handScale * 0.85 && dMiddle < handScale * 0.85 && dRing < handScale * 0.85 && dPinky < handScale * 0.85;
        const isPalm = fingersOpen;
        const isPoint = idxUp && !midUp && !ringUp && !pinkyUp;
        const isPeace = idxUp && midUp && !ringUp && !pinkyUp;
        const isThree = idxUp && midUp && ringUp && !pinkyUp;

        if (isThumbUp) detectedSpecialGesture = "thumbs_up";
        else if (isThumbDown) detectedSpecialGesture = "thumbs_down";
        else if (isFist) detectedSpecialGesture = "fist";
        else if (isPoint) detectedSpecialGesture = "point";
        else if (isPeace) detectedSpecialGesture = "peace";
        else if (isThree) detectedSpecialGesture = "three";
        else if (isPalm) detectedSpecialGesture = "palm";

        // Open-palm horizontal swipe → rotate. Tracks wrist x velocity.
        if (isPalm) {
          const now = performance.now();
          const wx = 1 - lm[WRIST].x; // mirrored
          if (this.swipeSample && now - this.swipeSample.t < 250) {
            const dx = wx - this.swipeSample.x;
            if (Math.abs(dx) > 0.16 && now - this.lastSwipeAt > 700) {
              this.lastSwipeAt = now;
              this.callbacks.onSwipe?.(dx > 0 ? "right" : "left");
              detectedSpecialGesture = dx > 0 ? "swipe_right" : "swipe_left";
            }
          }
          this.swipeSample = { x: wx, t: now };
        } else {
          this.swipeSample = null;
        }
      }
    });

    for (const key of this.handStates.keys()) {
      if (!seen.has(key)) this.handStates.delete(key);
    }

    let mode: GestureMode =
      pinchedGrabs.length >= 2 ? "zoom" : pinchedGrabs.length === 1 ? "spin" : "idle";

    if (mode === "idle" && detectedSpecialGesture) {
      mode = detectedSpecialGesture;

      // Handle gesture hold
      if (this.activeSpecialGesture === detectedSpecialGesture) {
        this.gestureHoldTimer += 16;
        const holdMs =
          detectedSpecialGesture === "point" || detectedSpecialGesture === "peace" || detectedSpecialGesture === "three"
            ? 500
            : 600;
        if (this.gestureHoldTimer > holdMs) {
          this.gestureHoldTimer = -100000; // one-shot: block re-fire until gesture released
          if (detectedSpecialGesture === "thumbs_up") this.callbacks.onConfirm?.();
          else if (detectedSpecialGesture === "thumbs_down") this.callbacks.onDeny?.();
          else if (detectedSpecialGesture === "palm") this.callbacks.onMuteToggle?.();
          else if (detectedSpecialGesture === "fist") this.callbacks.onEmergencyStop?.();
          else if (detectedSpecialGesture === "point") this.callbacks.onPoint?.();
          else if (detectedSpecialGesture === "peace") this.callbacks.onPeace?.();
          else if (detectedSpecialGesture === "three") this.callbacks.onThree?.();
        }
      } else {
        this.activeSpecialGesture = detectedSpecialGesture;
        this.gestureHoldTimer = 0;
      }
    } else {
      this.activeSpecialGesture = null;
      this.gestureHoldTimer = 0;
    }

    if (mode !== this.prevMode) {
      this.prevSpinGrab = null;
      this.prevZoomDist = null;
      this.prevMode = mode;
    }

    if (mode === "spin") {
      const grab = pinchedGrabs[0];
      if (this.prevSpinGrab) {
        const dx = grab.x - this.prevSpinGrab.x;
        const dy = grab.y - this.prevSpinGrab.y;
        if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
          this.callbacks.onRotate(dx * ROTATE_SPEED, dy * ROTATE_SPEED);
        }
      }
      this.prevSpinGrab = grab;
    } else if (mode === "zoom") {
      const d = Math.hypot(
        pinchedGrabs[0].x - pinchedGrabs[1].x,
        pinchedGrabs[0].y - pinchedGrabs[1].y,
      );
      if (this.prevZoomDist && d > 1e-4) {
        const factor = Math.min(1.18, Math.max(0.85, this.prevZoomDist / d));
        this.callbacks.onZoom(factor);
      }
      this.prevZoomDist = d;
    }

    this.emitStatus({ hands: landmarks.length, mode });
  }

  private emitStatus(status: TrackerStatus): void {
    if (
      status.hands === this.lastStatus.hands &&
      status.mode === this.lastStatus.mode
    ) {
      return;
    }
    this.lastStatus = status;
    this.callbacks.onStatus(status);
  }

  private drawOverlay(landmarks: NormalizedLandmark[][]): void {
    const ctx = this.overlay.getContext("2d");
    if (!ctx) return;
    const w = this.overlay.width;
    const h = this.overlay.height;
    ctx.clearRect(0, 0, w, h);

    landmarks.forEach((hand) => {
      const mx = (lm: NormalizedLandmark) => (1 - lm.x) * w;
      const my = (lm: NormalizedLandmark) => lm.y * h;

      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0, 212, 255, 0.4)";
      const CONNECTIONS = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [5, 9], [9, 10], [10, 11], [11, 12],
        [9, 13], [13, 14], [14, 15], [15, 16],
        [13, 17], [17, 18], [18, 19], [19, 20],
        [0, 17],
      ];
      CONNECTIONS.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(mx(hand[a]), my(hand[a]));
        ctx.lineTo(mx(hand[b]), my(hand[b]));
        ctx.stroke();
      });

      hand.forEach((lm, idx) => {
        const isTip = [4, 8, 12, 16, 20].includes(idx);
        ctx.beginPath();
        ctx.arc(mx(lm), my(lm), isTip ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isTip ? "#ffaa30" : "#00d4ff";
        ctx.fill();
      });
    });
  }
}

function dist2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
