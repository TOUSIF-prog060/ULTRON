// Perplexity "sonar" research helper. Perplexity's API is OpenAI-compatible
// but the sonar models don't do function-calling — they do live web
// research with citations. So rather than wiring Perplexity in as a chat
// brain, ULTRON's main model calls this through the `research_web` tool
// whenever it needs current information it can't answer from training.
//
// Falls back to a plain DuckDuckGo instant-answer lookup if no Perplexity
// key is set, so `research_web` still does something useful key-free.

const PPLX_URL = "https://api.perplexity.ai/chat/completions";

export interface ResearchResult {
  answer: string;
  citations: string[];
  source: "perplexity" | "duckduckgo" | "none";
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

export async function researchWeb(query: string): Promise<ResearchResult> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (key) {
    const model = process.env.PERPLEXITY_MODEL || "sonar";
    const res = await fetchWithTimeout(
      PPLX_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Be precise and concise. Answer in 3-6 sentences with the key facts." },
            { role: "user", content: query },
          ],
        }),
      },
      30_000
    );
    if (!res.ok) throw new Error(`Perplexity error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return {
      answer: data.choices?.[0]?.message?.content?.trim() || "No answer.",
      citations: data.citations || data.choices?.[0]?.message?.citations || [],
      source: "perplexity",
    };
  }

  // Key-free fallback: DuckDuckGo instant answer.
  try {
    const res = await fetchWithTimeout(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
      {},
      12_000
    );
    const data = await res.json();
    const answer =
      data.AbstractText ||
      data.Answer ||
      (data.RelatedTopics || []).map((t: any) => t.Text).filter(Boolean).slice(0, 3).join(" — ") ||
      "";
    if (answer) {
      return { answer, citations: data.AbstractURL ? [data.AbstractURL] : [], source: "duckduckgo" };
    }
  } catch {}

  return {
    answer: "No research provider is configured. Add PERPLEXITY_API_KEY to .env.local for live web research.",
    citations: [],
    source: "none",
  };
}
