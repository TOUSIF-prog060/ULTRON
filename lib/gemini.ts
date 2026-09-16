// Shared Gemini call helpers used by both /api/chat and /api/vision-scan.
//
// Google periodically retires model IDs (this app broke silently for a while
// because "gemini-2.5-flash" started 404ing with "no longer available to new
// users"). We try a prioritized candidate list, only advance on a
// model-not-found 404 (any other error — bad key, quota, rate limit — won't
// be fixed by switching model names), and cache whichever model actually
// worked for the life of this server process so we're not re-probing on
// every request.
export const MODEL_CANDIDATES = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
  "gemini-3.6-flash",
];
let workingModel: string | null = null;

export function modelUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

export async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class GeminiApiError extends Error {
  status: number;
  isRateLimited: boolean;
  retryAfterSeconds?: number;

  constructor(status: number, body: string) {
    super(`Gemini API error (${status}): ${body}`);
    this.status = status;
    this.isRateLimited = status === 429;
    if (this.isRateLimited) {
      const match = body.match(/"retryDelay":\s*"(\d+)s"/);
      if (match) this.retryAfterSeconds = parseInt(match[1], 10);
    }
  }
}

/**
 * POSTs a Gemini generateContent request body against the model candidate
 * list, self-healing to whichever model name currently works. Returns the
 * parsed response JSON. Throws GeminiApiError on failure (callers can check
 * `.isRateLimited` / `.retryAfterSeconds` to handle quota exhaustion
 * gracefully instead of just failing silently).
 */
export async function callGemini(apiKey: string, body: Record<string, any>): Promise<any> {
  const requestBody = JSON.stringify(body);
  const candidates = workingModel
    ? [workingModel, ...MODEL_CANDIDATES.filter((m) => m !== workingModel)]
    : MODEL_CANDIDATES;

  let res: Response | null = null;
  let lastErrorText = "";
  let lastStatus = 0;

  for (const model of candidates) {
    try {
      const url = modelUrl(model, apiKey);
      res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });

      if (res.ok) {
        workingModel = model;
        return await res.json();
      }

      lastErrorText = await res.text();
      lastStatus = res.status;

      // If this model is rate limited (429), not found (404), or temporarily overloaded (503), try the next candidate
      console.warn(`Gemini model "${model}" returned status ${res.status}, checking next candidate...`);
      if (workingModel === model) {
        workingModel = null;
      }
    } catch (err: any) {
      console.warn(`Gemini model "${model}" fetch error: ${err?.message}, checking next candidate...`);
    }
  }

  throw new GeminiApiError(lastStatus, lastErrorText);
}

