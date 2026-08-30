import { geminiProvider } from "./gemini";
import { claudeProvider } from "./claude";
import { openaiProvider } from "./openai";
import { ollamaProvider } from "./ollama";
import type { AiChatParams, AiChatResult, AiProvider } from "./types";

const ALL_PROVIDERS: Record<string, AiProvider> = {
  gemini: geminiProvider,
  claude: claudeProvider,
  openai: openaiProvider,
  ollama: ollamaProvider,
};

// Claude and GPT first (large paid quotas, best tool-calling), Gemini
// only if they aren't configured (its free tier is ~20 requests/day and
// gets exhausted almost immediately), local Ollama as the offline
// last resort. Override with AI_PROVIDER_ORDER in .env.local.
const DEFAULT_ORDER = ["claude", "openai", "gemini", "ollama"];

/**
 * Reads AI_PROVIDER_ORDER from the environment (comma-separated provider
 * ids, e.g. "claude,gemini,ollama") so you can reorder or exclude providers
 * without touching code — just edit .env.local. Unknown ids are ignored;
 * an empty/unset value falls back to the default order.
 */
function getProviderOrder(): AiProvider[] {
  const raw = process.env.AI_PROVIDER_ORDER;
  const ids = raw
    ? raw.split(",").map((s) => s.trim().toLowerCase()).filter((id) => id in ALL_PROVIDERS)
    : DEFAULT_ORDER;
  const order = ids.length > 0 ? ids : DEFAULT_ORDER;
  return order.map((id) => ALL_PROVIDERS[id]);
}

export function listProviders(): { id: string; label: string; configured: boolean }[] {
  return getProviderOrder().map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured() }));
}

/**
 * Tries each configured provider in order (Gemini → Claude → local Ollama
 * by default) until one succeeds. Any provider throwing (missing key, rate
 * limit, model error, connection refused for a local Ollama that isn't
 * running) is logged and skipped — never silently swallowed, matching the
 * rest of this app's "don't hide failures" pattern. If every provider
 * fails, throws a combined error so the caller can fall back to the local
 * regex-based intent engine, same as before this multi-provider layer
 * existed.
 */
export async function chatWithFallback(params: AiChatParams): Promise<AiChatResult> {
  const providers = getProviderOrder();
  const errors: string[] = [];

  for (const provider of providers) {
    if (!provider.isConfigured()) {
      continue;
    }
    try {
      return await provider.chat(params);
    } catch (err: any) {
      const message = err?.message || String(err);
      console.warn(`[ai/router] provider "${provider.id}" failed, trying next: ${message}`);
      errors.push(`${provider.id}: ${message}`);
    }
  }

  throw new Error(
    errors.length > 0
      ? `All AI providers failed:\n${errors.join("\n")}`
      : "No AI provider is configured (set GEMINI_API_KEY, ANTHROPIC_API_KEY, or run local Ollama)."
  );
}
