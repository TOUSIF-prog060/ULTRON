#!/usr/bin/env node

/**
 * U.L.T.R.O.N. terminal client
 *
 *   Terminal 1:  npm run dev      (the ULTRON server — this is what has
 *                                  full access to your computer)
 *   Terminal 2:  npm run cli      (this — a text chat front-end to it)
 *
 * All the real power (opening apps/files, driving the browser, closing
 * windows, screenshots, memory) lives in the server's API routes, which
 * run natively on Windows. This file just sends your typed lines there
 * and speaks the reply. Run it in a normal PowerShell / CMD window — not
 * WSL, not Docker.
 */

import readline from "node:readline";
import { exec } from "node:child_process";

const API = process.env.ULTRON_API_URL || "http://localhost:3000/api/chat";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let history = [];
let muted = process.argv.includes("--mute");

function speak(text) {
  const clean = String(text || "").replace(/[*#`_>\[\]]/g, "").trim();
  if (!clean) return;
  console.log(`\n${CYAN}[ULTRON]${RESET} ${clean}\n`);
  if (!muted && process.platform === "win32") {
    const escaped = clean.replace(/'/g, "''");
    exec(`powershell -NoProfile -Command "(New-Object -ComObject SAPI.SpVoice).Speak('${escaped}')"`);
  }
}

async function callApi(payload) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${YELLOW}ULTRON >${RESET} `,
});

function ask(q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function handle(text) {
  if (!text) return;
  rl.pause();
  try {
    await handleInner(text);
  } finally {
    rl.resume();
  }
}

async function handleInner(text) {
  let data;
  try {
    data = await callApi({ message: text, history });
  } catch {
    console.log(
      `\n${RED}Can't reach the ULTRON server at ${API}${RESET}\n` +
        `${DIM}Start it first in another terminal:  npm run dev${RESET}\n`
    );
    return;
  }

  // Guarded action (delete / close app / WhatsApp) — confirm in the terminal.
  if (data.confirmationRequired) {
    const c = data.confirmationRequired;
    const answer = (await ask(`\n${YELLOW}⚠ ${c.prompt} [y/N] ${RESET}`)).trim().toLowerCase();
    if (answer === "y" || answer === "yes") {
      try {
        data = await callApi({ confirmedAction: c });
      } catch {
        console.log(`${RED}Server went away during confirmation.${RESET}`);
        return;
      }
    } else {
      speak("Cancelled.");
      return;
    }
  }

  const reply = data.response || "Done.";
  speak(reply);

  if (Array.isArray(data.toolsExecuted) && data.toolsExecuted.length) {
    console.log(`${DIM}  ⚙ ${data.toolsExecuted.map((t) => t.tool).join(", ")}${RESET}`);
  }
  if (data.provider) console.log(`${DIM}  brain: ${data.provider}${RESET}`);

  history.push({ role: "user", text }, { role: "model", text: reply });
  if (history.length > 20) history = history.slice(-20);
}

console.log(`
${CYAN}=====================================================
         U.L.T.R.O.N. TERMINAL CORE ONLINE
=====================================================${RESET}
${DIM}Server: ${API}
Type a directive. Examples:
  open chrome            find all pdfs on my desktop
  play lofi on youtube   what's on my screen
  remember that ...      research the latest on ...
Commands:  mute | unmute | clear | exit
${RESET}`);

speak("Ultron terminal online.");
rl.prompt();

// Serialize lines so pasting several commands at once runs them in order.
const queue = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const clean = queue.shift();
    const lower = clean.toLowerCase();
    if (lower === "exit" || lower === "quit") { speak("Shutting down."); rl.close(); return; }
    if (lower === "mute") { muted = true; console.log(`${DIM}voice off${RESET}`); continue; }
    if (lower === "unmute") { muted = false; console.log(`${DIM}voice on${RESET}`); continue; }
    if (lower === "clear") { history = []; console.log(`${DIM}context cleared${RESET}`); continue; }
    await handle(clean);
  }
  draining = false;
  rl.prompt();
}

rl.on("line", (line) => {
  const clean = line.trim();
  if (clean) queue.push(clean);
  void drain();
}).on("close", () => {
  console.log("\nExiting ULTRON.");
  process.exit(0);
});
