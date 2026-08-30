import type { ToolDefinition } from "@/lib/tools/definitions";

export interface AiHistoryMessage {
  role: "user" | "model";
  text: string;
}

export interface AiToolExecuted {
  tool: string;
  args: Record<string, any>;
  result: string;
}

export interface AiConfirmationRequired {
  tool: string;
  args: Record<string, any>;
  description: string;
  prompt: string;
}

export interface AiChatResult {
  text: string;
  toolsExecuted: AiToolExecuted[];
  uiActions: Record<string, any>[];
  confirmationRequired: AiConfirmationRequired | null;
  provider: string;
}

/**
 * A single "run a tool, or refuse and say why" call, shared across every
 * provider so the confirmation/safety gate lives in exactly one place
 * instead of being reimplemented per provider's tool-loop.
 */
export type SafeToolExecutor = (toolName: string, args: Record<string, any>) => Promise<
  | { kind: "executed"; output: string; data?: any; uiAction?: Record<string, any> }
  | { kind: "confirmation_required"; confirmation: AiConfirmationRequired }
>;

export interface AiChatParams {
  systemInstruction: string;
  history: AiHistoryMessage[];
  message: string;
  imageBase64?: string;
  detectedObjects?: string[];
  tools: ToolDefinition[];
  executeTool: SafeToolExecutor;
}

export interface AiProvider {
  id: string;
  label: string;
  /** Cheap, synchronous-ish check — is a key configured / is this even worth attempting? */
  isConfigured(): boolean;
  chat(params: AiChatParams): Promise<AiChatResult>;
}

export class ProviderUnavailableError extends Error {
  provider: string;
  constructor(provider: string, message: string) {
    super(`[${provider}] ${message}`);
    this.provider = provider;
  }
}
