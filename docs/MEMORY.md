# ULTRON persistent memory

All memory is plain JSON under `data/memory/` (git-ignored — it's
personal and machine-specific). No database, no embeddings, no network.

| File | What |
| --- | --- |
| `profile.json` | Durable key/value facts about you & the machine (name, primary drive, editor, timezone). Set via `set_profile` or *"my name is…"*. |
| `facts.jsonl` | Append-only log of things you told ULTRON to remember. De-duplicated. |
| `corrections.jsonl` | Append-only *"you did X, the right thing was Y"* log. **Every** correction is injected into the system prompt on every turn so the same mistake isn't repeated. |
| `sessions.jsonl` | Rolling per-turn summary (last 400) so context survives restarts / page reloads. |

## How it's used

On every `/api/chat` call, `buildMemoryContext(message)` assembles a
`MEMORY CONTEXT` block — full profile, all corrections, the last 5 turns,
and keyword-scored relevant facts — and prepends it to the system
instruction before the request goes to the AI brain.

After every turn, `recordTurn()` appends the exchange (clipped) to
`sessions.jsonl`.

## Tools the AI can call

- `remember(fact, tags?)` — save a durable fact
- `record_correction(mistake, correction, context?)` — never repeat a mistake
- `recall_memory(query)` — search facts + corrections
- `set_profile(key, value)` — set a stable profile field

## Managing it

```bash
curl localhost:3000/api/memory                     # dump everything
curl -X POST localhost:3000/api/memory -d '{"action":"forget","query":"old fact"}'
```

Delete `data/memory/` to wipe all memory.

## Retrieval

Keyword scoring only (`recall()` in `lib/memory/store.ts`). For a
single-user desktop assistant this is plenty and keeps the whole thing
dependency-free. If the fact count ever grows into the thousands,
swapping `scoreText()` for a local embedding index is the natural
upgrade — the store API wouldn't change.
