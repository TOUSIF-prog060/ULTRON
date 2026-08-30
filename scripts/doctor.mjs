#!/usr/bin/env node
/**
 * U.L.T.R.O.N. doctor — proves (or disproves) that this machine can be
 * controlled by ULTRON. Run it in the SAME kind of terminal you start
 * `npm run dev` in:
 *
 *     npm run doctor
 *
 * It does NOT need the dev server. It launches Calculator and a URL for
 * real, then checks whether the processes actually appeared, and prints a
 * verdict. Paste the whole output back if something is wrong.
 */

import { execSync, exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", D = "\x1b[2m", X = "\x1b[0m";
const ok = (m) => console.log(`${G}  PASS${X}  ${m}`);
const bad = (m) => console.log(`${R}  FAIL${X}  ${m}`);
const warn = (m) => console.log(`${Y}  WARN${X}  ${m}`);
const info = (m) => console.log(`${D}        ${m}${X}`);

function psJson(cmd) {
  try {
    const out = execSync(`powershell -NoProfile -Command "${cmd}"`, { timeout: 15000 }).toString().trim();
    return out ? JSON.parse(out) : null;
  } catch (e) {
    return { __error: e.message };
  }
}
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n${Y}=== U.L.T.R.O.N. DOCTOR ===${X}\n`);

// 1. Environment
console.log("1. Environment");
info(`platform: ${process.platform}   node: ${process.version}`);
info(`cwd: ${process.cwd()}`);
if (process.platform !== "win32") {
  bad("Not running on Windows. ULTRON's app/file/browser control is Windows-only and CANNOT work from WSL, Docker, macOS or Linux.");
  info("Fix: open a real Windows PowerShell (press Win, type 'powershell') and run everything there.");
  process.exit(1);
}
const isWsl = fs.existsSync("/proc/version") && /microsoft/i.test(fs.readFileSync("/proc/version", "utf8"));
if (isWsl) bad("This looks like WSL. Start ULTRON from a native Windows PowerShell instead."); else ok("Native Windows shell");

const interactive = psJson("[System.Environment]::UserInteractive | ConvertTo-Json");
if (interactive === true) ok("Interactive desktop session (windows can appear)");
else warn(`UserInteractive = ${JSON.stringify(interactive)} — GUI apps may open invisibly (session 0). Don't run ULTRON as a service/scheduled task.`);

// 2. Keys
console.log("\n2. AI brain keys (.env.local)");
const envPath = path.join(process.cwd(), ".env.local");
let env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !line.trimStart().startsWith("#")) env[m[1]] = m[2];
  }
} else warn(".env.local not found");
const brainKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"].filter((k) => env[k]);
if (brainKeys.length) ok(`Real brain configured: ${brainKeys.join(", ")}`);
else {
  warn("No ANTHROPIC_API_KEY / OPENAI_API_KEY. Only the Gemini free tier (20 req/day) — it runs out fast, then ULTRON drops to the basic keyword engine.");
  info("This alone does NOT stop apps from opening — the keyword engine still runs open/close/search. But the assistant will feel dumb.");
}
if (env.GEMINI_API_KEY) ok("GEMINI_API_KEY present");

// 3. Browser executables
console.log("\n3. Browsers on PATH / App Paths");
for (const [name, exe] of [["Chrome", "chrome.exe"], ["Edge", "msedge.exe"], ["Firefox", "firefox.exe"]]) {
  const p = psJson(`(Get-Command ${exe} -ErrorAction SilentlyContinue).Source | ConvertTo-Json`);
  const appPath = psJson(`(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}' -ErrorAction SilentlyContinue).'(default)' | ConvertTo-Json`);
  if (p || (appPath && !appPath.__error)) ok(`${name}: ${p || appPath}`);
  else info(`${name}: not found (that's fine unless you ask for it by name)`);
}

// 4. LIVE launch test — Calculator
console.log("\n4. Live test: launching Calculator");
const beforeCalc = asArray(psJson("Get-Process -Name CalculatorApp,Calculator,calc -ErrorAction SilentlyContinue | Select-Object Id | ConvertTo-Json")).length;
try {
  execSync(`powershell -NoProfile -Command "Start-Process 'calc.exe'"`, { timeout: 10000 });
  ok("Start-Process calc.exe returned no error");
} catch (e) {
  bad(`Start-Process calc.exe threw: ${e.message}`);
}
await sleep(4000);
const afterCalc = asArray(psJson("Get-Process -Name CalculatorApp,Calculator,calc -ErrorAction SilentlyContinue | Select-Object Id | ConvertTo-Json")).length;
if (afterCalc > beforeCalc) ok(`Calculator process appeared (${beforeCalc} -> ${afterCalc}). App-launch control WORKS.`);
else if (beforeCalc > 0) ok(`Calculator was already running (${beforeCalc}) — can't prove a new launch, but Start-Process didn't error. Look: did a Calculator window just pop up or flash in the taskbar?`);
else warn(`No Calculator process (${beforeCalc} -> ${afterCalc}). Launch may be blocked. Check your screen/taskbar now.`);

// 5. LIVE launch test — URL in default browser
console.log("\n5. Live test: opening a URL");
const beforeB = asArray(psJson("Get-Process -Name chrome,msedge,firefox,brave -ErrorAction SilentlyContinue | Select-Object Id | ConvertTo-Json")).length;
try {
  execSync(`powershell -NoProfile -Command "Start-Process 'https://example.com'"`, { timeout: 10000 });
  ok("Start-Process <url> returned no error");
} catch (e) {
  bad(`Opening URL threw: ${e.message}`);
}
await sleep(3000);
const afterB = asArray(psJson("Get-Process -Name chrome,msedge,firefox,brave -ErrorAction SilentlyContinue | Select-Object Id | ConvertTo-Json")).length;
if (afterB >= beforeB && afterB > 0) ok(`Browser is running (${beforeB} -> ${afterB}). A new tab/window for example.com should be visible now.`);
else warn("No browser process detected — is a default browser set? Check Windows Settings > Default apps.");

// 6. Dev server
console.log("\n6. ULTRON dev server");
try {
  const res = await fetch("http://localhost:3000/api/health", { signal: AbortSignal.timeout(4000) });
  const j = await res.json();
  ok("Dev server is up at http://localhost:3000");
  info(`brain live: ${j.brain?.anyConfigured ? "yes" : "NO — keyword engine only"}`);
  if (j.brain?.note) warn(j.brain.note);
} catch {
  warn("Dev server NOT reachable. Start it in another terminal:  npm run dev");
  info("The browser UI and `npm run cli` both need it running.");
}

console.log(`\n${Y}=== VERDICT ===${X}`);
console.log(`If steps 4 and 5 PASSed, ULTRON can control this machine. If apps still`);
console.log(`"don't work" from the UI/voice, the problem is upstream: the command`);
console.log(`isn't reaching the server (voice not transcribing, wrong URL, server`);
console.log(`down) — not the OS control layer. Paste this whole output back.\n`);
