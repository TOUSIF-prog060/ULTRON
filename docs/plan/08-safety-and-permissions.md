# Cross-Cutting: Safety & Permissions System

Every risky feature in Phases 1–3 plugs into this one system, rather than each
implementing its own ad hoc safety logic. Build this alongside Phase 1 (file
access is the first place it's needed).

## Why this matters even for a personal single-user assistant

You asked for the assistant to "execute every possible task" and to be able to
delete files — that's a reasonable thing to want for your own machine, but a
voice/LLM-driven pipeline has two failure modes worth designing around from day
one rather than retrofitting later:

1. **Speech-to-text or LLM misinterpretation** — "delete the report" when you
   meant a different file with a similar name, or a misheard app name closing
   the wrong window.
2. **No manual "click Send" safety net anymore** once Phase 3 lands — today's
   WhatsApp deep-link accidentally already protects you by requiring a manual
   click; real automation removes that, so something has to replace it.

None of this is about distrust of you — it's about the same class of mistake a
human assistant would also want a "wait, confirm that?" moment for before
deleting something or messaging someone.

## The four pillars

### 1. Soft-delete only

No tool ever calls `fs.unlinkSync` or an equivalent permanent delete. Every
delete goes through the OS Recycle Bin (`trash` npm package or Shell COM call —
see [01-file-system-access.md](01-file-system-access.md)). This alone makes
almost any delete mistake fully recoverable in seconds.

### 2. Confirmation gate

A shared `requiresConfirmation` flag per tool (see
[04-voice-command-engine.md](04-voice-command-engine.md)), defaulting **on** for:
`delete_file`, `close_app` (forced/kill path), `whatsapp_send_message`,
`move_file`/`rename_file` when the destination overwrites an existing file.
Defaulting **off** for anything read-only (`search_files`, `read_file`,
`list_directory`, `get_installed_apps`, `list_running_apps`, `get_system_telemetry`)
and for `open_file`/`open_app_or_file` (opening things is low-risk and
reversible — just close it again).

You can turn confirmation off per action type in settings once you trust the
system, but the plan ships with it on by default for the four listed above.

### 3. Path & process deny-list

A single shared config (`data/safety-config.json`) listing directories that
`delete_file`/`move_file`/`rename_file`/`create_file` refuse to touch, e.g.:

```json
{
  "deniedPaths": [
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\Users\\<you>\\AppData",
    "<this project's own directory>"
  ],
  "protectedProcesses": ["explorer.exe", "csrss.exe", "winlogon.exe", "services.exe"]
}
```

Checked in the executor before any destructive filesystem or process action
runs — a request that resolves inside a denied path is refused with a clear
spoken reason ("I won't delete anything inside Windows system folders"), not a
silent no-op.

### 4. Audit log

Every tool call — guarded or not — appends one line to
`data/audit-log.jsonl`:

```json
{"ts":"2026-08-27T10:15:00Z","tool":"delete_file","args":{"path":"C:\\Users\\...\\report.docx"},"confirmed":true,"result":"moved to recycle bin"}
```

This is your single source of truth for "what did Ultron actually do" — cheap
to build (one `fs.appendFileSync` call in the executor's wrapper), and valuable
the first time something unexpected happens and you want to know why.

## Optional: kill switch

A single command — voice ("Ultron, stand down") or a UI button — that flips a
runtime flag disabling all guarded/destructive tools immediately, leaving only
read-only tools (search, open, telemetry) active until re-enabled. Cheap
insurance, not required for v1 but worth having before Phase 3 ships.

## What this plan deliberately does NOT restrict

Reading files, opening apps/files, web search, telemetry, and object/gesture
detection all stay frictionless with no confirmation — the safety system is
scoped specifically to actions that are hard to undo (permanent-feeling delete,
force-closing an app with unsaved work, sending a message to another person),
matching the same "reversible vs. hard-to-reverse" distinction used for any
assistant acting on your behalf.
