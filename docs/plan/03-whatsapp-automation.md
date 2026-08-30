# Phase 3 — Real WhatsApp Automation (real contacts, real send)

## Goal

"Message my brother saying I'm on my way" → Ultron finds **your brother** in your
**real WhatsApp contact list** (not the placeholder `data/contacts.json`) and the
message is **actually sent**, not just pre-filled waiting for a manual click.

## Why the current implementation isn't enough

`send_whatsapp_message` opens `web.whatsapp.com/send?phone=...&text=...`, which
pre-fills the compose box but requires you to click Send yourself. Contact
resolution is against a hand-maintained `data/contacts.json` (currently just
placeholder entries with empty phone numbers) — it has no idea who your actual
WhatsApp contacts are.

## Approach: `whatsapp-web.js`

Use the [`whatsapp-web.js`](https://wwebjs.dev/) Node library, which drives a
real WhatsApp Web session via a background headless/headed Chromium instance
(puppeteer under the hood). One-time setup:

1. First run shows a QR code (in terminal or a small UI panel) — scan it once
   with your phone's WhatsApp, same as logging into WhatsApp Web normally.
2. The library persists the authenticated session locally (`LocalAuth` strategy
   writes session data to disk), so you don't re-scan on every restart.
3. This becomes a background connection owned by the **core service**
   (see Phase 5) rather than something spun up per-request, since keeping the
   session alive is the whole point.

Once connected, it gives you:
- `client.getContacts()` — your real contact list (name + number), replacing
  `data/contacts.json` as a live cache instead of a hand-edited placeholder.
- `client.sendMessage(chatId, text)` — an actual send, no manual click.
- (Optional, later) `client.on('message', ...)` — could support "read me my last
  message from mom", if you want that eventually; not required for v1.

## New tools

| Tool | Behavior |
|---|---|
| `whatsapp_list_contacts` | Returns/refreshes the cached real contact list. |
| `whatsapp_send_message` (replaces current) | Fuzzy-resolves `recipient` against real contacts (name, saved relationship label if you keep a small local nickname map like "brother" → contact name, or phone digits), then calls `sendMessage` directly. |

## Contact resolution priority

1. Exact/fuzzy match against real WhatsApp contact display names.
2. A small local **nickname map** (kept in `data/contact-aliases.json`) so "my
   brother" / "mom" continue to work — this file just maps a nickname to the
   *real* contact's phone number/WhatsApp ID, rather than storing the number
   itself as a fake placeholder like today.
3. A raw phone number spoken directly.

## Confirmation before send

Because this now actually sends (no manual click as a safety net anymore),
route every `whatsapp_send_message` call through a spoken confirmation by
default: *"Sending to Rohan: 'On my way.' Confirm?"* — this can be turned off
in settings for a faster, fully hands-free flow once you trust the contact
resolution, but it should default ON given a misheard name or number would
otherwise silently message the wrong person.

## Known risk — please read

`whatsapp-web.js` (and any unofficial WhatsApp Web automation library) is not
an officially sanctioned integration; WhatsApp's terms of service technically
prohibit unofficial clients/automation, and there is a **non-zero risk of your
account being flagged or temporarily restricted**, especially with high message
volume or bulk/spam-like patterns. For personal, low-volume, 1:1 messaging
triggered by you speaking to your own assistant, real-world risk is low, but
it's not zero, and it's worth deciding you're comfortable with that trade-off
before this phase is built. If you'd rather avoid that risk entirely, the
fallback is to keep today's deep-link-plus-manual-click behavior (Phase 3 would
then be skipped, and only contact resolution — matching against a manually
maintained richer contact list — gets improved).

## Acceptance criteria

- [ ] First-run QR pairing works and persists across restarts (no repeat scans).
- [ ] "Message my brother saying I'll be late" resolves the correct real contact
      and actually delivers the message after confirmation.
- [ ] A misheard/unknown name triggers a spoken "I couldn't find X in your
      contacts" rather than silently messaging the wrong person.
