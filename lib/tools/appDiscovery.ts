import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { isProcessAllowed } from "./safety";

export interface DiscoveredApp {
  name: string;
  appId: string;
}

export interface RunningProcessInfo {
  pid: number;
  processName: string;
  windowTitle: string;
}

export interface SessionOpenedItem {
  target: string;
  type: "app" | "file" | "browser";
  openedAt: number;
  pid?: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const APP_CATALOG_PATH = path.join(DATA_DIR, "app-catalog.json");

// In-memory session registry for context resolution ("close that", "close it")
export const sessionOpenedRegistry: SessionOpenedItem[] = [];

export function recordSessionOpened(target: string, type: "app" | "file" | "browser", pid?: number) {
  sessionOpenedRegistry.unshift({
    target,
    type,
    openedAt: Date.now(),
    pid,
  });
  if (sessionOpenedRegistry.length > 25) {
    sessionOpenedRegistry.pop();
  }
}

export function getMostRecentOpenedItem(): SessionOpenedItem | undefined {
  return sessionOpenedRegistry[0];
}

/**
 * Discovers all installed Windows Start Menu & Store Apps using PowerShell Get-StartApps
 */
export async function discoverInstalledApps(): Promise<DiscoveredApp[]> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);

    // Check cached catalog if recently created
    if (fs.existsSync(APP_CATALOG_PATH)) {
      try {
        const stat = fs.statSync(APP_CATALOG_PATH);
        const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
        if (ageHours < 24) {
          const cached = JSON.parse(fs.readFileSync(APP_CATALOG_PATH, "utf-8"));
          if (Array.isArray(cached) && cached.length > 0) {
            return resolve(cached);
          }
        }
      } catch {}
    }

    const psCmd = `powershell -NoProfile -Command "Get-StartApps | ConvertTo-Json -Compress"`;
    exec(psCmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        return resolve([]);
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const apps: DiscoveredApp[] = [];
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.Name && item.AppID) {
              apps.push({ name: item.Name, appId: item.AppID });
            }
          }
        } else if (parsed.Name && parsed.AppID) {
          apps.push({ name: parsed.Name, appId: parsed.AppID });
        }

        // Cache to data/app-catalog.json
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(APP_CATALOG_PATH, JSON.stringify(apps, null, 2), "utf-8");
        resolve(apps);
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Finds a matching installed app by fuzzy name
 */
export async function findAppInCatalog(query: string): Promise<DiscoveredApp | null> {
  const apps = await discoverInstalledApps();
  const clean = query.toLowerCase().trim();

  // 1. Exact match
  const exact = apps.find((a) => a.name.toLowerCase() === clean);
  if (exact) return exact;

  // 2. Starts with
  const startsWith = apps.find((a) => a.name.toLowerCase().startsWith(clean));
  if (startsWith) return startsWith;

  // 3. Includes
  const includes = apps.find((a) => a.name.toLowerCase().includes(clean));
  if (includes) return includes;

  return null;
}

/**
 * Lists all running applications with visible windows on the system
 */
export function listRunningApps(): Promise<RunningProcessInfo[]> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);

    const psCmd = `powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress"`;
    exec(psCmd, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        return resolve([]);
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const procs: RunningProcessInfo[] = [];
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.Id && item.ProcessName) {
              procs.push({
                pid: item.Id,
                processName: item.ProcessName,
                windowTitle: item.MainWindowTitle || "",
              });
            }
          }
        } else if (parsed.Id && parsed.ProcessName) {
          procs.push({
            pid: parsed.Id,
            processName: parsed.ProcessName,
            windowTitle: parsed.MainWindowTitle || "",
          });
        }
        resolve(procs);
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Closes an application gracefully or forcefully
 */
export async function closeApp(
  target: string,
  force = false
): Promise<{ success: boolean; message: string }> {
  const procs = await listRunningApps();
  const clean = target.toLowerCase().trim();

  let match = procs.find(
    (p) =>
      p.processName.toLowerCase() === clean ||
      p.processName.toLowerCase().includes(clean) ||
      p.windowTitle.toLowerCase().includes(clean)
  );

  // If "that" or "it", use session registry
  if ((clean === "that" || clean === "it" || clean === "last") && sessionOpenedRegistry.length > 0) {
    const last = sessionOpenedRegistry[0];
    match = procs.find(
      (p) =>
        p.processName.toLowerCase().includes(last.target.toLowerCase()) ||
        p.windowTitle.toLowerCase().includes(last.target.toLowerCase())
    );
  }

  if (!match) {
    // If not found in open windows, attempt taskkill by process name directly
    const check = isProcessAllowed(clean);
    if (!check.allowed) {
      return { success: false, message: check.reason || "Closing this process is restricted." };
    }
    return new Promise((resolve) => {
      const flag = force ? "/F" : "";
      exec(`taskkill /IM "${clean}.exe" ${flag} /T`, (err) => {
        if (!err) {
          resolve({ success: true, message: `Closed application: ${clean}` });
        } else {
          resolve({ success: false, message: `Could not find running process '${clean}'.` });
        }
      });
    });
  }

  const check = isProcessAllowed(match.processName);
  if (!check.allowed) {
    return { success: false, message: check.reason || "Process is protected." };
  }

  return new Promise((resolve) => {
    const flag = force ? "/F" : "";
    exec(`taskkill /PID ${match!.pid} ${flag} /T`, (err) => {
      if (!err) {
        resolve({
          success: true,
          message: `Closed application '${match!.processName}' (Window: "${match!.windowTitle}").`,
        });
      } else {
        resolve({
          success: false,
          message: `Failed to terminate PID ${match!.pid}: ${err.message}`,
        });
      }
    });
  });
}

/**
 * Brings a running application window to the foreground
 */
export async function switchToApp(target: string): Promise<{ success: boolean; message: string }> {
  const procs = await listRunningApps();
  const clean = target.toLowerCase().trim();

  const match = procs.find(
    (p) =>
      p.processName.toLowerCase().includes(clean) ||
      p.windowTitle.toLowerCase().includes(clean)
  );

  if (!match) {
    return { success: false, message: `No active window found for '${target}'.` };
  }

  return new Promise((resolve) => {
    const psScript = `
      $code = @'
      using System;
      using System.Runtime.InteropServices;
      public class WinHelper {
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
      }
'@
      Add-Type -TypeDefinition $code
      $p = Get-Process -Id ${match.pid} -ErrorAction SilentlyContinue
      if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
        [WinHelper]::ShowWindowAsync($p.MainWindowHandle, 9)
        [WinHelper]::SetForegroundWindow($p.MainWindowHandle)
      }
    `;
    const escaped = psScript.replace(/"/g, '""');
    exec(`powershell -NoProfile -Command "${escaped}"`, (err) => {
      if (!err) {
        resolve({ success: true, message: `Switched to '${match.processName}' (${match.windowTitle}).` });
      } else {
        resolve({ success: false, message: `Failed to switch window: ${err.message}` });
      }
    });
  });
}
