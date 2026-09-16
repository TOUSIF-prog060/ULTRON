import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";

export interface AuditLogEntry {
  ts: string;
  tool: string;
  args: any;
  confirmed?: boolean;
  success: boolean;
  result: string;
}

export interface SafetyConfig {
  deniedPaths: string[];
  protectedProcesses: string[];
  requireConfirmationFor: string[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const SAFETY_CONFIG_PATH = path.join(DATA_DIR, "safety-config.json");
const AUDIT_LOG_PATH = path.join(DATA_DIR, "audit-log.jsonl");

// Default safety configuration — protects critical OS internals and repo system files from destruction
const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  deniedPaths: [
    "C:\\Windows\\System32",
    "C:\\Windows\\SysWOW64",
    path.join(process.cwd(), ".git"),
    path.join(process.cwd(), "node_modules"),
  ],
  protectedProcesses: [
    "explorer.exe",
    "csrss.exe",
    "winlogon.exe",
    "services.exe",
    "svchost.exe",
    "lsass.exe",
    "smss.exe",
    "dwm.exe",
    "System",
  ],
  requireConfirmationFor: [
    "delete_file",
    "close_app",
    "send_whatsapp_message",
  ],
};

// Ensure data directory and safety configuration exist
export function getSafetyConfig(): SafetyConfig {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(SAFETY_CONFIG_PATH)) {
      fs.writeFileSync(SAFETY_CONFIG_PATH, JSON.stringify(DEFAULT_SAFETY_CONFIG, null, 2), "utf-8");
      return DEFAULT_SAFETY_CONFIG;
    }
    const content = fs.readFileSync(SAFETY_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(content);

    // Clean up any legacy overly-broad denied paths (e.g. process.cwd or C:\Program Files)
    const cleanedDenied = (parsed.deniedPaths || []).filter((p: string) => {
      const low = p.toLowerCase();
      return (
        !low.includes("ultron-by-sagar-builds") &&
        low !== process.cwd().toLowerCase() &&
        !low.endsWith("appdata") &&
        !low.endsWith("program files") &&
        !low.endsWith("program files (x86)")
      );
    });

    if (cleanedDenied.length !== parsed.deniedPaths?.length) {
      parsed.deniedPaths = cleanedDenied.length > 0 ? cleanedDenied : DEFAULT_SAFETY_CONFIG.deniedPaths;
      fs.writeFileSync(SAFETY_CONFIG_PATH, JSON.stringify(parsed, null, 2), "utf-8");
    }

    return parsed;
  } catch (err) {
    console.error("Failed to read safety config, using defaults:", err);
    return DEFAULT_SAFETY_CONFIG;
  }
}

/**
 * Validates whether a file/directory path is allowed to be modified or deleted.
 */
export function isPathAllowed(targetPath: string): { allowed: boolean; reason?: string } {
  try {
    const config = getSafetyConfig();
    const resolved = path.resolve(targetPath);

    for (const denied of config.deniedPaths) {
      const resolvedDenied = path.resolve(denied);
      if (resolved.toLowerCase().startsWith(resolvedDenied.toLowerCase())) {
        return {
          allowed: false,
          reason: `Path is protected under system security rules: ${denied}`,
        };
      }
    }
    return { allowed: true };
  } catch (err: any) {
    return { allowed: false, reason: `Path resolution error: ${err.message}` };
  }
}

/**
 * Validates whether a process is safe to close/terminate.
 */
export function isProcessAllowed(processName: string): { allowed: boolean; reason?: string } {
  const config = getSafetyConfig();
  const clean = processName.toLowerCase().replace(/\.exe$/i, "");

  for (const protectedProc of config.protectedProcesses) {
    const cleanProtected = protectedProc.toLowerCase().replace(/\.exe$/i, "");
    if (clean === cleanProtected) {
      return {
        allowed: false,
        reason: `Process '${processName}' is a protected Windows core system process.`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Appends an entry to the append-only audit log.
 */
export function appendAuditLog(entry: Omit<AuditLogEntry, "ts">): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const logEntry: AuditLogEntry = {
      ts: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(logEntry) + "\n", "utf-8");
  } catch (err) {
    console.error("Failed to write to audit log:", err);
  }
}

/**
 * Moves a file or directory to the Windows Recycle Bin (soft delete).
 * Never permanently unlinks.
 */
export function softDeleteFile(targetPath: string): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    const fullPath = path.resolve(targetPath);
    if (!fs.existsSync(fullPath)) {
      return resolve({ success: false, message: `File not found: ${fullPath}` });
    }

    const check = isPathAllowed(fullPath);
    if (!check.allowed) {
      return resolve({ success: false, message: check.reason || "Operation denied." });
    }

    if (process.platform === "win32") {
      const escaped = fullPath.replace(/'/g, "''");
      const psCmd = `powershell -NoProfile -Command "$shell = New-Object -ComObject Shell.Application; $folder = $shell.Namespace((Split-Path '${escaped}')); $item = $folder.ParseName((Split-Path '${escaped}' -Leaf)); if ($item) { $item.InvokeVerb('delete'); exit 0 } else { exit 1 }"`;

      exec(psCmd, (err) => {
        if (!err && !fs.existsSync(fullPath)) {
          resolve({ success: true, message: `Moved to Recycle Bin: ${path.basename(fullPath)}` });
        } else {
          // Alternative fallback for PowerShell Recycle Bin
          const psFallback = `powershell -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')"`;
          exec(psFallback, (err2) => {
            if (!err2 && !fs.existsSync(fullPath)) {
              resolve({ success: true, message: `Moved to Recycle Bin: ${path.basename(fullPath)}` });
            } else {
              resolve({ success: false, message: `Could not move file to Recycle Bin: ${err2?.message || err?.message || "Unknown error"}` });
            }
          });
        }
      });
    } else {
      resolve({ success: false, message: "Soft-delete is configured for Windows OS." });
    }
  });
}
