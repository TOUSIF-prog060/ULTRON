import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { findContact, getContacts } from "./contacts";
import {
  isPathAllowed,
  isProcessAllowed,
  softDeleteFile,
  appendAuditLog,
} from "./safety";
import {
  discoverInstalledApps,
  findAppInCatalog,
  listRunningApps,
  closeApp,
  switchToApp,
  recordSessionOpened,
  getMostRecentOpenedItem,
} from "./appDiscovery";
import {
  addFact,
  addCorrection,
  recall,
  setProfileKey,
} from "@/lib/memory/store";
import { captureScreenBase64, runReadonlyPowershell } from "./screen";
import { analyzeImage } from "@/lib/vision/analyze";
import { researchWeb } from "@/lib/research/perplexity";

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  data?: any;
  uiAction?: {
    action: string;
    [key: string]: any;
  };
}

const COMMON_APP_MAP: Record<string, string> = {
  chrome: "chrome",
  "google chrome": "chrome",
  edge: "msedge",
  msedge: "msedge",
  "microsoft edge": "msedge",
  browser: "msedge",
  firefox: "firefox",
  brave: "brave",
  notepad: "notepad",
  calc: "calc",
  calculator: "calc",
  paint: "mspaint",
  mspaint: "mspaint",
  cmd: "cmd",
  terminal: "wt",
  powershell: "powershell",
  code: "code",
  vscode: "code",
  "vs code": "code",
  "visual studio code": "code",
  cursor: "cursor",
  spotify: "spotify:",
  discord: "discord:",
  telegram: "shell:AppsFolder\\Telegram.TelegramDesktop",
  camera: "microsoft.windows.camera:",
  webcam: "microsoft.windows.camera:",
  settings: "ms-settings:",
  "windows settings": "ms-settings:",
  explorer: "explorer",
  "file explorer": "explorer",
  "my computer": "explorer",
  "this pc": "explorer",
  files: "explorer",
  taskmgr: "taskmgr",
  "task manager": "taskmgr",
  control: "control",
  "control panel": "control",
  word: "winword",
  "ms word": "winword",
  "microsoft word": "winword",
  excel: "excel",
  "ms excel": "excel",
  "microsoft excel": "excel",
  powerpoint: "powerpnt",
  ppt: "powerpnt",
  whatsapp: "https://web.whatsapp.com",
  youtube: "https://www.youtube.com",
  gmail: "https://mail.google.com",
  github: "https://github.com",
  chatgpt: "https://chatgpt.com",
};

/**
 * Resolves a file/directory path intelligently across Windows Desktop, Documents, Downloads, and Workspace
 */
export function resolveTargetFilePath(inputPath: string, forCreate = false): string {
  const trimmed = inputPath.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return path.join(os.homedir(), "Desktop");

  // If already an absolute path (e.g. C:\... or \\...)
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[/\\]/.test(trimmed)) {
    return path.resolve(trimmed);
  }

  // If path explicitly starts with ./ or ../, respect cwd relative
  if (trimmed.startsWith("./") || trimmed.startsWith(".\\") || trimmed.startsWith("../") || trimmed.startsWith("..\\")) {
    return path.resolve(trimmed);
  }

  const desktopDir = path.join(os.homedir(), "Desktop");
  const documentsDir = path.join(os.homedir(), "Documents");
  const downloadsDir = path.join(os.homedir(), "Downloads");

  if (forCreate) {
    // When creating without folder specifier, default to user's Desktop for high visibility
    if (!trimmed.includes("/") && !trimmed.includes("\\")) {
      return path.join(desktopDir, trimmed);
    }
    return path.resolve(desktopDir, trimmed);
  }

  // Check in user common folders
  const candidates = [
    path.join(desktopDir, trimmed),
    path.join(documentsDir, trimmed),
    path.join(downloadsDir, trimmed),
    path.resolve(trimmed),
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      return cand;
    }
  }

  return path.join(desktopDir, trimmed);
}

function escapeSendKeysText(str: string): string {
  return str.replace(/([+^%~(){}[\]])/g, "{$1}");
}

function parseSpecialKey(keyStr: string): string {
  const k = keyStr.toLowerCase().trim();
  const map: Record<string, string> = {
    enter: "{ENTER}",
    return: "{ENTER}",
    tab: "{TAB}",
    esc: "{ESC}",
    escape: "{ESC}",
    backspace: "{BACKSPACE}",
    bksp: "{BACKSPACE}",
    delete: "{DELETE}",
    del: "{DELETE}",
    space: " ",
    spacebar: " ",
    up: "{UP}",
    down: "{DOWN}",
    left: "{LEFT}",
    right: "{RIGHT}",
    home: "{HOME}",
    end: "{END}",
    pageup: "{PGUP}",
    pgup: "{PGUP}",
    pagedown: "{PGDN}",
    pgdn: "{PGDN}",
    f1: "{F1}",
    f2: "{F2}",
    f3: "{F3}",
    f4: "{F4}",
    f5: "{F5}",
    f6: "{F6}",
    f7: "{F7}",
    f8: "{F8}",
    f9: "{F9}",
    f10: "{F10}",
    f11: "{F11}",
    f12: "{F12}",
    "ctrl+c": "^c",
    "ctrl+v": "^v",
    "ctrl+a": "^a",
    "ctrl+s": "^s",
    "ctrl+z": "^z",
    "ctrl+y": "^y",
    "ctrl+x": "^x",
    "ctrl+f": "^f",
    "ctrl+w": "^w",
    "ctrl+t": "^t",
    "ctrl+n": "^n",
    "ctrl+shift+n": "^+n",
    "alt+f4": "%{F4}",
    "alt+tab": "%{TAB}",
  };

  if (map[k]) return map[k];
  if (k.startsWith("ctrl+") && k.length === 6) return `^${k[5]}`;
  if (k.startsWith("alt+") && k.length === 5) return `%${k[4]}`;
  if (k.startsWith("shift+") && k.length === 7) return `+${k[6]}`;

  return escapeSendKeysText(keyStr);
}

export function sendKeystrokes(keys: string): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      return resolve({ success: false, message: "Keystroke simulation is Windows-only." });
    }

    const escaped = keys.replace(/'/g, "''");
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
`;
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");
    exec(`powershell -NoProfile -EncodedCommand ${encoded}`, (err) => {
      if (err) {
        const wscript = `
$w = New-Object -ComObject WScript.Shell
$w.SendKeys('${escaped}')
`;
        const encW = Buffer.from(wscript, "utf16le").toString("base64");
        exec(`powershell -NoProfile -EncodedCommand ${encW}`, (err2) => {
          if (err2) resolve({ success: false, message: `Keystroke execution failed: ${err2.message}` });
          else resolve({ success: true, message: "Typed successfully." });
        });
      } else {
        resolve({ success: true, message: "Typed successfully." });
      }
    });
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function launchTarget(target: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!target) return resolve(false);

    if (process.platform === "win32") {
      // 1. Web URLs
      if (/^https?:\/\//i.test(target)) {
        const escaped = target.replace(/'/g, "''");
        exec(`powershell -NoProfile -Command "Start-Process '${escaped}'"`, (err) => {
          if (!err) return resolve(true);
          exec(`explorer.exe "${target}"`, (err2) => resolve(!err2));
        });
        return;
      }

      // 2. shell: or URI protocols
      if (/^shell:/i.test(target) || /^[a-zA-Z0-9.\-_]+:$/i.test(target) || /^[a-zA-Z0-9.\-_]+:\/\//i.test(target)) {
        exec(`explorer.exe "${target}"`, (err) => {
          if (!err) return resolve(true);
          const escaped = target.replace(/'/g, "''");
          exec(`powershell -NoProfile -Command "Start-Process '${escaped}'"`, (err2) => resolve(!err2));
        });
        return;
      }

      // 3. Existing file or directory path
      if (fs.existsSync(target)) {
        const full = path.resolve(target);
        exec(`explorer.exe "${full}"`, (err) => {
          if (!err) return resolve(true);
          const escaped = full.replace(/'/g, "''");
          exec(`powershell -NoProfile -Command "Start-Process -FilePath '${escaped}'"`, (err2) => resolve(!err2));
        });
        return;
      }

      // 4. App executables or commands
      const escaped = target.replace(/'/g, "''");
      const psCommand = `powershell -NoProfile -Command "try { Start-Process '${escaped}' -ErrorAction Stop } catch { Start-Process 'cmd.exe' @('/c', 'start', '\"\"', '${escaped}') -ErrorAction Stop }"`;
      exec(psCommand, (err) => {
        if (!err) return resolve(true);
        exec(`cmd.exe /c start "" "${target}"`, (err2) => {
          if (!err2) return resolve(true);
          exec(`explorer.exe "${target}"`, (err3) => resolve(!err3));
        });
      });
    } else if (process.platform === "darwin") {
      exec(`open "${target}"`, (err) => resolve(!err));
    } else {
      exec(`xdg-open "${target}"`, (err) => resolve(!err));
    }
  });
}

/**
 * Universal Tool Execution Dispatcher
 */
export async function executeTool(
  toolName: string,
  args: Record<string, any>
): Promise<ToolExecutionResult> {
  let result: ToolExecutionResult = { success: false, output: "Tool execution unhandled." };

  try {
    switch (toolName) {
      // 1. Web Search & Browser
      case "search_web_or_browser": {
        const query = String(args.query || "").trim();
        const engine = String(args.engine || "google").toLowerCase();
        let targetUrl = query;

        if (!query.startsWith("http://") && !query.startsWith("https://")) {
          if (engine === "youtube" || query.toLowerCase().includes("on youtube")) {
            const clean = query.replace(/on youtube/i, "").trim();
            targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(clean)}`;
          } else if (engine === "wikipedia" || query.toLowerCase().includes("on wikipedia")) {
            const clean = query.replace(/on wikipedia/i, "").trim();
            targetUrl = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(clean)}`;
          } else if (engine === "bing") {
            targetUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
          } else {
            targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
          }
        }

        const ok = await launchTarget(targetUrl);
        recordSessionOpened(targetUrl, "browser");
        result = {
          success: ok,
          output: ok ? `Opened web search for: "${query}"` : `Failed to open browser search for "${query}"`,
        };
        break;
      }

      // 2. Open App or File
      case "open_app_or_file": {
        const target = String(args.target || "").trim();
        const clean = target.toLowerCase().replace(/^(open|launch|start)\s+/i, "").trim();

        // A. Check direct existing file/folder
        const resolvedPath = resolveTargetFilePath(clean, false);
        if (fs.existsSync(resolvedPath)) {
          const ok = await launchTarget(resolvedPath);
          recordSessionOpened(resolvedPath, "file");
          result = {
            success: ok,
            output: ok ? `Opened: "${path.basename(resolvedPath)}"` : `Failed to open "${resolvedPath}"`,
          };
          break;
        }

        // B. Check common map
        if (COMMON_APP_MAP[clean]) {
          const mapped = COMMON_APP_MAP[clean];
          const ok = await launchTarget(mapped);
          recordSessionOpened(clean, "app");
          result = {
            success: ok,
            output: ok ? `Successfully launched: "${target}"` : `Failed to launch: "${target}"`,
          };
          break;
        }

        // C. Check dynamic installed & downloaded apps catalog
        const discovered = await findAppInCatalog(clean);
        if (discovered) {
          if (discovered.targetPath && fs.existsSync(discovered.targetPath)) {
            const ok = await launchTarget(discovered.targetPath);
            recordSessionOpened(discovered.name, "app");
            result = {
              success: ok,
              output: ok ? `Successfully launched ${discovered.name}` : `Failed to launch ${discovered.name}`,
            };
            break;
          }
          if (discovered.appId) {
            let launchCmd = discovered.appId;
            if (discovered.appId.startsWith("steam://") || discovered.appId.startsWith("http") || discovered.appId.includes(":\\")) {
              launchCmd = discovered.appId;
            } else {
              launchCmd = `shell:AppsFolder\\${discovered.appId}`;
            }
            const ok = await launchTarget(launchCmd);
            recordSessionOpened(discovered.name, "app");
            result = {
              success: ok,
              output: ok ? `Successfully launched ${discovered.name}` : `Failed to launch ${discovered.name}`,
            };
            break;
          }
        }

        // D. Try fuzzy matching file search across Desktop/Documents/Downloads
        const searchMatches = await searchFilesInternal(clean, undefined, 1);
        if (searchMatches.length > 0 && fs.existsSync(searchMatches[0])) {
          const fileMatch = searchMatches[0];
          const ok = await launchTarget(fileMatch);
          recordSessionOpened(fileMatch, "file");
          result = {
            success: ok,
            output: ok ? `Opened file: "${path.basename(fileMatch)}"` : `Failed to open file "${fileMatch}"`,
          };
          break;
        }

        // E. Fallback direct start
        const ok = await launchTarget(clean);
        recordSessionOpened(clean, "app");
        result = {
          success: ok,
          output: ok ? `Launched: "${target}"` : `Application or file '${target}' not found.`,
        };
        break;
      }


      // 3. Close App
      case "close_app": {
        const target = String(args.target || "").trim();
        const force = Boolean(args.force);
        const closeRes = await closeApp(target, force);
        result = {
          success: closeRes.success,
          output: closeRes.message,
        };
        break;
      }

      // 4. List Running Apps
      case "list_running_apps": {
        const apps = await listRunningApps();
        if (apps.length === 0) {
          result = { success: true, output: "No active application windows found." };
        } else {
          const formatted = apps.map((a) => `• ${a.processName} (PID ${a.pid}): "${a.windowTitle}"`).join("\n");
          result = {
            success: true,
            output: `Currently running application windows (${apps.length}):\n${formatted}`,
            data: apps,
          };
        }
        break;
      }

      // 5. Get Installed Apps
      case "get_installed_apps": {
        const apps = await discoverInstalledApps();
        const sample = apps.slice(0, 30).map((a) => `• ${a.name}`).join("\n");
        result = {
          success: true,
          output: `Installed Windows Applications (${apps.length} found):\n${sample}${apps.length > 30 ? "\n...and more" : ""}`,
          data: apps,
        };
        break;
      }

      // 6. Switch to App
      case "switch_to_app": {
        const target = String(args.target || "").trim();
        const switchRes = await switchToApp(target);
        result = {
          success: switchRes.success,
          output: switchRes.message,
        };
        break;
      }

      // 7. Open File (Fuzzy Finder)
      case "open_file": {
        const query = String(args.query || "").trim();
        const direct = resolveTargetFilePath(query, false);
        if (fs.existsSync(direct)) {
          const ok = await launchTarget(direct);
          recordSessionOpened(direct, "file");
          result = {
            success: ok,
            output: ok ? `Opened: "${path.basename(direct)}"` : `Failed to open ${direct}`,
          };
          break;
        }
        const searchRes = await searchFilesInternal(query, undefined, 5);
        if (searchRes.length > 0) {
          const best = searchRes[0];
          const ok = await launchTarget(best);
          recordSessionOpened(best, "file");
          result = {
            success: ok,
            output: ok ? `Opened: "${path.basename(best)}" (${best})` : `Failed to open ${best}`,
          };
        } else {
          result = {
            success: false,
            output: `Could not find any file matching "${query}".`,
          };
        }
        break;
      }

      // 8. Delete File (Soft Delete -> Recycle Bin)
      case "delete_file": {
        const targetPath = String(args.path || "").trim();
        const resolvedPath = resolveTargetFilePath(targetPath, false);
        const delRes = await softDeleteFile(resolvedPath);
        result = {
          success: delRes.success,
          output: delRes.message,
        };
        break;
      }

      // 9. Move / Rename File
      case "move_file": {
        const src = resolveTargetFilePath(String(args.source || "").trim(), false);
        const dest = resolveTargetFilePath(String(args.destination || "").trim(), true);

        const checkSrc = isPathAllowed(src);
        const checkDest = isPathAllowed(dest);

        if (!checkSrc.allowed) {
          result = { success: false, output: `Access denied for source: ${checkSrc.reason}` };
          break;
        }
        if (!checkDest.allowed) {
          result = { success: false, output: `Access denied for destination: ${checkDest.reason}` };
          break;
        }

        if (!fs.existsSync(src)) {
          result = { success: false, output: `Source file does not exist: ${src}` };
          break;
        }

        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        fs.renameSync(src, dest);
        result = {
          success: true,
          output: `Moved/Renamed '${path.basename(src)}' to '${dest}'.`,
        };
        break;
      }

      // 10. Create File
      case "create_file": {
        const targetPath = String(args.path || "").trim();
        const content = String(args.content || "");
        if (!targetPath) {
          result = { success: false, output: "No file path specified." };
          break;
        }
        const full = resolveTargetFilePath(targetPath, true);
        const check = isPathAllowed(full);
        if (!check.allowed) {
          result = { success: false, output: check.reason || "Path denied." };
          break;
        }
        const dir = path.dirname(full);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(full, content, "utf-8");
        result = {
          success: true,
          output: `Created file: "${full}"`,
          data: { path: full },
        };
        break;
      }

      // 11. Create Folder
      case "create_folder": {
        const targetPath = String(args.path || "").trim();
        if (!targetPath) {
          result = { success: false, output: "No folder path specified." };
          break;
        }
        const full = resolveTargetFilePath(targetPath, true);
        const check = isPathAllowed(full);
        if (!check.allowed) {
          result = { success: false, output: check.reason || "Path denied." };
          break;
        }
        fs.mkdirSync(full, { recursive: true });
        result = {
          success: true,
          output: `Created folder: "${full}"`,
          data: { path: full },
        };
        break;
      }

      // 12. Send WhatsApp Message
      case "send_whatsapp_message": {
        const recipient = String(args.recipient || "").trim();
        const message = String(args.message || "").trim();
        const contact = findContact(recipient);
        let phone = contact ? contact.phone : "";

        if (!phone && anyDigits(recipient)) {
          phone = recipient.replace(/\D/g, "");
        }

        if (!phone) {
          result = {
            success: false,
            output: `Could not find phone number for "${recipient}". Please configure contacts in data/contacts.json.`,
          };
          break;
        }

        const formattedPhone = phone.replace(/^\+/, "");
        const waUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(formattedPhone)}&text=${encodeURIComponent(message)}`;
        const ok = await launchTarget(waUrl);
        recordSessionOpened(waUrl, "browser");
        result = {
          success: ok,
          output: ok
            ? `Opened WhatsApp to message ${contact ? contact.name : recipient} (${phone}): "${message}"`
            : "Failed to launch WhatsApp link.",
        };
        break;
      }

      // 13. Search Files
      case "search_files": {
        const query = String(args.query || "");
        const dir = args.directory ? String(args.directory) : undefined;
        const max = Number(args.max_results) || 15;
        const matches = await searchFilesInternal(query, dir, max);
        result = {
          success: true,
          output: matches.length > 0
            ? `Found ${matches.length} matching item(s):\n${matches.join("\n")}`
            : `No matching files found for: "${query}"`,
          data: matches,
        };
        break;
      }

      // 14. Read File
      case "read_file": {
        const rawPath = String(args.path || "").trim();
        if (!rawPath) {
          result = { success: false, output: "No file path specified." };
          break;
        }
        let filePath = resolveTargetFilePath(rawPath, false);
        if (!fs.existsSync(filePath)) {
          const matches = await searchFilesInternal(rawPath, undefined, 1);
          if (matches.length > 0 && fs.existsSync(matches[0])) {
            filePath = matches[0];
          } else {
            result = { success: false, output: `File not found: ${rawPath}` };
            break;
          }
        }
        const check = isPathAllowed(filePath);
        if (!check.allowed && filePath.toLowerCase().includes("windows\\system32")) {
          result = { success: false, output: check.reason || "Reading restricted path." };
          break;
        }
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          result = { success: false, output: `Target path is a directory: ${filePath}` };
          break;
        }
        const maxLines = Number(args.max_lines) || 100;
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").slice(0, maxLines).join("\n");
        result = {
          success: true,
          output: `[File: ${filePath}]\n${lines}${content.split("\n").length > maxLines ? `\n... (truncated at ${maxLines} lines)` : ""}`,
          data: { path: filePath },
        };
        break;
      }

      // 15. List Directory
      case "list_directory": {
        const dirPath = path.resolve(args.path ? String(args.path) : process.cwd());
        if (!fs.existsSync(dirPath)) {
          result = { success: false, output: `Directory not found: ${dirPath}` };
          break;
        }
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        const list = items.slice(0, 50).map((i) => (i.isDirectory() ? `[DIR]  ${i.name}` : `[FILE] ${i.name}`)).join("\n");
        result = {
          success: true,
          output: `Directory: ${dirPath} (${items.length} items):\n${list}`,
        };
        break;
      }

      // 16. System Telemetry
      case "get_system_telemetry": {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const uptimeHours = (os.uptime() / 3600).toFixed(1);

        result = {
          success: true,
          output: [
            `OS: ${os.type()} ${os.release()} (${os.arch()})`,
            `Hostname: ${os.hostname()}`,
            `CPU: ${cpus.length} Cores - ${cpus[0]?.model || "Unknown"}`,
            `RAM: ${(usedMem / 1024 ** 3).toFixed(1)} GB / ${(totalMem / 1024 ** 3).toFixed(1)} GB (${Math.round((usedMem / totalMem) * 100)}% in use)`,
            `System Uptime: ${uptimeHours} hours`,
          ].join("\n"),
        };
        break;
      }

      // 17. Orb UI Control
      case "control_orb_interface": {
        const action = String(args.action || "pulse");
        const theme = args.theme ? String(args.theme) : undefined;
        const emotion = args.emotion ? String(args.emotion) : undefined;
        result = {
          success: true,
          output: `UI Command executed: ${action}${theme ? ` (Theme: ${theme})` : ""}${emotion ? ` (Emotion: ${emotion})` : ""}`,
          uiAction: { action, theme, emotion },
        };
        break;
      }

      // 17b. Live web research (Perplexity)
      case "research_web": {
        const query = String(args.query || "").trim();
        if (!query) { result = { success: false, output: "No research query." }; break; }
        try {
          const r = await researchWeb(query);
          const cites = r.citations.length ? `\n\nSources:\n${r.citations.slice(0, 5).map((c) => `• ${c}`).join("\n")}` : "";
          result = { success: true, output: `${r.answer}${cites}`, data: r };
        } catch (err: any) {
          result = { success: false, output: `Research failed: ${err.message || String(err)}` };
        }
        break;
      }

      // 18. Memory — remember a fact
      case "remember": {
        const fact = String(args.fact || "").trim();
        if (!fact) { result = { success: false, output: "Nothing to remember." }; break; }
        const tags = String(args.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
        const saved = addFact(fact, { tags, source: "user" });
        result = { success: true, output: `Committed to long-term memory: "${saved.text}"` };
        break;
      }

      // 19. Memory — record a correction
      case "record_correction": {
        const mistake = String(args.mistake || "").trim();
        const correction = String(args.correction || "").trim();
        if (!mistake || !correction) { result = { success: false, output: "Need both the mistake and the correct behaviour." }; break; }
        addCorrection(mistake, correction, args.context ? String(args.context) : undefined);
        result = { success: true, output: `Noted. I won't repeat that — from now on: ${correction}` };
        break;
      }

      // 20. Memory — recall
      case "recall_memory": {
        const query = String(args.query || "").trim();
        const { facts, corrections } = recall(query, 8);
        if (facts.length === 0 && corrections.length === 0) {
          result = { success: true, output: `No stored memory about "${query}".` };
          break;
        }
        const parts: string[] = [];
        if (facts.length) parts.push("Facts:\n" + facts.map((f) => `• ${f.text}`).join("\n"));
        if (corrections.length) parts.push("Corrections:\n" + corrections.map((c) => `• ${c.mistake} → ${c.correction}`).join("\n"));
        result = { success: true, output: parts.join("\n\n"), data: { facts, corrections } };
        break;
      }

      // 21. Memory — set a profile key
      case "set_profile": {
        const key = String(args.key || "").trim();
        const value = String(args.value || "").trim();
        if (!key) { result = { success: false, output: "Profile key required." }; break; }
        setProfileKey(key, value);
        result = { success: true, output: `Profile updated: ${key} = ${value}` };
        break;
      }

      // 22. Screen capture + vision analysis
      case "capture_screen": {
        const question = String(args.question || "").trim();
        const prompt = question
          ? `You are ULTRON looking at a screenshot of the user's screen. Answer this concisely and practically: ${question}`
          : "You are ULTRON looking at a screenshot of the user's screen. Describe what the user is doing and anything notable (errors, dialogs, code) in 2-3 sentences.";
        try {
          const shot = await captureScreenBase64();
          const analysis = await analyzeImage(shot, prompt, { cache: false });
          result = { success: true, output: analysis.text, data: { provider: analysis.provider } };
        } catch (err: any) {
          result = { success: false, output: `Could not analyse the screen: ${err.message || String(err)}` };
        }
        break;
      }

      // 23. Read-only PowerShell inspection
      case "run_powershell": {
        const command = String(args.command || "").trim();
        if (!command) { result = { success: false, output: "No command given." }; break; }
        const psRes = await runReadonlyPowershell(command);
        result = { success: psRes.success, output: psRes.output };
        break;
      }

      // 24. Type Text
      case "type_text": {
        const text = String(args.text || "");
        const targetApp = args.target_app ? String(args.target_app).trim() : undefined;
        const pressEnter = Boolean(args.press_enter);

        if (!text) {
          result = { success: false, output: "No text specified to type." };
          break;
        }

        if (targetApp) {
          await switchToApp(targetApp);
          await sleep(400);
        }

        let formatted = escapeSendKeysText(text);
        if (pressEnter) {
          formatted += "{ENTER}";
        }

        const typeRes = await sendKeystrokes(formatted);
        result = {
          success: typeRes.success,
          output: typeRes.success
            ? `Typed: "${text}"${targetApp ? ` into ${targetApp}` : ""}${pressEnter ? " [Enter]" : ""}`
            : typeRes.message,
        };
        break;
      }

      // 25. Press Key
      case "press_key": {
        const key = String(args.key || "").trim();
        const targetApp = args.target_app ? String(args.target_app).trim() : undefined;
        const repeat = Math.min(20, Math.max(1, Number(args.repeat) || 1));

        if (!key) {
          result = { success: false, output: "No key specified to press." };
          break;
        }

        if (targetApp) {
          await switchToApp(targetApp);
          await sleep(400);
        }

        const singleKey = parseSpecialKey(key);
        const sequence = singleKey.repeat(repeat);

        const keyRes = await sendKeystrokes(sequence);
        result = {
          success: keyRes.success,
          output: keyRes.success
            ? `Pressed: '${key}'${repeat > 1 ? ` (${repeat}x)` : ""}${targetApp ? ` in ${targetApp}` : ""}`
            : keyRes.message,
        };
        break;
      }

      default:
        result = { success: false, output: `Unknown tool name: ${toolName}` };
    }
  } catch (err: any) {
    result = {
      success: false,
      output: `Tool execution exception in '${toolName}': ${err.message || String(err)}`,
    };
  }

  // Record into audit log (Phase 8)
  appendAuditLog({
    tool: toolName,
    args,
    success: result.success,
    result: result.output,
  });

  return result;
}

function anyDigits(str: string): boolean {
  return /\d/.test(str);
}

// Internal recursive file search with scoring
async function searchFilesInternal(query: string, rootDir?: string, maxResults = 15): Promise<string[]> {
  const q = query.toLowerCase().replace(/[*?]/g, "").trim();
  const searchRoots = rootDir
    ? [path.resolve(rootDir)]
    : [
        path.join(os.homedir(), "Desktop"),
        path.join(os.homedir(), "Documents"),
        path.join(os.homedir(), "Downloads"),
        process.cwd(),
      ];

  const results: string[] = [];

  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    walk(root, 0, 4);
    if (results.length >= maxResults) break;
  }

  function walk(current: string, depth: number, maxDepth: number) {
    if (depth > maxDepth || results.length >= maxResults) return;
    try {
      const items = fs.readdirSync(current, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.name === "node_modules" || item.name === "AppData") {
          continue;
        }
        const full = path.join(current, item.name);
        if (item.name.toLowerCase().includes(q)) {
          results.push(full);
          if (results.length >= maxResults) return;
        }
        if (item.isDirectory()) {
          walk(full, depth + 1, maxDepth);
        }
      }
    } catch {}
  }

  return results;
}
