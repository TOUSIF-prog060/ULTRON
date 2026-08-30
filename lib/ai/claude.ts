import { toJsonSchema } from "./schema";
import type { AiChatParams, AiChatResult, AiProvider, AiToolExecuted } from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

async function callClaude(apiKey: string, body: Record<string, any>, timeoutMs = 20000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Claude API error (${res.status}): ${errorText}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const claudeProvider: AiProvider = {
  id: "claude",
  label: "Anthropic Claude",

  isConfigured() {
    return !!process.env.ANTHROPIC_API_KEY;
  },

  async chat(params: AiChatParams): Promise<AiChatResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("No Anthropic API key configured (ANTHROPIC_API_KEY)");
    const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

    const { systemInstruction, history, message, imageBase64, detectedObjects, tools, executeTool } = params;

    const claudeTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toJsonSchema(t),
    }));

    const messages: any[] = history.slice(-6).map((h) => ({
      role: h.role === "user" ? "user" : "assistant",
      content: h.text,
    }));

    let userText = message;
    if (detectedObjects && detectedObjects.length > 0) {
      userText += `\n[Camera Vision HUD: Currently tracking: ${detectedObjects.join(", ")}]`;
    }

    const userContent: any[] = [{ type: "text", text: userText }];
    if (imageBase64) {
      const match = imageBase64.match(/^data:(image\/\w+);base64,(.*)$/);
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: match ? match[1] : "image/jpeg",
          data: match ? match[2] : imageBase64,
        },
      });
    }
    messages.push({ role: "user", content: userContent });

    const executedActions: AiToolExecuted[] = [];
    const uiActions: Record<string, any>[] = [];

    let iterations = 0;
    let data = await callClaude(apiKey, {
      model,
      max_tokens: 1024,
      system: systemInstruction,
      messages,
      tools: claudeTools,
    });

    while (data.stop_reason === "tool_use" && iterations < 4) {
      iterations++;
      const toolUseBlocks = (data.content || []).filter((b: any) => b.type === "tool_use");
      const toolResultBlocks: any[] = [];

      for (const block of toolUseBlocks) {
        const outcome = await executeTool(block.name, block.input || {});

        if (outcome.kind === "confirmation_required") {
          return {
            text: `Confirmation required: ${outcome.confirmation.description}`,
            toolsExecuted: executedActions,
            uiActions: [{ action: "set_emotion", emotion: "confirm_pending" }],
            confirmationRequired: outcome.confirmation,
            provider: "claude",
          };
        }

        executedActions.push({ tool: block.name, args: block.input || {}, result: outcome.output });
        if (outcome.uiAction) uiActions.push(outcome.uiAction);
        toolResultBlocks.push({ type: "tool_result", tool_use_id: block.id, content: outcome.output });
      }

      messages.push({ role: "assistant", content: data.content });
      messages.push({ role: "user", content: toolResultBlocks });

      try {
        data = await callClaude(apiKey, {
          model,
          max_tokens: 1024,
          system: systemInstruction,
          messages,
          tools: claudeTools,
        });
      } catch {
        break;
      }
    }

    const textBlock = (data.content || []).find((b: any) => b.type === "text");
    const responseText = textBlock?.text || "Done.";

    return {
      text: responseText,
      toolsExecuted: executedActions,
      uiActions: uiActions.length > 0 ? uiActions : [{ action: "set_emotion", emotion: "success" }],
      confirmationRequired: null,
      provider: "claude",
    };
  },
};
