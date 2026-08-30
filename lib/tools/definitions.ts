export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "OBJECT";
    properties: Record<string, {
      type: "STRING" | "NUMBER" | "BOOLEAN" | "ARRAY" | "OBJECT";
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  requiresConfirmation?: boolean;
}

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: "search_web_or_browser",
    description: "Open the default web browser and search for something on Google, YouTube, Wikipedia, or Bing, or open a specific website.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "The search query or URL (e.g. 'latest AI news', 'lofi music', 'https://github.com').",
        },
        engine: {
          type: "STRING",
          description: "Search engine to use (google, youtube, wikipedia, bing, duckduckgo). Defaults to google.",
          enum: ["google", "youtube", "wikipedia", "bing", "duckduckgo"],
        },
      },
      required: ["query"],
    },
  },
  {
    name: "open_app_or_file",
    description: "Launch any installed Windows application (e.g. Chrome, Edge, Notepad, Calculator, Spotify, VS Code, Paint, Discord, Settings, Explorer, Word, Excel) or open a file/folder.",
    parameters: {
      type: "OBJECT",
      properties: {
        target: {
          type: "STRING",
          description: "Application name (e.g. 'chrome', 'notepad', 'calculator', 'spotify', 'code', 'discord', 'settings') or file path.",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "close_app",
    description: "Close an open application or window on your computer (e.g. 'close Chrome', 'close Spotify', 'close Notepad', 'close that').",
    requiresConfirmation: true,
    parameters: {
      type: "OBJECT",
      properties: {
        target: {
          type: "STRING",
          description: "Application name or window title to close (e.g. 'notepad', 'chrome', 'spotify', 'that').",
        },
        force: {
          type: "BOOLEAN",
          description: "Force close if not responding (default: false).",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "list_running_apps",
    description: "List all currently open applications and active windows on the computer.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "get_installed_apps",
    description: "Discover and list all installed applications on the computer.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "switch_to_app",
    description: "Bring a running application or window to the foreground.",
    parameters: {
      type: "OBJECT",
      properties: {
        target: {
          type: "STRING",
          description: "Name of the running app or window title to bring to front (e.g. 'chrome', 'code', 'discord').",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "open_file",
    description: "Find and open a specific file (e.g. 'resume.pdf', 'report.docx', 'taxes.xlsx') with its default application.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "File name or description to find and open (e.g. 'resume', 'tax return', 'notes.txt').",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "delete_file",
    description: "Move a file or folder safely to the Windows Recycle Bin (soft delete). Never permanently unlinks.",
    requiresConfirmation: true,
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Path or name of the file/folder to move to the Recycle Bin.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "move_file",
    description: "Move or rename a file or folder on the local computer.",
    requiresConfirmation: true,
    parameters: {
      type: "OBJECT",
      properties: {
        source: {
          type: "STRING",
          description: "Source file or directory path.",
        },
        destination: {
          type: "STRING",
          description: "Destination file or directory path.",
        },
      },
      required: ["source", "destination"],
    },
  },
  {
    name: "create_file",
    description: "Create a new text file or document on the local computer.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Target file path to create.",
        },
        content: {
          type: "STRING",
          description: "Initial content to write into the file (optional).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "create_folder",
    description: "Create a new directory/folder on the local computer.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Directory path to create.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "send_whatsapp_message",
    description: "Send a WhatsApp message to a contact name (e.g. 'brother', 'mom', 'Alex') or phone number.",
    requiresConfirmation: true,
    parameters: {
      type: "OBJECT",
      properties: {
        recipient: {
          type: "STRING",
          description: "Contact name (e.g. 'brother', 'mom') or direct phone number.",
        },
        message: {
          type: "STRING",
          description: "The message text to send.",
        },
      },
      required: ["recipient", "message"],
    },
  },
  {
    name: "search_files",
    description: "Search for files and directories on the local computer matching a pattern or keyword.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "File name keyword or pattern (e.g. '*.pdf', 'resume', 'budget.xlsx').",
        },
        directory: {
          type: "STRING",
          description: "Optional root directory. Defaults to user's home/workspace directory.",
        },
        max_results: {
          type: "NUMBER",
          description: "Maximum number of results (default: 15).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_file",
    description: "Read text contents of a file on the local computer.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "File path to read.",
        },
        max_lines: {
          type: "NUMBER",
          description: "Maximum lines to read (default: 100).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List files and subfolders in a specific directory on the computer.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Directory path to list. If empty, lists current directory.",
        },
      },
    },
  },
  {
    name: "get_system_telemetry",
    description: "Get real-time computer diagnostics including CPU load, memory usage, and uptime.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "research_web",
    description: "Get up-to-date, cited information from the live web (via Perplexity) for questions about current events, latest versions, prices, news, or anything you can't answer reliably from training. Returns a summarised answer with sources.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "The research question, phrased fully." },
      },
      required: ["query"],
    },
  },
  {
    name: "remember",
    description: "Save a durable fact to long-term memory so it persists across sessions (e.g. the user's name, their main project, a preference, where files live). Use whenever the user says 'remember that…', 'note that…', or states a lasting preference.",
    parameters: {
      type: "OBJECT",
      properties: {
        fact: { type: "STRING", description: "The fact to remember, phrased so it makes sense out of context later." },
        tags: { type: "STRING", description: "Optional comma-separated tags for retrieval (e.g. 'preference,ui')." },
      },
      required: ["fact"],
    },
  },
  {
    name: "record_correction",
    description: "Record a mistake ULTRON made and the correct behaviour, so it is never repeated. Use whenever the user corrects you ('no, I meant…', 'that's wrong', 'don't do that, do this').",
    parameters: {
      type: "OBJECT",
      properties: {
        mistake: { type: "STRING", description: "What ULTRON did wrong or misunderstood." },
        correction: { type: "STRING", description: "What the correct action / understanding should have been." },
        context: { type: "STRING", description: "Optional short note on when this applies." },
      },
      required: ["mistake", "correction"],
    },
  },
  {
    name: "recall_memory",
    description: "Search long-term memory for facts and past corrections relevant to a topic before answering a question that might depend on earlier context.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "What to look up in memory." },
      },
      required: ["query"],
    },
  },
  {
    name: "set_profile",
    description: "Set a stable key/value on the user's profile (name, timezone, primary drive, coding language, etc.). Overwrites any previous value for that key.",
    parameters: {
      type: "OBJECT",
      properties: {
        key: { type: "STRING", description: "Profile field name, e.g. 'name', 'primary_drive', 'editor'." },
        value: { type: "STRING", description: "Value to store." },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "capture_screen",
    description: "Take a screenshot of the user's screen and analyse it with vision so you can help with whatever is currently on screen (errors, UI, documents, code). Use when the user says 'look at my screen', 'what's this error', 'help me with what I'm doing', 'can you see this'.",
    parameters: {
      type: "OBJECT",
      properties: {
        question: { type: "STRING", description: "What the user wants to know about the screen (optional; defaults to a general description)." },
      },
    },
  },
  {
    name: "run_powershell",
    description: "Run a short, read-only PowerShell command to inspect system state the other tools don't cover (installed drivers, network config, disk space, environment variables, process details). Never destructive — for anything that changes the system, describe it and ask first.",
    parameters: {
      type: "OBJECT",
      properties: {
        command: { type: "STRING", description: "The PowerShell command (read-only, e.g. 'Get-PSDrive', 'Get-NetIPAddress')." },
      },
      required: ["command"],
    },
  },
  {
    name: "control_orb_interface",
    description: "Control the 3D holographic orb visual theme, emotion state, and animation.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: {
          type: "STRING",
          description: "The action to perform.",
          enum: ["set_theme", "set_emotion", "pulse", "auto_spin", "stop_spin", "zoom_in", "zoom_out", "reset", "toggle_camera"],
        },
        theme: {
          type: "STRING",
          description: "Theme id when action is 'set_theme' (crimson, jarvis, gold, emerald, amethyst, ice).",
          enum: ["crimson", "jarvis", "gold", "emerald", "amethyst", "ice"],
        },
        emotion: {
          type: "STRING",
          description: "Emotion state when action is 'set_emotion' (idle, listening, thinking, speaking, executing, greeting, success, error, confirm_pending).",
          enum: ["idle", "listening", "thinking", "speaking", "executing", "greeting", "success", "error", "confirm_pending"],
        },
      },
      required: ["action"],
    },
  },
];
