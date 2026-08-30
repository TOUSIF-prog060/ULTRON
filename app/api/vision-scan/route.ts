import { NextRequest, NextResponse } from "next/server";
import { analyzeImage, VisionError } from "@/lib/vision/analyze";

// Single-shot "what am I looking at" vision call. Continuous webcam
// detection now runs fully locally (MediaPipe, see lib/objectDetector.ts)
// so this endpoint is only hit on an explicit user scan — that plus the
// 60s identical-frame cache in analyzeImage() keeps cloud-vision quota
// usage minimal.
const VISION_SCAN_PROMPT = `You are ULTRON's vision system looking through a webcam. Identify the single most prominent object the person is holding up or showing to the camera. Respond with just the object name/description in 3-8 words — no preamble, no "I see" or "it looks like". If nothing identifiable is in frame, respond with exactly: nothing in view.`;

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json();
    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }

    const { text, provider } = await analyzeImage(String(imageBase64), VISION_SCAN_PROMPT, { cache: true });
    const label = text.replace(/[*#`_]/g, "").trim();
    const detected = label.length > 0 && label.toLowerCase() !== "nothing in view";

    return NextResponse.json({
      detected,
      label: detected ? label : null,
      provider,
    });
  } catch (err: any) {
    if (err instanceof VisionError) {
      const status = err.kind === "rate_limited" ? 429 : err.kind === "no_provider" ? 400 : 500;
      return NextResponse.json(
        {
          error: err.kind === "rate_limited" ? "rate_limited" : err.kind === "no_provider" ? "no_api_key" : "vision_error",
          message: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
        },
        { status }
      );
    }
    console.error("Vision scan error:", err);
    return NextResponse.json({ error: "internal_error", message: err.message || String(err) }, { status: 500 });
  }
}
