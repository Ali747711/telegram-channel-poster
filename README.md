# telegram-channel-poster

A remote **MCP server** that lets Claude post to a Telegram channel. Claude writes the content in conversation and calls this server's tools; the server holds the bot credentials and delivers the posts via the Telegram Bot API. No LLM calls happen server-side.

## Tools

| Tool | What it does |
|---|---|
| `post_to_channel` | Publish a text post (HTML by default). Splits >4096 chars into sequential posts, falls back to plain text if formatting fails to parse, returns message IDs + public link. |
| `post_photo` | Publish a photo by public URL with an optional caption (≤1024 chars). |
| `get_channel_info` | Report channel title/ID/type and whether the bot has posting rights — use to debug the connection. |

## Prerequisites

1. Create a bot with [@BotFather](https://t.me/BotFather) → copy the token.
2. Add the bot to your channel as **administrator** with the **Post Messages** permission.
3. Generate an auth secret: `openssl rand -hex 32`.

## Configuration

All config comes from environment variables (see `.env.example`):

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `TELEGRAM_CHANNEL_ID` | `@channelusername`, or numeric `-100…` ID for private channels |
| `MCP_AUTH_TOKEN` | long random secret; MCP clients must send `Authorization: Bearer <token>` |
| `PORT` | default `3000` (Render injects its own) |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error`, default `info` |

The server fails fast at startup if anything required is missing.

## Run locally

```bash
npm ci
cp .env.example .env   # fill in real values
npm run dev            # or: npm run build && npm start
```

Verify: `curl localhost:3000/healthz` → `ok`. Requests to `POST /mcp` without the bearer token get `401`; `GET /mcp` gets `405` (stateless mode — no SSE stream, no sessions).

Tests: `npm test` (or `npm run test:coverage`).

## Deploy to Render

The repo ships a `render.yaml` blueprint:

1. Render dashboard → **New → Blueprint** → select this repo.
2. Render reads `render.yaml`; it will prompt for the three secret env values.
3. Deploy. Health checks hit `/healthz`.

Note: on the free plan the service spins down after ~15 min idle; the first request afterwards takes ~30–60s.

## Connect Claude Code

```bash
claude mcp add --transport http telegram-poster \
  https://<your-service>.onrender.com/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

(Use `http://localhost:3000/mcp` for local development.)

Then just ask Claude:

> "Write a short post about X and publish it to my channel"
>
> "Check my channel connection" → runs `get_channel_info`

## Security notes

- The bearer token is the only gate between the public internet and your channel — keep it long, random, and out of the repo. Rotate it if exposed.
- The bot token and auth token are never logged and are scrubbed from error messages.
- `.env` is gitignored; production secrets live in Render's environment settings.
