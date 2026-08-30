import { callGemini } from "@/lib/gemini";
import type { AiChatParams, AiChatResult, AiProvider, AiToolExecuted } from "./types";

export const geminiProvider: AiProvider = {
  id: "gemini",
  label: "Google Gemini",

  isConfigured() {
    return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  },

  async chat(params: AiChatParams): Promise<AiChatResult> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("No Gemini API key configured (GEMINI_API_KEY / GOOGLE_API_KEY)");

    const { systemInstruction, history, message, imageBase64, detectedObjects, tools, executeTool } = params;

    const geminiTools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: {
            type: "OBJECT",
            properties: Object.fromEntries(
              Object.entries(t.parameters.properties).map(([k, v]) => [
                k,
                { type: v.type, description: v.description, ...(v.enum ? { enum: v.enum } : {}) },
              ])
            ),
            required: t.parameters.required || [],
          },
        })),
      },
    ];

    const contents: any[] = [];
    for (const h of history.slice(-6)) {
      contents.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] });
    }

    const userParts: any[] = [];
    let userText = message;
    if (detectedObjects && detectedObjects.length > 0) {
      userText += `\n[Camera Vision HUD: Currently tracking: ${detectedObjects.join(", ")}]`;
    }
    userParts.push({ text: userText });
    if (imageBase64) {
      userParts.push({
        inlineData: { mimeType: "image/jpeg", data: imageBase64.replace(/^data:image\/\w+;base64,/, "") },
      });
    }
    contents.push({ role: "user", parts: userParts });

    let data = await callGemini(apiKey, {
      contents,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      tools: geminiTools,
    });

    const executedActions: AiToolExecuted[] = [];
    const uiActions: Record<string, any>[] = [];

    let candidate = data.candidates?.[0]?.content;
    let functionCalls = candidate?.parts?.filter((p: any) => p.functionCall);
    let iterations = 0;

    while (functionCalls && functionCalls.length > 0 && iterations < 4) {
      iterations++;
      contents.push(candidate);
      const functionResponseParts: any[] = [];

      for (const call of functionCalls) {
        const toolName = call.functionCall.name;
        const toolArgs = call.functionCall.args || {};
        const outcome = await executeTool(toolName, toolArgs);

        if (outcome.kind === "confirmation_required") {
          return {
            text: `Confirmation required: ${outcome.confirmation.description}`,
            toolsExecuted: executedActions,
            uiActions: [{ action: "set_emotion", emotion: "confirm_pending" }],
            confirmationRequired: outcome.confirmation,
            provider: "gemini",
          };
        }

        executedActions.push({ tool: toolName, args: toolArgs, result: outcome.output });
        if (outcome.uiAction) uiActions.push(outcome.uiAction);

        functionResponseParts.push({
          functionResponse: { name: toolName, response: { name: toolName, content: { result: outcome.output, data: outcome.data } } },
        });
      }

      contents.push({ role: "user", parts: functionResponseParts });

      try {
        data = await callGemini(apiKey, {
          contents,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          tools: geminiTools,
        });
      } catch {
        break;
      }
      candidate = data.candidates?.[0]?.content;
      functionCalls = candidate?.parts?.filter((p: any) => p.functionCall);
    }

    const textPart = candidate?.parts?.find((p: any) => p.text);
    const responseText = textPart?.text || "Done.";

    return {
      text: responseText,
      toolsExecuted: executedActions,
      uiActions: uiActions.length > 0 ? uiActions : [{ action: "set_emotion", emotion: "success" }],
      confirmationRequired: null,
      provider: "gemini",
    };
  },
};
