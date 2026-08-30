import { toJsonSchema } from "./schema";
import type { AiChatParams, AiChatResult, AiProvider, AiToolExecuted } from "./types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

async function callOpenAI(apiKey: string, body: Record<string, any>, timeoutMs = 25000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OpenAI (GPT) provider. Uses the Chat Completions API with parallel
 * tool-calling. Supports vision on gpt-4o / gpt-4o-mini when an image is
 * attached. Configure with OPENAI_API_KEY (+ optional OPENAI_MODEL).
 */
export const openaiProvider: AiProvider = {
  id: "openai",
  label: "OpenAI GPT",

  isConfigured() {
    return !!process.env.OPENAI_API_KEY;
  },

  async chat(params: AiChatParams): Promise<AiChatResult> {
    const apiKey = process.env.OPENAI_API_KEY!;
    const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
    const { systemInstruction, history, message, imageBase64, detectedObjects, tools, executeTool } = params;

    const openaiTools = tools.map((t) => ({
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
    if (imageBase64) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}` } },
        ],
      });
    } else {
      messages.push({ role: "user", content: userText });
    }

    const executedActions: AiToolExecuted[] = [];
    const uiActions: Record<string, any>[] = [];

    let iterations = 0;
    let data = await callOpenAI(apiKey, { model, max_tokens: 1024, messages, tools: openaiTools });

    while (data.choices?.[0]?.message?.tool_calls?.length > 0 && iterations < 4) {
      iterations++;
      const assistantMsg = data.choices[0].message;
      messages.push(assistantMsg);

      for (const call of assistantMsg.tool_calls) {
        const toolName = call.function?.name;
        let toolArgs: Record<string, any> = {};
        try {
          toolArgs = JSON.parse(call.function?.arguments || "{}");
        } catch {}

        const outcome = await executeTool(toolName, toolArgs);
        if (outcome.kind === "confirmation_required") {
          return {
            text: `Confirmation required: ${outcome.confirmation.description}`,
            toolsExecuted: executedActions,
            uiActions: [{ action: "set_emotion", emotion: "confirm_pending" }],
            confirmationRequired: outcome.confirmation,
            provider: "openai",
          };
        }

        executedActions.push({ tool: toolName, args: toolArgs, result: outcome.output });
        if (outcome.uiAction) uiActions.push(outcome.uiAction);
        messages.push({ role: "tool", tool_call_id: call.id, content: outcome.output });
      }

      try {
        data = await callOpenAI(apiKey, { model, max_tokens: 1024, messages, tools: openaiTools });
      } catch {
        break;
      }
    }

    const responseText = data.choices?.[0]?.message?.content || "Done.";

    return {
      text: responseText,
      toolsExecuted: executedActions,
      uiActions: uiActions.length > 0 ? uiActions : [{ action: "set_emotion", emotion: "success" }],
      confirmationRequired: null,
      provider: "openai",
    };
  },
};
