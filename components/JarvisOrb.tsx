"use client";

import "@/app/globals.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneApi, type EmotionState } from "@/lib/orbScene";
import { HandTracker, type TrackerStatus } from "@/lib/handTracker";
import {
  CameraObjectDetector,
  type DetectedObjectInfo,
  type VisionStatus,
} from "@/lib/objectDetector";
import {
  VoiceCommander,
  VOICE_THEMES,
  type VoiceTheme,
} from "@/lib/voiceCommander";
import type { Contact } from "@/lib/tools/contacts";

type CameraMode = "off" | "gestures" | "vision";

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
  thumbs_up: "CONFIRM (YES 👍)",
  thumbs_down: "CANCEL (NO 👎)",
  palm: "MUTE TOGGLE 🖐️",
  fist: "STOP ✊",
  point: "FOCUS / ZOOM ☝️",
  peace: "CYCLE THEME ✌️",
  three: "AUTO-SPIN 🤟",
  swipe_left: "ROTATE ◀ SWIPE",
  swipe_right: "ROTATE ▶ SWIPE",
};

const VISION_STATE_LABEL: Record<VisionStatus["state"], string> = {
  idle: "READY",
  scanning: "SCANNING…",
  detected: "DETECTED",
  cooldown: "QUOTA COOLDOWN",
  error: "ERROR",
};

interface PendingConfirmation {
  tool: string;
  args: any;
  description: string;
  prompt: string;
}

export default function JarvisOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const objectDetectorRef = useRef<CameraObjectDetector | null>(null);
  const voiceRef = useRef<VoiceCommander | null>(null);

  // Core States
  const [cameraMode, setCameraMode] = useState<CameraMode>("off");
  const [cameraStatus, setCameraStatus] = useState<TrackerStatus>({
    hands: 0,
    mode: "idle",
  });
  const [detectedObjects, setDetectedObjects] = useState<string[]>([]);
  const [visionStatus, setVisionStatus] = useState<VisionStatus>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);

  // Chat & AI Assistant States
  const [inputQuery, setInputQuery] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "model"; text: string }[]>([]);
  const [lastToolAction, setLastToolAction] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [currentEmotion, setCurrentEmotion] = useState<EmotionState>("idle");

  // Voice States
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<{ text: string; isFinal: boolean }>({
    text: "Type below or speak a directive",
    isFinal: true,
  });
  const [agentResponse, setAgentResponse] = useState<string>(
    "Hello! All systems are online. How can I help you today?",
  );
  const [audioBars, setAudioBars] = useState<number[]>([4, 6, 8, 5, 10, 7, 4, 3]);
  const [currentTheme, setCurrentTheme] = useState<VoiceTheme>("gold");

  // Modals & Configuration
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactRel, setNewContactRel] = useState("");

  // Load Contacts on mount
  useEffect(() => {
    fetch("/api/contacts")
      .then((res) => res.json())
      .then((data) => {
        if (data.contacts) setContacts(data.contacts);
      })
      .catch(console.error);
  }, []);

  const handleAddContact = async () => {
    if (!newContactName.trim() || !newContactPhone.trim()) return;
    const updated = [
      ...contacts,
      {
        name: newContactName.trim(),
        phone: newContactPhone.trim(),
        relationship: newContactRel.trim() || undefined,
      },
    ];
    setContacts(updated);
    setNewContactName("");
    setNewContactPhone("");
    setNewContactRel("");

    await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: updated }),
    });
  };

  const handleDeleteContact = async (index: number) => {
    const updated = contacts.filter((_, i) => i !== index);
    setContacts(updated);
    await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: updated }),
    });
  };

  // Apply Theme CSS variables to DOM
  const applyTheme = useCallback((themeKey: VoiceTheme) => {
    const config = VOICE_THEMES[themeKey] || VOICE_THEMES.gold;
    setCurrentTheme(themeKey);
    sceneRef.current?.setTheme(config);

    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.style.setProperty("--theme-primary", config.primary);
      root.style.setProperty("--theme-bright", config.bright);
      root.style.setProperty("--theme-dim", config.dim);
      root.style.setProperty("--theme-glow", config.glow);
      root.style.setProperty(
        "--theme-bg-tint",
        `rgba(${parseInt(config.primary.slice(1, 3), 16)}, ${parseInt(
          config.primary.slice(3, 5),
          16,
        )}, ${parseInt(config.primary.slice(5, 7), 16)}, 0.25)`,
      );
      root.style.setProperty(
        "--theme-border",
        `rgba(${parseInt(config.primary.slice(1, 3), 16)}, ${parseInt(
          config.primary.slice(3, 5),
          16,
        )}, ${parseInt(config.primary.slice(5, 7), 16)}, 0.45)`,
      );
    }
  }, []);

  // Cycle to next available theme
  const cycleTheme = useCallback(() => {
    const keys = Object.keys(VOICE_THEMES) as VoiceTheme[];
    const nextIndex = (keys.indexOf(currentTheme) + 1) % keys.length;
    const nextTheme = keys[nextIndex];
    applyTheme(nextTheme);
    setAgentResponse(`Holographic protocol changed to ${VOICE_THEMES[nextTheme].name}.`);
  }, [applyTheme, currentTheme]);

  // Update Assistant Emotion State
  const updateEmotion = useCallback((state: EmotionState) => {
    setCurrentEmotion(state);
    sceneRef.current?.setEmotionState(state);
  }, []);

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = createOrbScene(container);
    sceneRef.current = scene;

    return () => {
      voiceRef.current?.stop();
      voiceRef.current = null;
      trackerRef.current?.stop();
      trackerRef.current = null;
      objectDetectorRef.current?.stop();
      objectDetectorRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Stop any active camera streams & models
  const stopCamera = useCallback(() => {
    if (trackerRef.current) {
      trackerRef.current.stop();
      trackerRef.current = null;
    }
    if (objectDetectorRef.current) {
      objectDetectorRef.current.stop();
      objectDetectorRef.current = null;
    }
    setCameraMode("off");
    setCameraStatus({ hands: 0, mode: "idle" });
    setDetectedObjects([]);
    setVisionStatus({ state: "idle" });
  }, []);

  // Confirmation Execution Handler
  const handleConfirmAction = useCallback(async (confirmed: boolean) => {
    if (!pendingConfirmation) return;
    const action = pendingConfirmation;
    setPendingConfirmation(null);

    if (!confirmed) {
      setAgentResponse("Action cancelled.");
      voiceRef.current?.speak("Action cancelled.");
      updateEmotion("idle");
      return;
    }

    setIsProcessing(true);
    updateEmotion("executing");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmedAction: action,
        }),
      });
      const data = await res.json();
      setAgentResponse(data.response || "Executed.");
      if (voiceRef.current && !isMuted) {
        voiceRef.current.speak(data.spokenResponse || data.response);
      }
      updateEmotion("success");
    } catch (err: any) {
      setAgentResponse(`Execution failed: ${err.message || String(err)}`);
      updateEmotion("error");
    } finally {
      setIsProcessing(false);
    }
  }, [isMuted, pendingConfirmation, updateEmotion]);

  const pendingConfirmationRef = useRef(pendingConfirmation);
  pendingConfirmationRef.current = pendingConfirmation;

  // Stable refs for gesture callbacks (avoid re-creating the tracker on
  // every theme/spin state change).
  const cycleThemeRef = useRef(cycleTheme);
  cycleThemeRef.current = cycleTheme;
  const autoSpinOnRef = useRef(false);

  // Start Gestures (Hand Tracking)
  const startGestures = useCallback(async () => {
    stopCamera();
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;

    setError(null);
    setCameraMode("gestures");

    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) => sceneRef.current?.rotateBy(dt, dp),
      onZoom: (factor) => sceneRef.current?.zoomBy(factor),
      onStatus: setCameraStatus,
      onConfirm: () => {
        if (pendingConfirmationRef.current) {
          void handleConfirmAction(true);
        }
      },
      onDeny: () => {
        if (pendingConfirmationRef.current) {
          void handleConfirmAction(false);
        }
      },
      onMuteToggle: () => {
        if (voiceRef.current) {
          const m = voiceRef.current.toggleMute();
          setIsMuted(m);
        }
      },
      onEmergencyStop: () => {
        sceneRef.current?.setAutoSpin(0);
        if (pendingConfirmationRef.current) {
          void handleConfirmAction(false);
        }
      },
      onPoint: () => {
        sceneRef.current?.zoomIn();
        sceneRef.current?.triggerPulse();
      },
      onPeace: () => cycleThemeRef.current(),
      onThree: () => {
        autoSpinOnRef.current = !autoSpinOnRef.current;
        sceneRef.current?.setAutoSpin(autoSpinOnRef.current ? 0.015 : 0);
      },
      onSwipe: (dir) => {
        sceneRef.current?.rotateBy(dir === "right" ? 0.6 : -0.6, 0);
      },
    });
    trackerRef.current = tracker;

    try {
      await tracker.start();
    } catch (err: any) {
      trackerRef.current = null;
      tracker.stop();
      setCameraMode("off");
      setError(
        err?.name === "NotAllowedError"
          ? "Webcam access denied. Please click the camera icon in Chrome's address bar to allow permissions."
          : `Gesture tracker failed: ${err?.message || "Check webcam connection"}`,
      );
    }
  }, [handleConfirmAction, stopCamera]);

  // Start Vision (Object Detection)
  const startObjectDetection = useCallback(async () => {
    stopCamera();
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;

    setError(null);
    setCameraMode("vision");

    const detector = new CameraObjectDetector(video, overlay, {
      onStatus: (status: VisionStatus) => {
        setVisionStatus(status);
        if (status.state === "detected" && status.label) {
          setAgentResponse(`I can see: ${status.label}`);
          voiceRef.current?.speak(`That looks like ${status.label}.`);
          updateEmotion("success");
        } else if (status.state === "scanning") {
          updateEmotion("thinking");
        } else if (status.state === "cooldown") {
          setAgentResponse(`Vision quota cooling down — retrying in ${status.cooldownSeconds}s.`);
        } else if (status.state === "error") {
          updateEmotion("error");
        }
      },
      onObjectsDetected: (objs: DetectedObjectInfo[]) => {
        const unique = Array.from(new Set(objs.map((o) => o.label)));
        setDetectedObjects(unique);
      },
      onError: (err) => setError(err),
    });
    objectDetectorRef.current = detector;

    try {
      await detector.start();
    } catch (err: any) {
      objectDetectorRef.current = null;
      detector.stop();
      setCameraMode("off");
      setError(
        err?.name === "NotAllowedError"
          ? "Webcam access denied. Please click the camera icon in Chrome's address bar to allow permissions."
          : `Vision detector failed: ${err?.message || "Check webcam connection"}`,
      );
    }
  }, [stopCamera, updateEmotion]);

  const scanForObject = useCallback(() => {
    void objectDetectorRef.current?.scanNow();
  }, []);

  const toggleCameraMode = useCallback(
    (targetMode?: CameraMode) => {
      if (targetMode === "gestures") {
        if (cameraMode === "gestures") stopCamera();
        else void startGestures();
      } else if (targetMode === "vision") {
        if (cameraMode === "vision") stopCamera();
        else void startObjectDetection();
      } else {
        if (cameraMode === "off") void startObjectDetection();
        else stopCamera();
      }
    },
    [cameraMode, startGestures, startObjectDetection, stopCamera],
  );

  const triggerOverdrive = useCallback(() => {
    voiceRef.current?.playPulseSound();
    sceneRef.current?.triggerPulse();
    updateEmotion("greeting");
    setAgentResponse("Overdrive surge activated.");
  }, [updateEmotion]);

  // AI Assistant Query Dispatcher
  const sendAssistantMessage = useCallback(
    async (userText: string) => {
      if (!userText.trim() || isProcessing) return;

      const cleanQuery = userText.trim();

      // Check if answering a pending confirmation via speech
      if (pendingConfirmationRef.current) {
        const lower = cleanQuery.toLowerCase();
        if (lower.includes("yes") || lower.includes("confirm") || lower.includes("proceed") || lower.includes("do it")) {
          void handleConfirmAction(true);
          return;
        } else if (lower.includes("no") || lower.includes("cancel") || lower.includes("abort") || lower.includes("stop")) {
          void handleConfirmAction(false);
          return;
        }
      }

      // "What is this" / "what am I holding" while Vision mode is active
      // triggers a fresh Gemini scan directly (cheaper + more accurate than
      // routing through the full chat brain, and avoids reporting a stale
      // cached label from whenever the camera last scanned).
      if (cameraMode === "vision" && objectDetectorRef.current) {
        const lower = cleanQuery.toLowerCase();
        const isScanPhrase = /what('?s| is) (this|that|i'?m holding|in my hand)|what do you see|scan (this|it|object)|identify (this|that)/.test(lower);
        if (isScanPhrase) {
          setTranscript({ text: cleanQuery, isFinal: true });
          scanForObject();
          return;
        }
      }

      setIsProcessing(true);
      updateEmotion("thinking");
      setTranscript({ text: cleanQuery, isFinal: true });
      setAgentResponse("Processing query & executing directives…");
      setLastToolAction(null);

      let snapshotBase64: string | undefined = undefined;
      if (objectDetectorRef.current) {
        const snap = objectDetectorRef.current.captureSnapshot();
        if (snap) snapshotBase64 = snap;
      }

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: cleanQuery,
            history: chatHistory,
            imageBase64: snapshotBase64,
            detectedObjects: detectedObjects,
          }),
        });

        const data = await res.json();
        const reply = data.response || "Done.";
        const spokenText = data.spokenResponse || reply;
        setAgentResponse(reply);

        if (data.confirmationRequired) {
          setPendingConfirmation(data.confirmationRequired);
          updateEmotion("confirm_pending");
        } else {
          updateEmotion("speaking");
        }

        setChatHistory((prev) => [
          ...prev,
          { role: "user", text: cleanQuery },
          { role: "model", text: reply },
        ]);

        if (voiceRef.current && !isMuted) {
          voiceRef.current.speak(spokenText);
        }

        if (data.toolsExecuted && data.toolsExecuted.length > 0) {
          const names = data.toolsExecuted.map((t: any) => t.tool).join(", ");
          setLastToolAction(`Executed: ${names}`);
        }

        if (data.uiActions && Array.isArray(data.uiActions)) {
          for (const act of data.uiActions) {
            if (act.action === "set_theme" && act.theme) {
              applyTheme(act.theme as VoiceTheme);
            } else if (act.action === "set_emotion" && act.emotion) {
              updateEmotion(act.emotion as EmotionState);
            } else if (act.action === "pulse") {
              sceneRef.current?.triggerPulse();
            } else if (act.action === "auto_spin") {
              sceneRef.current?.setAutoSpin(0.015);
            } else if (act.action === "stop_spin") {
              sceneRef.current?.setAutoSpin(0);
            } else if (act.action === "zoom_in") {
              sceneRef.current?.zoomIn();
            } else if (act.action === "zoom_out") {
              sceneRef.current?.zoomOut();
            } else if (act.action === "reset") {
              sceneRef.current?.resetView();
            } else if (act.action === "toggle_camera") {
              toggleCameraMode("vision");
            }
          }
        }
      } catch (err: any) {
        setAgentResponse(`Communication failure: ${err.message || String(err)}`);
        updateEmotion("error");
      } finally {
        setIsProcessing(false);
      }
    },
    [
      applyTheme,
      cameraMode,
      chatHistory,
      detectedObjects,
      handleConfirmAction,
      isMuted,
      isProcessing,
      scanForObject,
      toggleCameraMode,
      updateEmotion,
    ],
  );

  const sendAssistantMessageRef = useRef(sendAssistantMessage);
  sendAssistantMessageRef.current = sendAssistantMessage;

  // Voice Recognition Handler
  const toggleVoice = useCallback(async () => {
    if (voiceRef.current?.getIsListening()) {
      voiceRef.current.stop();
      voiceRef.current = null;
      setIsVoiceActive(false);
      setAgentResponse("Voice paused. Click the mic to resume.");
      updateEmotion("idle");
      return;
    }

    voiceRef.current?.stop();
    voiceRef.current = new VoiceCommander({
      onRotate: (dt, dp) => sceneRef.current?.rotateBy(dt, dp),
      onZoomIn: () => sceneRef.current?.zoomIn(),
      onZoomOut: () => sceneRef.current?.zoomOut(),
      onResetView: () => sceneRef.current?.resetView(),
      onAutoSpin: (spd) => sceneRef.current?.setAutoSpin(spd),
      onToggleGestures: (enable) => toggleCameraMode(enable ? "gestures" : "off"),
      onSetTheme: (theme) => applyTheme(theme),
      onPulse: () => sceneRef.current?.triggerPulse(),
      onTranscript: (text, isFinal) => setTranscript({ text, isFinal }),
      onAssistantDirective: (phrase) => { void sendAssistantMessageRef.current(phrase); },
      onResponse: (reply) => setAgentResponse(reply),
      onError: (err) => setError(err),
      onListeningChange: (listening) => {
        setIsVoiceActive(listening);
        updateEmotion(listening ? "listening" : "idle");
      },
      onAudioLevel: (normalized, freq) => {
        // Pass amplitude to 3D orb core reactive animation (Phase 5)
        sceneRef.current?.setAudioAmplitude(normalized);

        const bars: number[] = [];
        const step = Math.max(1, Math.floor(freq.length / 8));
        for (let i = 0; i < 8; i++) {
          bars.push(Math.max(3, Math.floor(((freq[i * step] || 0) / 255) * 16)));
        }
        setAudioBars(bars);
      },
    });

    try {
      await voiceRef.current.start();
      setIsVoiceActive(true);
      updateEmotion("listening");
    } catch (e: any) {
      setError(e.message || "VOICE INIT FAILED — use Chrome or Edge");
    }
  }, [applyTheme, toggleCameraMode, updateEmotion]);

  const toggleMute = useCallback(() => {
    if (voiceRef.current) {
      const muted = voiceRef.current.toggleMute();
      setIsMuted(muted);
    }
  }, []);

  const sendQuickCommand = useCallback(
    (cmd: string) => {
      const clean = cmd.toLowerCase();
      if (clean === "zoom in") sceneRef.current?.zoomIn();
      else if (clean === "zoom out") sceneRef.current?.zoomOut();
      else if (clean === "reset") sceneRef.current?.resetView();
      else if (clean === "overdrive") triggerOverdrive();
      else if (clean === "crimson") applyTheme("crimson");
      else if (clean === "jarvis") applyTheme("jarvis");
      else if (clean === "gold") applyTheme("gold");
      else if (clean === "emerald") applyTheme("emerald");
      else if (clean === "amethyst") applyTheme("amethyst");
      else if (clean === "ice") applyTheme("ice");
      else if (clean === "theme" || clean === "color") cycleTheme();
      else if (clean === "auto spin") sceneRef.current?.setAutoSpin(0.01);
      else if (clean === "stop spin") sceneRef.current?.setAutoSpin(0);
      else if (clean === "help") setShowHelp(true);
      else if (clean === "diagnostics") {
        void sendAssistantMessage("System diagnostics telemetry");
      } else {
        void sendAssistantMessage(cmd);
      }
    },
    [applyTheme, cycleTheme, sendAssistantMessage, triggerOverdrive],
  );

  // Keyboard Shortcuts (Stabilized with ref & input guards)
  const keyHandlerRef = useRef({
    toggleCameraMode,
    toggleVoice,
    toggleMute,
    triggerOverdrive,
    cycleTheme,
    handleConfirmAction,
    pendingConfirmation,
  });
  keyHandlerRef.current = {
    toggleCameraMode,
    toggleVoice,
    toggleMute,
    triggerOverdrive,
    cycleTheme,
    handleConfirmAction,
    pendingConfirmation,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable ||
        target?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      const h = keyHandlerRef.current;
      switch (e.key) {
        case "+":
        case "=":
          sceneRef.current?.zoomIn();
          break;
        case "-":
        case "_":
          sceneRef.current?.zoomOut();
          break;
        case "r":
        case "R":
          sceneRef.current?.resetView();
          break;
        case "g":
        case "G":
          h.toggleCameraMode("gestures");
          break;
        case "o":
        case "O":
          h.toggleCameraMode("vision");
          break;
        case "t":
        case "T":
        case "c":
        case "C":
          h.cycleTheme();
          break;
        case "v":
        case "V":
          void h.toggleVoice();
          break;
        case "m":
        case "M":
          h.toggleMute();
          break;
        case " ":
          e.preventDefault();
          h.triggerOverdrive();
          break;
        case "Escape":
          if (h.pendingConfirmation) {
            void h.handleConfirmAction(false);
          }
          setShowHelp(false);
          setShowSettings(false);
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputQuery.trim()) return;
    const q = inputQuery;
    setInputQuery("");
    void sendAssistantMessage(q);
  };

  return (
    <>
      <div id="canvas-container" ref={containerRef} />

      {/* Camera Video & Bounding Box HUD Overlay */}
      <video
        ref={videoRef}
        id="webcam-video"
        playsInline
        muted
        style={{ display: cameraMode === "off" ? "none" : "block" }}
      />
      <canvas
        ref={overlayRef}
        id="camera-overlay-canvas"
        width={640}
        height={480}
        style={{ display: cameraMode === "off" ? "none" : "block" }}
      />

      {/* Top Telemetry & Status Bar */}
      <header className="hud-top-bar">
        <div className="hud-brand">
          <div className="hud-pulse-dot" />
          <div className="hud-title-group">
            <span className="hud-title">U.L.T.R.O.N.</span>
            <span className="hud-subtitle">PERSONAL AI DESKTOP ASSISTANT</span>
          </div>
        </div>

        <div className="hud-center-status">
          <span className="hud-badge status-active">CORE ACTIVE</span>
          <button
            type="button"
            className="hud-badge theme-badge"
            onClick={cycleTheme}
            title="Click to switch Orb Color Theme (T / C)"
            style={{
              background: "transparent",
              cursor: "pointer",
              border: "1px solid var(--theme-border)",
              fontFamily: "inherit",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            🎨 {VOICE_THEMES[currentTheme]?.name || "PROTOCOL GOLD"}
          </button>
          <span className="hud-badge" style={{ color: "var(--theme-bright)" }}>
            EMOTION: {currentEmotion.toUpperCase()}
          </span>
          {cameraMode === "gestures" && (
            <span className="hud-badge camera-badge">
              CAM: GESTURES | {cameraStatus.hands} HANDS [
              {MODE_LABEL[cameraStatus.mode]}]
            </span>
          )}
          {cameraMode === "vision" && (
            <span className="hud-badge camera-badge">
              CAM: VISION [{VISION_STATE_LABEL[visionStatus.state]}
              {visionStatus.state === "detected" && visionStatus.label ? `: ${visionStatus.label}` : ""}
              {visionStatus.state === "cooldown" && visionStatus.cooldownSeconds ? ` ${visionStatus.cooldownSeconds}s` : ""}]
            </span>
          )}
        </div>

        <div className="hud-controls-group">
          <button
            id="btn-hud-commands"
            type="button"
            className="hud-btn"
            onClick={() => setShowHelp(true)}
            title="Help / Directives"
          >
            COMMANDS (?)
          </button>
          <button
            id="btn-hud-config"
            type="button"
            className="hud-btn"
            onClick={() => setShowSettings(true)}
            title="Contacts & Settings"
          >
            CONFIG ⚙️
          </button>
        </div>
      </header>

      {/* Quick Action Dock */}
      <aside className="hud-quick-dock">
        <button
          id="btn-dock-zoom-in"
          type="button"
          className="hud-dock-btn"
          onClick={() => sendQuickCommand("zoom in")}
          title="Zoom in (+)"
        >
          ZOOM +
        </button>
        <button
          id="btn-dock-zoom-out"
          type="button"
          className="hud-dock-btn"
          onClick={() => sendQuickCommand("zoom out")}
          title="Zoom out (-)"
        >
          ZOOM -
        </button>
        <button
          id="btn-dock-origin"
          type="button"
          className="hud-dock-btn"
          onClick={() => sendQuickCommand("reset")}
          title="Reset View (R)"
        >
          ORIGIN
        </button>
        <button
          id="btn-dock-surge"
          type="button"
          className="hud-dock-btn overdrive-btn"
          onClick={() => sendQuickCommand("overdrive")}
          title="Pulse Surge (Space)"
        >
          SURGE ⚡
        </button>
        <button
          id="btn-dock-theme"
          type="button"
          className="hud-dock-btn"
          onClick={cycleTheme}
          title="Change Hologram Color Theme (T / C)"
        >
          🎨 COLOR
        </button>

        <div className="hud-dock-divider" />

        <button
          id="btn-dock-vision"
          type="button"
          className={`hud-dock-btn ${cameraMode === "vision" ? "active-dock" : ""}`}
          onClick={() => toggleCameraMode("vision")}
          title="Object Detection (O)"
        >
          👁️ VISION
        </button>
        {cameraMode === "vision" && (
          <button
            id="btn-dock-scan"
            type="button"
            className="hud-dock-btn"
            onClick={scanForObject}
            disabled={visionStatus.state === "scanning" || visionStatus.state === "cooldown"}
            title="Identify what's in view right now"
          >
            🔍 SCAN OBJECT
          </button>
        )}
        <button
          id="btn-dock-gestures"
          type="button"
          className={`hud-dock-btn ${cameraMode === "gestures" ? "active-dock" : ""}`}
          onClick={() => toggleCameraMode("gestures")}
          title="Hand Gestures (G)"
        >
          🖐️ GESTURES
        </button>
        <button
          id="btn-dock-voice"
          type="button"
          className={`hud-dock-btn ${isVoiceActive ? "active-dock" : ""}`}
          onClick={toggleVoice}
          title="Voice Command (V)"
        >
          {isVoiceActive ? "🎙️ LISTENING" : "🎙️ VOICE"}
        </button>
      </aside>

      {/* Guarded Confirmation HUD Banner (Phase 4 / 8) */}
      {pendingConfirmation && (
        <div
          id="confirmation-banner"
          style={{
            position: "fixed",
            top: "70px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(20, 10, 0, 0.92)",
            border: "2px solid #ffaa30",
            borderRadius: "8px",
            padding: "16px 24px",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            boxShadow: "0 0 30px rgba(255, 170, 48, 0.5)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div style={{ color: "#ffaa30", fontSize: "14px", fontWeight: "bold", letterSpacing: "0.1em" }}>
            ⚠️ CONFIRMATION REQUIRED
          </div>
          <div style={{ color: "#ffffff", fontSize: "15px", textAlign: "center" }}>
            {pendingConfirmation.prompt}
          </div>
          <div style={{ display: "flex", gap: "16px" }}>
            <button
              id="btn-confirm-yes"
              type="button"
              onClick={() => handleConfirmAction(true)}
              style={{
                background: "#00ff88",
                color: "#000",
                fontWeight: "bold",
                border: "none",
                borderRadius: "4px",
                padding: "8px 20px",
                cursor: "pointer",
              }}
            >
              CONFIRM (YES / 👍)
            </button>
            <button
              id="btn-confirm-no"
              type="button"
              onClick={() => handleConfirmAction(false)}
              style={{
                background: "#ff2a2a",
                color: "#fff",
                fontWeight: "bold",
                border: "none",
                borderRadius: "4px",
                padding: "8px 20px",
                cursor: "pointer",
              }}
            >
              CANCEL (NO / 👎)
            </button>
          </div>
        </div>
      )}

      {/* Main Terminal HUD & Dual Prompt Bar */}
      <footer className="hud-bottom-terminal">
        {/* Terminal Live Dialogue Log */}
        <div className="terminal-log-container">
          <div className="terminal-transcript-bar">
            <span className="transcript-label">MIC INPUT:</span>
            <span className="transcript-text">
              &ldquo;{transcript.text}&rdquo;
            </span>
          </div>

          <div className="terminal-response-bar">
            <span className="response-label">ULTRON:</span>
            <span className="response-text">{agentResponse}</span>
          </div>

          {lastToolAction && (
            <div
              style={{
                fontSize: "11px",
                color: "var(--theme-bright)",
                opacity: 0.8,
                marginTop: "2px",
              }}
            >
              ⚙️ {lastToolAction}
            </div>
          )}

          {detectedObjects.length > 0 && (
            <div
              style={{
                fontSize: "11px",
                color: "#00ff88",
                opacity: 0.9,
                marginTop: "2px",
              }}
            >
              🎯 Vision Tracking: {detectedObjects.join(", ")}
            </div>
          )}
        </div>

        {/* Input Bar with Voice Equalizer & Mute Toggle */}
        <div className="terminal-input-row">
          <form className="terminal-form" onSubmit={handleInputSubmit}>
            <span className="prompt-sign">&gt;</span>
            <input
              id="terminal-query-input"
              type="text"
              className="terminal-input"
              placeholder="Type directive (e.g. 'open notepad', 'close chrome', 'find all pdfs', 'message brother')..."
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              disabled={isProcessing}
            />
            <button
              id="terminal-execute-btn"
              type="submit"
              className="terminal-send-btn"
              disabled={isProcessing || !inputQuery.trim()}
            >
              {isProcessing ? "THINKING…" : "EXECUTE"}
            </button>
          </form>

          <div className="voice-widget">
            <button
              type="button"
              className={`hud-voice-toggle ${isVoiceActive ? "active" : ""}`}
              onClick={toggleVoice}
            >
              {isVoiceActive ? "VOICE ACTIVE" : "VOICE OFF (V)"}
            </button>

            <button
              type="button"
              className={`hud-mute-btn ${isMuted ? "muted" : ""}`}
              onClick={toggleMute}
              title={isMuted ? "Unmute AI Voice (M)" : "Mute AI Voice (M)"}
            >
              {isMuted ? "🔇" : "🔊"}
            </button>

            {/* Visualizer Audio Spectrum Bars */}
            <div className="hud-visualizer-bars">
              {audioBars.map((height, idx) => (
                <div
                  key={idx}
                  className="hud-v-bar"
                  style={{ height: `${height}px` }}
                />
              ))}
            </div>
          </div>
        </div>
      </footer>

      {/* Error HUD Notification Banner */}
      {error && (
        <div className="hud-error-banner">
          <span>⚠️ {error}</span>
          <button
            type="button"
            className="hud-error-close"
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Configuration & Contacts Settings Modal */}
      {showSettings && (
        <div className="hud-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="hud-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hud-modal-header">
              <h2>⚙️ ULTRON CONFIGURATION & CONTACTS</h2>
              <button
                type="button"
                className="hud-modal-close"
                onClick={() => setShowSettings(false)}
              >
                ✕
              </button>
            </div>

            {/* Holographic Color Theme Palette Selector */}
            <div className="settings-field" style={{ marginBottom: "24px" }}>
              <label className="settings-label">
                🎨 Holographic Orb Color Theme Protocol
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
                  gap: "10px",
                  marginTop: "8px",
                }}
              >
                {(Object.keys(VOICE_THEMES) as VoiceTheme[]).map((tKey) => {
                  const theme = VOICE_THEMES[tKey];
                  const isSelected = currentTheme === tKey;
                  return (
                    <button
                      key={tKey}
                      type="button"
                      onClick={() => applyTheme(tKey)}
                      style={{
                        background: isSelected
                          ? `rgba(${parseInt(theme.primary.slice(1, 3), 16)}, ${parseInt(theme.primary.slice(3, 5), 16)}, ${parseInt(theme.primary.slice(5, 7), 16)}, 0.35)`
                          : "rgba(20, 20, 20, 0.7)",
                        border: isSelected
                          ? `2px solid ${theme.primary}`
                          : "1px solid rgba(255, 255, 255, 0.15)",
                        borderRadius: "8px",
                        padding: "10px 8px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "6px",
                        cursor: "pointer",
                        boxShadow: isSelected ? `0 0 15px ${theme.glow}` : "none",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <div
                        style={{
                          width: "22px",
                          height: "22px",
                          borderRadius: "50%",
                          background: theme.primary,
                          boxShadow: `0 0 10px ${theme.primary}`,
                        }}
                      />
                      <span
                        style={{
                          color: isSelected ? theme.bright : "#ccc",
                          fontSize: "11px",
                          fontWeight: isSelected ? "bold" : "normal",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {theme.name.replace("PROTOCOL ", "")}
                      </span>
                      {isSelected && (
                        <span
                          style={{
                            fontSize: "9px",
                            color: theme.primary,
                            background: "rgba(0,0,0,0.6)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontWeight: "bold",
                          }}
                        >
                          ACTIVE
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-label">
                WhatsApp Address Book (Contacts for Voice Messaging)
              </label>
              <div className="contact-row" style={{ marginBottom: "8px" }}>
                <input
                  type="text"
                  className="settings-input"
                  placeholder="Contact Name (e.g. Brother)"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                />
                <input
                  type="text"
                  className="settings-input"
                  placeholder="Phone (e.g. +1234567890)"
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                />
                <input
                  type="text"
                  className="settings-input"
                  placeholder="Relation (e.g. brother)"
                  value={newContactRel}
                  onChange={(e) => setNewContactRel(e.target.value)}
                />
                <button
                  type="button"
                  className="terminal-send-btn"
                  onClick={handleAddContact}
                >
                  + ADD
                </button>
              </div>

              <div className="contacts-list">
                {contacts.map((c, i) => (
                  <div key={i} className="contact-row">
                    <span style={{ minWidth: "120px", color: "var(--theme-bright)" }}>
                      {c.name} {c.relationship ? `(${c.relationship})` : ""}
                    </span>
                    <span style={{ flex: 1, color: "#aaa" }}>{c.phone || "No phone"}</span>
                    <button
                      type="button"
                      className="contact-del-btn"
                      onClick={() => handleDeleteContact(i)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: "16px", fontSize: "12px", color: "#888" }}>
              🔒 Gemini API Key is loaded automatically from your project environment (<code style={{ color: "var(--theme-bright)" }}>.env.local</code>).
            </div>
          </div>
        </div>
      )}

      {/* Voice Commands Cheat Sheet Modal */}
      {showHelp && (
        <div className="hud-modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="hud-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hud-modal-header">
              <h2>🎙️ ULTRON DIRECTIVES & COMMANDS</h2>
              <button
                type="button"
                className="hud-modal-close"
                onClick={() => setShowHelp(false)}
              >
                ✕
              </button>
            </div>

            <div className="hud-modal-grid">
              <div className="hud-modal-section">
                <h3>💬 Communication & AI Directives</h3>
                <ul>
                  <li>
                    <span className="cmd-phrase">&ldquo;Message brother [text]&rdquo;</span>
                    <span>Send WhatsApp</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;What do you see?&rdquo;</span>
                    <span>Camera Vision AI</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Open [app/file]&rdquo;</span>
                    <span>Launch any app</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Close [app/that]&rdquo;</span>
                    <span>Close application</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;What is running?&rdquo;</span>
                    <span>List active windows</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Delete [file]&rdquo;</span>
                    <span>Recycle Bin (Soft delete)</span>
                  </li>
                </ul>
              </div>

              <div className="hud-modal-section">
                <h3>🎨 Hologram Color Protocols</h3>
                <ul>
                  <li>
                    <span className="cmd-phrase">&ldquo;Protocol Crimson&rdquo;</span>
                    <span>Ultron Red</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Protocol Jarvis&rdquo;</span>
                    <span>Holo Cyan</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Protocol Gold&rdquo;</span>
                    <span>Amber Gold</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Protocol Emerald&rdquo;</span>
                    <span>Matrix Green</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Protocol Amethyst&rdquo;</span>
                    <span>Violet Core</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Protocol Ice&rdquo;</span>
                    <span>Frost Silver</span>
                  </li>
                </ul>
              </div>

              <div className="hud-modal-section">
                <h3>🖐️ Hands-Free Gestures</h3>
                <ul>
                  <li>
                    <span className="cmd-phrase">👍 Thumbs Up</span>
                    <span>Confirm &ldquo;Yes&rdquo;</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">👎 Thumbs Down</span>
                    <span>Cancel &ldquo;No&rdquo;</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">🖐️ Open Palm (1s)</span>
                    <span>Toggle Mute</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">✊ Closed Fist (1s)</span>
                    <span>Emergency Stop</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">🤏 Pinch Drag</span>
                    <span>Rotate 3D Orb</span>
                  </li>
                </ul>
              </div>

              <div className="hud-modal-section">
                <h3>Navigation & Movement</h3>
                <ul>
                  <li>
                    <span className="cmd-phrase">&ldquo;Zoom in&rdquo; / &ldquo;Zoom out&rdquo;</span>
                    <span>Adjust focal depth</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Auto spin&rdquo; / &ldquo;Stop spin&rdquo;</span>
                    <span>Orb revolution</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Overdrive&rdquo; / &ldquo;Pulse&rdquo;</span>
                    <span>Energy surge</span>
                  </li>
                  <li>
                    <span className="cmd-phrase">&ldquo;Reset&rdquo;</span>
                    <span>Origin view</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
