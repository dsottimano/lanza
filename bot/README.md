# bot — Telegram → draft post (Cloudflare Worker)

Receives a Telegram message and commits a `draft: true` markdown file to
`src/content/posts/` via the GitHub Contents API. Nothing publishes
automatically — the draft is reviewed and published in the CMS.

**Flow:** message (first line = title, rest = body) → commit draft → reply with path.

## Setup

1. **Create the bot:** talk to [@BotFather](https://t.me/BotFather), get the token.
2. **Get `BOT_INFO`:** `curl https://api.telegram.org/bot<TOKEN>/getMe` — copy the
   `result` object (JSON).
3. **GitHub PAT:** fine-grained token, **Contents: read & write** on this repo.
4. **Local dev:** copy `.dev.vars.example` → `.dev.vars`, fill in, then `npm run dev`.
5. **Deploy:**
   ```bash
   npm run deploy
   wrangler secret put BOT_TOKEN
   wrangler secret put BOT_INFO
   wrangler secret put WEBHOOK_SECRET   # any long random string
   wrangler secret put GITHUB_TOKEN
   ```
6. **Register the webhook** (secured with the secret-token header):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://telegram-bot.<subdomain>.workers.dev&secret_token=<WEBHOOK_SECRET>"
   ```

Non-secret config (`GITHUB_REPO`, `GITHUB_BRANCH`, `CONTENT_DIR`,
`ALLOWED_CHAT_IDS`) lives in `wrangler.jsonc`. The bot is the only
request-consumer on the free tier (100k req/day, account-wide).

## Security model

This bot holds a repo-write token, so it's locked down three ways (all fail closed):

- **`WEBHOOK_SECRET`** must be set — Telegram's secret-token header is verified on
  every request; a missing secret rejects everything.
- **`ALLOWED_CHAT_IDS`** — only listed Telegram chat IDs reach the handlers; an
  empty list silently drops all updates. Set it to your chat ID before use.
- Internal/API errors are logged server-side only; users get a generic message.

## Extending to full CRUD

Update/delete use the same Contents API: `GET .../contents/{path}` for the blob
`sha`, then `PUT` (update) or `DELETE` with that `sha`. For multi-step
conversational flows, grammY sessions are the natural next step.
