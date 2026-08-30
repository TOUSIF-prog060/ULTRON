import { callGemini, GeminiApiError } from "@/lib/gemini";

// ═══════════════════════════════════════════════════════════════════
//  Multi-provider image analysis
//
//  The webcam object scanner and the screen-capture tool both need
//  "here's an image + a question, give me a short answer". Gemini's
//  free tier is tiny (~20 req/day shared with chat), so this tries
//  Gemini first, then OpenAI (gpt-4o-mini vision), then Claude — using
//  whichever key is present. A 60s in-process cache keyed on a cheap
//  hash of the image avoids burning quota on identical frames.
// ═══════════════════════════════════════════════════════════════════

export type VisionErrorKind = "rate_limited" | "no_provider" | "provider_error";

export class VisionError extends Error {
  kind: VisionErrorKind;
  retryAfterSeconds?: number;
  constructor(kind: VisionErrorKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface CacheEntry {
  at: number;
  result: string;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function cheapHash(s: string): string {
  let h = 0;
  // Sample the string so we don't hash megabytes of base64 every call.
  const step = Math.max(1, Math.floor(s.length / 2048));
  for (let i = 0; i < s.length; i += step) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `${s.length}:${h}`;
}

function stripDataUrl(b64: string): { mime: string; data: string } {
  const m = b64.match(/^data:(image\/\w+);base64,(.*)$/s);
  return m ? { mime: m[1], data: m[2] } : { mime: "image/jpeg", data: b64 };
}

async function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

async function tryGemini(b64: string, prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const { data } = stripDataUrl(b64);
  try {
    const res = await callGemini(key, {
      contents: [
        { role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data } }] },
      ],
    });
    return (
      res.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text?.trim() || null
    );
  } catch (err) {
    if (err instanceof GeminiApiError && err.isRateLimited) {
      throw new VisionError("rate_limited", err.message, err.retryAfterSeconds);
    }
    throw err;
  }
}

async function tryOpenAI(b64: string, prompt: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}` } },
            ],
          },
        ],
      }),
    },
    25_000
  );
  if (res.status === 429) throw new VisionError("rate_limited", "OpenAI rate limited", 30);
  if (!res.ok) throw new VisionError("provider_error", `OpenAI vision error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function tryClaude(b64: string, prompt: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const { mime, data } = stripDataUrl(b64);
  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mime, data } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    },
    25_000
  );
  if (res.status === 429) throw new VisionError("rate_limited", "Claude rate limited", 30);
  if (!res.ok) throw new VisionError("provider_error", `Claude vision error ${res.status}: ${await res.text()}`);
  const data2 = await res.json();
  return (data2.content || []).find((b: any) => b.type === "text")?.text?.trim() || null;
}

/**
 * Analyse an image with the first available vision provider. `providersTried`
 * in the result tells the caller which one answered. Throws VisionError.
 */
export async function analyzeImage(
  imageBase64: string,
  prompt: string,
  opts: { cache?: boolean } = {}
): Promise<{ text: string; provider: string; cached: boolean }> {
  const useCache = opts.cache !== false;
  const cacheKey = useCache ? cheapHash(imageBase64) + "|" + prompt.slice(0, 40) : "";
  if (useCache) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { text: hit.result, provider: "cache", cached: true };
    }
  }

  const order = (process.env.VISION_PROVIDER_ORDER || "gemini,openai,claude")
    .split(",")
    .map((s) => s.trim().toLowerCase());

  const runners: Record<string, (b: string, p: string) => Promise<string | null>> = {
    gemini: tryGemini,
    openai: tryOpenAI,
    claude: tryClaude,
  };

  const errors: string[] = [];
  let sawRateLimit: VisionError | null = null;

  for (const id of order) {
    const runner = runners[id];
    if (!runner) continue;
    try {
      const text = await runner(imageBase64, prompt);
      if (text != null) {
        if (useCache) cache.set(cacheKey, { at: Date.now(), result: text });
        return { text, provider: id, cached: false };
      }
    } catch (err) {
      if (err instanceof VisionError && err.kind === "rate_limited") {
        sawRateLimit = err;
        errors.push(`${id}: rate limited`);
        continue;
      }
      errors.push(`${id}: ${(err as Error).message}`);
    }
  }

  if (sawRateLimit) {
    throw new VisionError(
      "rate_limited",
      "Vision quota is exhausted on every configured provider. Add an OPENAI_API_KEY or ANTHROPIC_API_KEY for headroom.",
      sawRateLimit.retryAfterSeconds
    );
  }
  if (errors.length === 0) {
    throw new VisionError("no_provider", "No vision provider configured (set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY).");
  }
  throw new VisionError("provider_error", `All vision providers failed: ${clipErr(errors.join("; "))}`);
}

function clipErr(s: string): string {
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}
