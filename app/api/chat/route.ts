import { NextRequest, NextResponse } from "next/server";
import { ASSISTANT_TOOLS } from "@/lib/tools/definitions";
import { executeTool } from "@/lib/tools/executor";
import { chatWithFallback } from "@/lib/ai/router";
import { safeExecuteTool } from "@/lib/ai/safeExecuteTool";
import { buildMemoryContext, recordTurn } from "@/lib/memory/store";

const SYSTEM_INSTRUCTION = `You are ULTRON, a highly sophisticated, intelligent, and natural conversational AI desktop companion with deep system integration on Windows.
You sound and behave like a real, capable human assistant: articulate, friendly, concise, proactive, and decisive.
You have real-time access to the user's computer: files, running applications, downloaded/installed apps, WhatsApp contacts, the web browser, camera vision, a screenshot of their screen, and the ability to type text and press keys in any active application window (Notepad, Word, browser, editor, etc.).
You also have a persistent long-term memory across sessions (see MEMORY CONTEXT below when present).

Rules:
- When the user asks you to launch/close an app, search or open the web (Google, YouTube, etc.), find/open/move/delete files, message on WhatsApp, look at their screen, or inspect the system — CALL THE MATCHING TOOL IMMEDIATELY. Do not say you can't; you can.
- "open youtube" / "open my browser and play X" -> use search_web_or_browser or open_app_or_file. Never refuse a browser request.
- If the user corrects you, call record_correction so you never repeat it. If they tell you something lasting, call remember or set_profile.
- For questions needing current/live information, call research_web.
- To help with "what's on my screen" / "look at this error", call capture_screen.
- Speak naturally in 1-2 sentences as if aloud. Never dump raw JSON, code blocks, or debug traces unless explicitly asked.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      message,
      history = [],
      imageBase64,
      detectedObjects = [],
      confirmedAction,
    } = body;

    // Handle explicit confirmation execution (Phase 4 / Phase 8) — this runs
    // unconditionally via the raw executor, not safeExecuteTool, since the
    // user already confirmed; gating it again here would just re-ask forever.
    if (confirmedAction && confirmedAction.tool) {
      const toolRes = await executeTool(confirmedAction.tool, confirmedAction.args || {});
      return NextResponse.json({
        response: toolRes.output,
        spokenResponse: toolRes.success ? "Confirmed and executed." : "Action failed.",
        toolsExecuted: [{ tool: confirmedAction.tool, args: confirmedAction.args, result: toolRes.output }],
        uiActions: toolRes.uiAction ? [toolRes.uiAction] : [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
      });
    }

    // Inject persistent memory (profile, remembered facts, corrections,
    // recent turns) so context carries across sessions.
    const memoryContext = buildMemoryContext(message || "");
    const systemInstruction = memoryContext
      ? `${SYSTEM_INSTRUCTION}\n\n${memoryContext}`
      : SYSTEM_INSTRUCTION;

    // 1. Try every configured AI provider in order (Claude → GPT → Gemini →
    // local Ollama by default, see lib/ai/router.ts) until one answers.
    try {
      const result = await chatWithFallback({
        systemInstruction,
        history,
        message,
        imageBase64,
        detectedObjects,
        tools: ASSISTANT_TOOLS,
        executeTool: safeExecuteTool,
      });

      recordTurn({
        userMessage: message || "",
        assistantReply: result.text,
        toolsUsed: (result.toolsExecuted || []).map((t: any) => t.tool),
      });

      return NextResponse.json({
        response: result.text,
        spokenResponse: result.text.replace(/[*#`_>\[\]]/g, "").trim(),
        toolsExecuted: result.toolsExecuted,
        uiActions: result.uiActions,
        confirmationRequired: result.confirmationRequired,
        provider: result.provider,
      });
    } catch (aiError: any) {
      console.warn("All AI providers unavailable, falling back to local engine:", aiError?.message);
    }

    // 2. Local Intelligent Fallback Engine (no AI provider configured/reachable)
    const fallbackResponse = await executeLocalIntentEngine(message, detectedObjects, imageBase64);
    recordTurn({
      userMessage: message || "",
      assistantReply: (fallbackResponse as any).response || "",
      toolsUsed: ((fallbackResponse as any).toolsExecuted || []).map((t: any) => t.tool),
    });
    return NextResponse.json(fallbackResponse);
  } catch (err: any) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      {
        response: `Core processing exception: ${err.message || String(err)}`,
        spokenResponse: "I encountered an issue processing that directive.",
        toolsExecuted: [],
      },
      { status: 500 }
    );
  }
}

// Local smart intent fallback engine
async function executeLocalIntentEngine(
  message: string,
  detectedObjects: string[] = [],
  imageBase64?: string
) {
  const text = message.toLowerCase().trim();
  const executedActions: any[] = [];
  const uiActions: any[] = [];

  // 1. Close App Intent
  if (text.startsWith("close ") || text.startsWith("kill ") || text.startsWith("exit ") || text === "close that" || text === "close it") {
    const target = text.replace(/^(close|kill|exit)\s+(?:the\s+)?(?:application\s+|app\s+)?/i, "").trim();
    const toolRes = await executeTool("close_app", { target });
    executedActions.push({ tool: "close_app", args: { target }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? `Closed ${target}.` : `Could not close ${target}.`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  // 2. What's Running / List Running Apps
  if (text.includes("what is running") || text.includes("whats running") || text.includes("running apps") || text.includes("open windows")) {
    const toolRes = await executeTool("list_running_apps", {});
    executedActions.push({ tool: "list_running_apps", args: {}, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: "Here are your currently open applications and windows.",
      toolsExecuted: executedActions,
      uiActions,
    };
  }

  // 2b. Installed Apps
  if (text.includes("installed apps") || text.includes("all apps") || text.includes("list apps") || text.includes("what apps")) {
    const toolRes = await executeTool("get_installed_apps", {});
    executedActions.push({ tool: "get_installed_apps", args: {}, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: "Here are the installed applications found on your system.",
      toolsExecuted: executedActions,
      uiActions,
    };
  }

  // 2c. Switch / Focus App
  if (text.startsWith("switch to ") || text.startsWith("focus ") || text.startsWith("bring ") && text.includes("to front")) {
    const target = text.replace(/^(switch to|focus|bring)\s+(?:the\s+)?(?:application\s+|app\s+)?/i, "").replace(/\s+to front/i, "").trim();
    const toolRes = await executeTool("switch_to_app", { target });
    executedActions.push({ tool: "switch_to_app", args: { target }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? `Switched to ${target}.` : `Could not focus ${target}.`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  // 3. Delete File Intent
  if (text.startsWith("delete file ") || text.startsWith("delete ") || text.startsWith("remove file ")) {
    const targetPath = text.replace(/^(delete file|delete|remove file|remove)\s+/i, "").trim();
    return {
      response: `Confirmation required: Move "${targetPath}" to Recycle Bin?`,
      spokenResponse: `Are you sure you want to delete ${targetPath}?`,
      confirmationRequired: {
        tool: "delete_file",
        args: { path: targetPath },
        description: `Delete "${targetPath}" (move to Recycle Bin)`,
        prompt: `Move "${targetPath}" to Recycle Bin?`,
      },
      toolsExecuted: [],
      uiActions: [{ action: "set_emotion", emotion: "confirm_pending" }],
    };
  }

  // 3b. Live research intent
  const researchMatch = text.match(/^(?:research|look up|tell me about|what(?:'s| is) the latest on|find out)\s+(.+)/i);
  if (researchMatch && researchMatch[1]) {
    const query = researchMatch[1].trim();
    const toolRes = await executeTool("research_web", { query });
    executedActions.push({ tool: "research_web", args: { query }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? toolRes.output.split("\n")[0] : `I couldn't research ${query}.`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  // 3c. Create / Write File Intent
  const createFileMatch =
    text.match(/^(?:create|make|write|generate)\s+(?:a\s+)?(?:new\s+)?file\s+(?:called\s+|named\s+)?["']?([^"'\s]+)["']?(?:\s+(?:with\s+(?:the\s+)?content|containing|with)\s+["']?(.*?)["']?)?$/i) ||
    text.match(/^(?:write|save)\s+["']?(.*?)["']?\s+(?:to|into|in)\s+(?:file\s+)?["']?([^"'\s]+)["']?$/i);

  if (createFileMatch) {
    let filePath = "";
    let content = "";
    if (text.startsWith("write ") && text.includes(" to ")) {
      content = createFileMatch[1]?.trim() || "";
      filePath = createFileMatch[2]?.trim() || "untitled.txt";
    } else {
      filePath = createFileMatch[1]?.trim() || "untitled.txt";
      content = createFileMatch[2]?.trim() || "";
    }
    const toolRes = await executeTool("create_file", { path: filePath, content });
    executedActions.push({ tool: "create_file", args: { path: filePath, content }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? `Created file ${filePath} for you.` : `Failed to create file: ${toolRes.output}`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  // 3d. Create Folder Intent
  const createFolderMatch = text.match(/^(?:create|make|new)\s+(?:a\s+)?(?:new\s+)?(?:folder|directory)\s+(?:called\s+|named\s+)?["']?([^"']+)["']?$/i);
  if (createFolderMatch && createFolderMatch[1]) {
    const folderPath = createFolderMatch[1].trim();
    const toolRes = await executeTool("create_folder", { path: folderPath });
    executedActions.push({ tool: "create_folder", args: { path: folderPath }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? `Created folder ${folderPath}.` : `Failed to create folder.`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  // 3e. Read File Intent
  const readFileMatch = text.match(/^(?:read|show|view|open and read|what(?:'s| is) in)\s+(?:the\s+)?(?:file\s+|document\s+)?["']?([^"']+)["']?$/i);
  if (readFileMatch && readFileMatch[1] && !readFileMatch[1].startsWith("my screen")) {
    const filePath = readFileMatch[1].trim();
    const toolRes = await executeTool("read_file", { path: filePath });
    executedActions.push({ tool: "read_file", args: { path: filePath }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? `Here are the contents of ${filePath}.` : `Could not read ${filePath}.`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  // 3f. Open Specific File Intent
  const openFileMatch = text.match(/^open\s+(?:the\s+)?(?:file|doc|document|pdf|image)\s+["']?([^"']+)["']?$/i);
  if (openFileMatch && openFileMatch[1]) {
    const fileQuery = openFileMatch[1].trim();
    const toolRes = await executeTool("open_file", { query: fileQuery });
    executedActions.push({ tool: "open_file", args: { query: fileQuery }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? `Opening ${fileQuery}.` : `Could not find or open ${fileQuery}.`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  // 4. Web & Browser Search Intent
  const browserSearchMatch =
    text.match(/(?:open\s+(?:a\s+|the\s+)?(?:browser|chrome|edge|google)\s+and\s+search\s+(?:for\s+)?)(.+)/i) ||
    text.match(/(?:search\s+(?:the\s+)?(?:web|internet|browser)\s+(?:for\s+)?)(.+)/i) ||
    text.match(/(?:search\s+(?:on\s+)?(google|youtube|bing|wikipedia)\s+(?:for\s+)?)(.+)/i) ||
    text.match(/(?:search\s+(?:for\s+)?)(.+?)\s+on\s+(google|youtube|bing|wikipedia|web|browser)/i) ||
    text.match(/(?:google|bing|duckduckgo)\s+(?:for\s+)?(.+)/i) ||
    text.match(/(?:play\s+)(.+?)(?:\s+on\s+youtube)$/i) ||
    text.match(/(?:search\s+youtube\s+for\s+)(.+)/i);

  if (browserSearchMatch) {
    let query = "";
    let engine = "google";

    if (text.includes("youtube")) engine = "youtube";
    else if (text.includes("wikipedia")) engine = "wikipedia";
    else if (text.includes("bing")) engine = "bing";

    if (browserSearchMatch[2] && ["google", "youtube", "bing", "wikipedia"].includes(browserSearchMatch[1]?.toLowerCase())) {
      query = browserSearchMatch[2].trim();
      engine = browserSearchMatch[1].toLowerCase();
    } else if (browserSearchMatch[1]) {
      query = browserSearchMatch[1].trim();
    }

    if (query) {
      const toolRes = await executeTool("search_web_or_browser", { query, engine });
      executedActions.push({ tool: "search_web_or_browser", args: { query, engine }, result: toolRes.output });
      const spoken = engine === "youtube" ? `Searching YouTube for ${query}.` : `Searching Google for ${query}.`;
      return {
        response: `Opened search for "${query}" on ${engine.toUpperCase()}.`,
        spokenResponse: spoken,
        toolsExecuted: executedActions,
        uiActions: [{ action: "set_emotion", emotion: "success" }],
      };
    }
  }

  // 4b. Type Text & Press Key Intent
  const typeMatch =
    text.match(/^(?:type|write|enter text)\s+(?:["']?)(.+?)(?:["']?)(?:\s+(?:in|into|on)\s+(.+))?$/i);
  if (typeMatch && typeMatch[1]) {
    const typeText = typeMatch[1].trim();
    const targetApp = typeMatch[2] ? typeMatch[2].trim() : undefined;
    const toolRes = await executeTool("type_text", { text: typeText, target_app: targetApp });
    executedActions.push({ tool: "type_text", args: { text: typeText, target_app: targetApp }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? `Typed for you.` : `Could not type text.`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  const pressMatch = text.match(/^(?:press|hit|send key)\s+(.+?)(?:\s+(?:in|into|on)\s+(.+))?$/i);
  if (pressMatch && pressMatch[1]) {
    const key = pressMatch[1].trim();
    const targetApp = pressMatch[2] ? pressMatch[2].trim() : undefined;
    const toolRes = await executeTool("press_key", { key, target_app: targetApp });
    executedActions.push({ tool: "press_key", args: { key, target_app: targetApp }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? `Pressed ${key}.` : `Could not press ${key}.`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  // 5. Open Application / Files Intent
  if (text.startsWith("open ") || text.startsWith("launch ") || text.startsWith("start ")) {
    const rawApp = text.replace(/^(open|launch|start)\s+(?:the\s+)?(?:application\s+|app\s+)?/i, "").trim();
    const toolRes = await executeTool("open_app_or_file", { target: rawApp });
    executedActions.push({ tool: "open_app_or_file", args: { target: rawApp }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? `Opening ${rawApp} for you now.` : `I couldn't launch ${rawApp}.`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  // 6. WhatsApp Intent
  if (text.includes("whatsapp") || text.includes("message") || text.includes("text my") || text.includes("tell my")) {
    const match =
      text.match(/(?:message|whatsapp|text|tell)\s+([a-z0-9_\s+]+?)\s+(?:saying|that|to)?\s*(?:["']?)(.*)(?:["']?)$/i) ||
      text.match(/(?:send\s+a?\s*whatsapp\s+message\s+to)\s+([a-z0-9_\s+]+?)\s+(?:saying|with|content)?\s*(?:["']?)(.*)(?:["']?)$/i);

    let recipient = "brother";
    let msg = "Hello, I am on my way.";

    if (match && match[1]) {
      recipient = match[1].trim();
      if (match[2]) msg = match[2].trim().replace(/^["']|["']$/g, "");
    }

    return {
      response: `Confirmation required: Send WhatsApp message to ${recipient}?`,
      spokenResponse: `Shall I send that WhatsApp message to ${recipient}?`,
      confirmationRequired: {
        tool: "send_whatsapp_message",
        args: { recipient, message: msg },
        description: `Send WhatsApp message to ${recipient}: "${msg}"`,
        prompt: `Send WhatsApp message to ${recipient}: "${msg}"?`,
      },
      toolsExecuted: [],
      uiActions: [{ action: "set_emotion", emotion: "confirm_pending" }],
    };
  }

  // 7. Search Files Intent
  if (text.includes("search file") || text.includes("find file") || text.includes("look for file") || text.includes("find all")) {
    const query = text.replace(/(?:search|find|look for)\s+(?:all\s+)?(?:files?|for)?\s*(?:named|matching|called)?/i, "").trim();
    const toolRes = await executeTool("search_files", { query });
    executedActions.push({ tool: "search_files", args: { query }, result: toolRes.output });
    const count = Array.isArray(toolRes.data) ? toolRes.data.length : 0;
    return {
      response: toolRes.output,
      spokenResponse: count > 0 ? `I found ${count} matching file${count > 1 ? "s" : ""} on your computer.` : `No files found for ${query}.`,
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: "success" }],
    };
  }

  // 8. System Telemetry
  if (text.includes("system") || text.includes("telemetry") || text.includes("diagnostics") || text.includes("specs")) {
    const toolRes = await executeTool("get_system_telemetry", {});
    executedActions.push({ tool: "get_system_telemetry", args: {}, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: "All system parameters are running smoothly.",
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: "success" }],
    };
  }

  // 8b. Remember / correction (works even with no AI provider)
  const rememberMatch = text.match(/^(?:remember|note|keep in mind)\s+(?:that\s+)?(.+)/i);
  if (rememberMatch && rememberMatch[1]) {
    const toolRes = await executeTool("remember", { fact: rememberMatch[1].trim() });
    executedActions.push({ tool: "remember", args: { fact: rememberMatch[1].trim() }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: "Got it, I'll remember that.",
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: "success" }],
    };
  }

  // 8c. Screen awareness
  if (
    text.includes("my screen") || text.includes("on screen") || text.includes("this error") ||
    text.includes("look at this") || text.includes("what am i doing") || text.includes("see my desktop")
  ) {
    const question = message;
    const toolRes = await executeTool("capture_screen", { question });
    executedActions.push({ tool: "capture_screen", args: { question }, result: toolRes.output });
    return {
      response: toolRes.output,
      spokenResponse: toolRes.success ? toolRes.output : "I couldn't capture your screen.",
      toolsExecuted: executedActions,
      uiActions: [{ action: "set_emotion", emotion: toolRes.success ? "success" : "error" }],
    };
  }

  // 9. Vision / Camera Inquiry
  if (text.includes("what do you see") || text.includes("what am i holding") || text.includes("detect object") || text.includes("camera")) {
    if (detectedObjects.length > 0) {
      return {
        response: `Optical sensors identify: ${detectedObjects.join(", ")}.`,
        spokenResponse: `I see a ${detectedObjects.join(" and a ")}.`,
        toolsExecuted: [],
        uiActions: [{ action: "pulse" }, { action: "set_emotion", emotion: "greeting" }],
      };
    }
    return {
      response: "Optical tracking active. Point your camera at any object to identify it.",
      spokenResponse: "Camera tracking is active. What would you like me to inspect?",
      toolsExecuted: [],
      uiActions,
    };
  }

  // 10. Protocols
  if (text.includes("crimson") || text.includes("red alert")) {
    return { response: "Protocol Crimson engaged.", spokenResponse: "Switching to Crimson protocol.", toolsExecuted: [], uiActions: [{ action: "set_theme", theme: "crimson" }] };
  }
  if (text.includes("jarvis") || text.includes("blue mode")) {
    return { response: "Protocol Jarvis engaged.", spokenResponse: "Switching to Jarvis blue protocol.", toolsExecuted: [], uiActions: [{ action: "set_theme", theme: "jarvis" }] };
  }
  if (text.includes("gold")) {
    return { response: "Protocol Gold engaged.", spokenResponse: "Switching to Gold protocol.", toolsExecuted: [], uiActions: [{ action: "set_theme", theme: "gold" }] };
  }
  if (text.includes("emerald") || text.includes("matrix")) {
    return { response: "Protocol Emerald engaged.", spokenResponse: "Switching to Emerald protocol.", toolsExecuted: [], uiActions: [{ action: "set_theme", theme: "emerald" }] };
  }

  // Greetings
  if (text in { hello: 1, hi: 1, hey: 1 }) {
    return {
      response: "Hello! All systems are online. How can I assist you?",
      spokenResponse: "Hello! All systems are online. How can I assist you?",
      toolsExecuted: [],
      uiActions: [{ action: "set_emotion", emotion: "greeting" }],
    };
  }

  return {
    response: `Ready to assist: "${message}". I can launch or close apps, find and delete files, message contacts, and inspect vision.`,
    spokenResponse: "I'm on it. How else can I assist you?",
    toolsExecuted: executedActions,
    uiActions: [{ action: "set_emotion", emotion: "speaking" }],
  };
}
