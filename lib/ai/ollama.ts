import { toJsonSchema } from "./schema";
import type { AiChatParams, AiChatResult, AiProvider, AiToolExecuted } from "./types";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.1";

function baseUrl(): string {
  return process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
}

async function callOllama(body: Record<string, any>, timeoutMs = 30000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Ollama error (${res.status}): ${errorText}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * No API key by design — this runs entirely on your own machine via
 * https://ollama.com. `isConfigured()` can't really know whether Ollama is
 * installed/running without a network round trip, so it always reports
 * true; unavailability shows up as a connection-refused error on the first
 * `chat()` call instead, which the router treats the same as any other
 * provider failure (skip to the next one in the fallback chain).
 *
 * Tool-calling quality depends entirely on the local model — only a subset
 * of Ollama models (llama3.1, llama3.2, mistral-nemo, qwen2.5, etc.)
 * actually support function calling well. A model without that support will
 * just answer in plain text and ignore `tools` — still useful as a last
 * resort for basic conversation, just without the ability to act on it.
 */
export const ollamaProvider: AiProvider = {
  id: "ollama",
  label: "Local (Ollama)",

  isConfigured() {
    return true;
  },

  async chat(params: AiChatParams): Promise<AiChatResult> {
    const model = process.env.OLLAMA_MODEL || DEFAULT_MODEL;
    const { systemInstruction, history, message, imageBase64, detectedObjects, tools, executeTool } = params;

    const ollamaTools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: toJsonSchema(t) },
    }));

    const messages: any[] = [{ role: "system", content: systemInstruction }];
    for (const h of history.slice(-6)) {
      messages.push({ role: h.role === "user" ? "user" : "assistant", content: h.text });
    }

    let userText = message;
    if (detectedObjects && detectedObjects.length > 0) {
      userText += `\n[Camera Vision HUD: Currently tracking: ${detectedObjects.join(", ")}]`;
    }
    const userMsg: any = { role: "user", content: userText };
    if (imageBase64) {
      userMsg.images = [imageBase64.replace(/^data:image\/\w+;base64,/, "")];
    }
    messages.push(userMsg);

    const executedActions: AiToolExecuted[] = [];
    const uiActions: Record<string, any>[] = [];

    let iterations = 0;
    let data = await callOllama({ model, messages, tools: ollamaTools, stream: false });

    while (data.message?.tool_calls?.length > 0 && iterations < 4) {
      iterations++;
      messages.push(data.message);

      for (const call of data.message.tool_calls) {
        const toolName = call.function?.name;
        const toolArgs = call.function?.arguments || {};
        const outcome = await executeTool(toolName, toolArgs);

        if (outcome.kind === "confirmation_required") {
          return {
            text: `Confirmation required: ${outcome.confirmation.description}`,
            toolsExecuted: executedActions,
            uiActions: [{ action: "set_emotion", emotion: "confirm_pending" }],
            confirmationRequired: outcome.confirmation,
            provider: "ollama",
          };
        }

        executedActions.push({ tool: toolName, args: toolArgs, result: outcome.output });
        if (outcome.uiAction) uiActions.push(outcome.uiAction);
        messages.push({ role: "tool", content: outcome.output });
      }

      try {
        data = await callOllama({ model, messages, tools: ollamaTools, stream: false });
      } catch {
        break;
      }
    }

    const responseText = data.message?.content || "Done.";

    return {
      text: responseText,
      toolsExecuted: executedActions,
      uiActions: uiActions.length > 0 ? uiActions : [{ action: "set_emotion", emotion: "success" }],
      confirmationRequired: null,
      provider: "ollama",
    };
  },
};
