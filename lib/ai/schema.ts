import type { ToolDefinition } from "@/lib/tools/definitions";

// Our ASSISTANT_TOOLS definitions use Gemini's uppercase type convention
// (STRING/NUMBER/BOOLEAN/ARRAY/OBJECT). Claude and Ollama both expect
// standard lowercase JSON Schema, so this is shared by both of them.
export function toJsonSchema(tool: ToolDefinition): {
  type: "object";
  properties: Record<string, any>;
  required: string[];
} {
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(tool.parameters.properties).map(([key, prop]) => [
        key,
        {
          type: prop.type.toLowerCase(),
          description: prop.description,
          ...(prop.enum ? { enum: prop.enum } : {}),
        },
      ])
    ),
    required: tool.parameters.required || [],
  };
}
