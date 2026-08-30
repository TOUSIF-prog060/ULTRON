import { NextResponse } from "next/server";
import { listProviders } from "@/lib/ai/router";
import { getAllFacts, getAllCorrections } from "@/lib/memory/store";

// Quick "what's actually wired up" check — surfaced in the UI so a dead
// API key / exhausted quota is visible instead of silently degrading to
// the dumb local intent engine.
export async function GET() {
  const providers = listProviders();
  // Ollama always self-reports "configured" (it can't know if it's running
  // without a round trip), so a real cloud brain is what actually matters.
  const hasCloudBrain = providers.some((p) => p.id !== "ollama" && p.configured);
  const geminiOnly =
    hasCloudBrain &&
    providers.filter((p) => p.id !== "ollama" && p.configured).every((p) => p.id === "gemini");
  const anyConfigured = hasCloudBrain;

  return NextResponse.json({
    ok: true,
    brain: {
      providers,
      anyConfigured,
      note: !anyConfigured
        ? "No AI brain configured — running on the limited local intent engine. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local."
        : geminiOnly
        ? "Only the Gemini free tier is configured (~20 requests/day, shared with vision). It exhausts fast and then ULTRON drops to the dumb local engine. Add ANTHROPIC_API_KEY or OPENAI_API_KEY."
        : undefined,
    },
    vision: {
      gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      openai: !!process.env.OPENAI_API_KEY,
      claude: !!process.env.ANTHROPIC_API_KEY,
    },
    research: {
      perplexity: !!process.env.PERPLEXITY_API_KEY,
    },
    memory: {
      facts: getAllFacts().length,
      corrections: getAllCorrections().length,
    },
  });
}
