import { executeTool } from "@/lib/tools/executor";
import { getSafetyConfig } from "@/lib/tools/safety";
import type { SafeToolExecutor, AiConfirmationRequired } from "./types";

function describeConfirmation(toolName: string, args: Record<string, any>): AiConfirmationRequired {
  let desc = `Execute ${toolName}`;
  if (toolName === "delete_file") desc = `Delete "${args.path}" (move to Recycle Bin)`;
  else if (toolName === "close_app") desc = `Close application "${args.target}"`;
  else if (toolName === "send_whatsapp_message") desc = `Send WhatsApp message to ${args.recipient}: "${args.message}"`;

  return {
    tool: toolName,
    args,
    description: desc,
    prompt: `Are you sure you want to ${desc.toLowerCase()}?`,
  };
}

/**
 * Single source of truth for "does this tool call need confirmation before
 * it runs" — shared by every AI provider's tool-loop so the safety gate
 * from lib/tools/safety.ts can't drift between Gemini/Claude/Ollama
 * implementations.
 */
export const safeExecuteTool: SafeToolExecutor = async (toolName, args) => {
  const safetyConfig = getSafetyConfig();
  if (safetyConfig.requireConfirmationFor.includes(toolName)) {
    return { kind: "confirmation_required", confirmation: describeConfirmation(toolName, args) };
  }

  const result = await executeTool(toolName, args);
  return { kind: "executed", output: result.output, data: result.data, uiAction: result.uiAction };
};
