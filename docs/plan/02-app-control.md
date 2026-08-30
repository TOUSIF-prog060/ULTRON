# Phase 2 — Application Control (launch / close / list *any* app)

## Goal

"Open Spotify", "open [any app you have installed, not just the ~20 in the current
hardcoded map]", "close Chrome", "what apps are running", "switch to Discord".

## Why the current implementation isn't enough

`APP_LAUNCH_MAP` in `lib/tools/executor.ts` (and duplicated in `cli.js` and
`ultron_terminal.py`) is a fixed dictionary of ~30 apps. Anything not in that
list falls through to `launchTarget(rawTarget)`, which only works if the raw
target happens to be a valid executable name/URL already on PATH — no real
"any app" support, and there's no close/kill/list capability at all.

## Dynamic app discovery

Replace the fixed map with a **discovered app catalog**, built once at startup
and refreshed periodically:

```powershell
Get-StartApps | Select-Object Name, AppID
```

This returns every Start Menu entry (both classic `.exe`/`.lnk` shortcuts and
UWP/Store apps) with a launchable `AppID` — `explorer.exe shell:AppsFolder\<AppID>`
launches any of them uniformly. Merge this with a small manual alias table for
the handful of apps whose voice-friendly name differs a lot from their Start
Menu name (kept from today's `APP_LAUNCH_MAP`, but now used purely as an alias
layer on top of discovery — not as the only source of truth).

Cache the catalog to `data/app-catalog.json`, refresh in the background (e.g. on
Ultron startup + every hour), so lookups are instant.

## Fuzzy resolution

Voice transcription of app names is noisy ("open v.s. code", "open discourse"
for Discord). Resolve the spoken target against the app catalog using the same
fuzzy scoring approach as file search (exact > startsWith > substring >
edit-distance), and fall back to the manual alias table, then to the raw
`Start-Process` attempt as today's last resort.

## New tools

| Tool | Behavior |
|---|---|
| `get_installed_apps` | Returns the discovered catalog (useful for "what apps do I have"). |
| `open_app_or_file` (upgrade) | Resolves against catalog + aliases + fuzzy match, records into the session-opened registry (shared with Phase 1). |
| `list_running_apps` | `Get-Process \| Where MainWindowTitle -ne ""` → friendly list of currently open windows/apps. |
| `close_app` | Finds matching running process by name or window title, sends a graceful close (`WM_CLOSE` via `taskkill /PID <pid>` without `/F` first), falls back to `/F` (force) only after a short timeout if it didn't close — reduces risk of killing an app mid-unsaved-work without at least trying the graceful path. |
| `switch_to_app` | Brings an already-running app's window to the foreground (e.g. via a small PowerShell `Add-Type` + `SetForegroundWindow` call, or the `nircmd`/`AutoHotkey`-style approach if we want to avoid inline C# — pick one implementation and keep it in one helper). |

## Confirmation

`close_app` (especially the forced/`taskkill /F` path) is a destructive-ish
action — closing something with unsaved work loses that work. Route it through
the Phase 8 confirmation gate by default ("Close Notepad? It might have unsaved
changes." → confirm), configurable off for apps the user marks as "always safe
to close" (e.g. browsers, media players) in settings.

## Acceptance criteria

- [ ] "Open [any app in your Start Menu, not just the current hardcoded 30]"
      launches it correctly.
- [ ] "What's running right now" lists actual open windows.
- [ ] "Close Spotify" gracefully closes it (or asks to confirm/force if it
      doesn't respond).
- [ ] Misheard app names ("open v s code") still resolve correctly via fuzzy
      matching against the real catalog.
