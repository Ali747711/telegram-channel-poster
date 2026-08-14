# Telegram Post MCP Server

A remote **MCP server** that lets Claude post to a Telegram channel. Claude writes the content in conversation and calls this server's tools; the server holds the bot credentials and delivers the posts via the Telegram Bot API. No LLM calls happen server-side.

It ships with a companion **Claude Code skill** ([`skills/telegram-post/SKILL.md`](skills/telegram-post/SKILL.md)) that teaches Claude the posting workflow and the channel's voice — see [Claude Code skill](#claude-code-skill) below.

## Tools

| Tool | What it does |
|---|---|
| `post_to_channel` | Publish a text post (HTML by default). Splits >4096 chars into sequential posts, falls back to plain text if formatting fails to parse, returns message IDs + public link. |
| `post_photo` | Publish a photo by public URL with an optional caption (≤1024 chars). |
| `post_video` | Publish a video by public URL (MP4 recommended, ≤20MB) with an optional caption. |
| `edit_post` | Replace a post's text by message ID; automatically edits the caption instead for photo/video posts. |
| `delete_post` | Permanently delete a post by message ID. Gated behind `confirm: true`. |
| `get_post` / `list_recent_posts` | Details of posts made through this server (content, link, edit/delete status). In-memory: history resets on server restart. |
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

## Claude Code skill

The Telegram Post MCP server pairs with a skill at [`skills/telegram-post/SKILL.md`](skills/telegram-post/SKILL.md). While the server provides the *capability* (tools), the skill provides the *judgment*: a draft-first workflow (Claude always shows the post in chat and waits for approval before publishing), the channel's voice and tone profile, HTML formatting rules and their pitfalls, and recovery steps for cold starts and errors.

Install it by copying into your personal skills directory:

```bash
cp -r skills/telegram-post ~/.claude/skills/
```

New Claude Code sessions pick it up automatically. The skill ships channel-agnostic: fill in its **Voice** section (language, persona, style) with your channel's identity before using it.

## Security notes

- The bearer token is the only gate between the public internet and your channel — keep it long, random, and out of the repo. Rotate it if exposed.
- The bot token and auth token are never logged and are scrubbed from error messages.
- `.env` is gitignored; production secrets live in Render's environment settings.
