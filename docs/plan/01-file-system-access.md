# Phase 1 — File System Access (open / find / move / rename / delete)

## Goal

Voice commands like:
- "Open my resume" → finds and opens the best-matching file with its default app.
- "Find all PDFs about taxes" → fast fuzzy search across your whole indexed area.
- "Delete that file" / "Delete report.docx" → moves it to Recycle Bin, with confirmation.
- "Close that" → closes the file/app Ultron most recently opened.
- "Rename X to Y" / "Move X to Downloads" → basic file management.

## Why the current implementation isn't enough

`search_files` in `lib/tools/executor.ts` does a live recursive `fs.readdirSync`
walk (depth ≤ 4) every single call. That's fine for occasional use but:
- Slow on a large home directory / won't reach deeply nested files.
- No fuzzy matching — "open my resume" won't match `Resume_2026_Final.pdf` unless
  the word "resume" is a substring.
- No delete/move/rename tools exist at all.
- No concept of "the file I just opened" for follow-up commands like "close that".

## New tools

Add to `lib/tools/definitions.ts` + `lib/tools/executor.ts`:

| Tool | Behavior |
|---|---|
| `open_file` | Fuzzy-resolves a name/description to a path (via the index below), opens with `Start-Process` (default app). Records it in the **session-opened registry**. |
| `close_file` | Closes the window most recently opened by `open_file` for that resolved path (see "closing" below). Confirmable if it's not a self-opened window. |
| `delete_file` | **Always** moves to Recycle Bin (see "soft delete" below). Never a hard unlink. Requires confirmation (Phase 8 gate) unless the user has disabled that in settings. |
| `move_file` / `rename_file` | Standard `fs.renameSync`, resolved against the deny-list in Phase 8. |
| `create_file` / `create_folder` | Simple `fs.writeFileSync("")` / `fs.mkdirSync`. |
| `search_files` (upgrade) | Reads from the background index instead of walking live; fuzzy-ranked results. |

## Background file index (replaces live directory walking)

- A lightweight indexer (Node `fs.readdir` crawl on a timer, or `chokidar` watch
  for live updates) builds a flat list of `{ path, name, mtime, ext }` for a
  configurable set of root directories (default: `Desktop`, `Documents`,
  `Downloads`, `Pictures`, `Videos`, home dir top-level — **not** the whole `C:\`
  drive by default, that's slow and mostly system files anyway).
- Stored as a JSON file (`data/file-index.json`) or a small SQLite DB if the list
  grows large (thousands of files). JSON is enough to start.
- Rebuilt on a timer (e.g. every 10 minutes) or on-demand via a "reindex my files"
  voice command. `chokidar` live-watch is a nice-to-have, not required for v1.
- Fuzzy search over the index name field (simple scoring: exact > startsWith >
  substring > Levenshtein-distance-below-threshold) so "open my resume" matches
  `Resume_2026_Final.pdf`, "open the tax pdf" matches `2025_Taxes.pdf`, etc.

## Soft delete (Recycle Bin, never permanent)

On Windows, moving a file to the Recycle Bin (rather than `fs.unlinkSync`,
which permanently deletes) is done via the Shell COM API:

```powershell
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace((Split-Path $path))
$item = $folder.ParseName((Split-Path $path -Leaf))
$item.InvokeVerb("delete")
```

or more simply with the npm package [`trash`](https://www.npmjs.com/package/trash),
which wraps the equivalent shell call cross-platform. **`delete_file` should call
this, never `fs.unlinkSync`.** This gives you a free "undo" — the file is still
recoverable from the Recycle Bin even if Ultron's own undo stack (Phase 8) is
somehow bypassed.

## "Close that" — resolving what "that" refers to

Since the OS has no clean concept of "the file the user means", track a small
**session-opened registry** in memory: `{ path, pid or window-title, openedAt }[]`
for the last N things `open_file`/`open_app_or_file` launched. "Close that" /
"close it" resolves to the most recent entry. For files opened outside of
Ultron's control, closing requires matching a window by title
(`Get-Process | Where MainWindowTitle -like "*name*"`) and is best-effort —
document this as a known limitation, not a guarantee.

## Path allow/deny list

Delete, move, rename, and create must run through the shared deny-list from
[08-safety-and-permissions.md](08-safety-and-permissions.md) — e.g. never allow
deleting inside `C:\Windows`, `C:\Program Files`, another user's profile folder,
or the ULTRON project directory itself. Reads (`open_file`, `search_files`) can
be looser but should still skip system directories for performance/noise reasons
(already partially done today via the `node_modules`/`AppData` skip list).

## Acceptance criteria

- [ ] "Open my resume" opens the right file within the indexed directories.
- [ ] "Delete report.docx" asks for confirmation, then the file lands in Recycle
      Bin (verifiable by restoring it from there).
- [ ] Attempting to delete something inside a denied path is refused with a
      clear spoken explanation, not a silent failure.
- [ ] "Close that" closes the file/app most recently opened by Ultron in the
      same session.
- [ ] File search returns results in well under a second on a typical
      Documents/Desktop/Downloads-sized index.
