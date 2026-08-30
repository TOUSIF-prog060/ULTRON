#!/usr/bin/env node

/**
 * U.L.T.R.O.N. Node.js Terminal Assistant
 * Run directly in terminal via: npm run cli  OR  node cli.js
 */

import readline from "readline";
import { executeTool } from "./lib/tools/executor.js";
import { exec } from "child_process";

function speak(text) {
  const clean = text.replace(/[*#`_>\[\]]/g, "").trim();
  if (!clean) return;

  console.log(`\n\x1b[36m[ULTRON]:\x1b[0m ${clean}`);

  if (process.platform === "win32") {
    const escaped = clean.replace(/"/g, '""').replace(/'/g, "''");
    exec(`powershell -Command "(New-Object -ComObject SAPI.SpVoice).Speak('${escaped}')"`);
  }
}

async function handleCommand(input) {
  const text = input.trim();
  if (!text) return;

  try {
    const res = await fetch("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    speak(data.response || "Task executed.");
  } catch {
    // If dev server isn't running, run tools directly
    const lower = text.toLowerCase();
    if (lower.startsWith("open ") || lower.startsWith("launch ")) {
      const target = lower.replace(/^(open|launch)\s+/i, "");
      const res = await executeTool("open_app_or_file", { target });
      speak(res.output);
    } else if (lower.includes("search") || lower.includes("google")) {
      const query = lower.replace(/^(search for|search|google)\s+/i, "");
      const res = await executeTool("search_web_or_browser", { query });
      speak(res.output);
    } else {
      speak(`Processing directive: "${text}".`);
    }
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "\x1b[33mULTRON > \x1b[0m",
});

console.log(`
=====================================================
         U.L.T.R.O.N. TERMINAL CORE ONLINE
  Direct System Access: Apps, Files, Browser, WhatsApp
=====================================================
Type any command (e.g. 'open chrome', 'search AI on google', 'message brother', 'exit')
`);

speak("Ultron terminal assistant online.");

rl.prompt();

rl.on("line", async (line) => {
  const clean = line.trim();
  if (clean.toLowerCase() === "exit" || clean.toLowerCase() === "quit") {
    speak("Shutting down Ultron.");
    process.exit(0);
  }

  await handleCommand(clean);
  rl.prompt();
}).on("close", () => {
  console.log("\nExiting Ultron.");
  process.exit(0);
});
