---
name: telegram-post
description: Use when the user asks to post, publish, announce, or draft content for their Telegram channel, asks for channel post ideas, or wants to check the channel connection — e.g. "post this to my channel", "write a post about X and publish it".
---

# Telegram Channel Posting

## Overview

Publish to the configured Telegram channel through the `telegram-poster` MCP server (see the repo README for setup). Claude writes the content; the server only delivers it via the channel's bot.

## Tools

| Tool | Use for |
|---|---|
| `mcp__telegram-poster__post_to_channel` | Text posts. Splits >4096 chars automatically. |
| `mcp__telegram-poster__post_photo` | Photo by public http(s) URL, optional caption ≤1024 chars. |
| `mcp__telegram-poster__post_video` | Video by public http(s) URL (MP4, ≤20MB), optional caption. |
| `mcp__telegram-poster__edit_post` | Replace a post's text by message_id (auto-switches to caption edit for media posts). |
| `mcp__telegram-poster__delete_post` | Permanently delete by message_id. Requires `confirm: true` — ONLY after the user explicitly asked to delete. |
| `mcp__telegram-poster__get_post` / `list_recent_posts` | Look up posts made through the server (IDs, content, edit/delete status). Best-effort: history resets when the free-tier server restarts. |
| `mcp__telegram-poster__get_channel_info` | Diagnose connection and posting rights. |

Tools missing? Check `claude mcp list` shows `telegram-poster`.

## Workflow

1. **Always draft first, show it in chat, and wait for explicit approval — no exceptions.** This holds even when the request says "post it", "publish", or "send it to the channel"; treat that as authorisation to prepare the post, not to send it. Show the exact text (and photo/video URL) you intend to publish, then wait for a go-ahead. Never publish a revision without being asked to.

   *Why:* a published post's wording is expensive to change — every correction is either an edit that shows in the channel or a new message plus a deletion. Reviewing one draft in chat costs nothing.
2. Call the tool with defaults (`parse_mode` HTML, `disable_link_preview` true, `silent` false). Use `silent: true` for tests or when asked for a quiet post. Keep the link preview enabled when the post is *about* the link.
3. Report the returned `t.me/...` link to the user.
4. On failure: call `get_channel_info` and relay its actionable message.

**Cold starts:** the free Render tier sleeps after ~15 min idle; the first call may take 30–60s or time out. Retry once before diagnosing.

## Voice — CUSTOMIZE THIS SECTION for your channel

> Replace the placeholders below with your channel's identity. Everything else in this skill is channel-agnostic.

- **Language:** match the language of the user's request; default `<your channel's language>`.
- **Persona:** `<who is writing, to whom, about what — e.g. "first-person developer diary: tech news with my take, life lessons, notes to my future self">`.
- **Length:** ≤ ~900 chars unless long-form is requested.
- **Structure:** bold hook as the first line → 1–3 short paragraphs (blank line between) → optional link/hashtags as the last line.
- **Emoji:** 0–3, purposeful. **Hashtags:** ≤3, lowercase, only when genuinely useful.
- **Never:** corporate fluff, clickbait, walls of text, unexplained jargon.

## Formatting rules

- HTML tags only: `<b>`, `<i>`, `<a href="...">`, `<code>`. **Never Markdown** — `*asterisks*` and `[brackets]()` post as literal characters.
- **Never show a raw URL as visible text.** Wrap every link in `<a href="...">` with natural anchor text that reads as part of the sentence — `<a href="https://github.com/user/repo">The code is on GitHub</a>`, never `Code → <a href="...">github.com/user/repo</a>` and never a bare `https://...` in the body.
- Don't use MarkdownV2 (requires escaping 18 special characters; fails easily).
- If HTML fails to parse, the server auto-retries as plain text and says so in the result — fix the tags and repost only if formatting mattered.

## Example

Request: *"post about shipping the MCP server"* →

```
<b>Shipped: my Telegram channel now posts through Claude.</b>

I built a small MCP server (TypeScript, deployed on Render) that gives Claude posting rights here. I write ideas, Claude drafts, one command publishes.

Next: automating the whole content pipeline.
```

## Common mistakes

| Mistake | Fix |
|---|---|
| Markdown asterisks in post text | HTML tags only |
| Publishing without showing a draft first | Always draft in chat and wait for a go-ahead — "post it" is not one |
| Giving up after first timeout | Cold start — retry once |
| Caption >1024 chars | Shorten it or post text separately |
| Burying the hook | First line bold, says the point |
| Visible raw URL (`github.com/...` as link text) | Hyperlink natural anchor text instead |
