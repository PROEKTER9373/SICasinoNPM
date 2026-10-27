# SICO v38 — Support assistant

- Added a dedicated Support tab in the main navigation.
- Added selectable issue categories and suggested questions before free-form messages.
- Added a multi-turn guided support dialogue with contextual troubleshooting steps.
- Added authenticated `/api/support/chat` endpoint with message length limits and per-user cooldown.
- Optional OpenAI-compatible responses when `OPENAI_API_KEY` is configured; without a key, local guided troubleshooting remains available.
- The assistant does not request passwords, 2FA codes, session tokens, or claim it can change balances/unban accounts.
- Updated mobile navigation to six tabs and added responsive support chat styling.

## Enable AI responses
Set `OPENAI_API_KEY` in `.env`. Optionally set `SICO_SUPPORT_MODEL` (default `gpt-4o-mini`). Without a key, support still responds with built-in guided flows.
