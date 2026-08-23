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
| `mcp__telegram-poster__post_photo` / `post_video` | Media by public URL, or by `file_id` for **local files** (see below). Caption ≤1024 chars. |
| `mcp__telegram-poster__post_document` | Any file (PDF, archive…) by URL or `file_id`. |
| `mcp__telegram-poster__post_media_group` | 2–10 photos/videos as one album (URLs only; caption on the first item). |
| `mcp__telegram-poster__post_poll` | Native polls/quizzes. Channels force anonymous voting. |
| `mcp__telegram-poster__schedule_post` / `list_scheduled_posts` / `cancel_scheduled_post` | Queue text posts for later. `publish_at` must be ISO 8601 WITH a timezone offset. Heed the persistence caveat in the tool's reply. |
| `mcp__telegram-poster__edit_post` | Replace a post's text by message_id (auto-switches to caption edit for media posts). |
| `mcp__telegram-poster__delete_post` | Permanently delete by message_id. Requires `confirm: true` — ONLY after the user explicitly asked to delete. |
| `mcp__telegram-poster__pin_post` / `unpin_post` | Pin/unpin a post (bot needs the "Edit Messages" admin right). |
| `mcp__telegram-poster__get_post` / `list_recent_posts` | Look up posts made through the server (IDs, content, edit/delete status). |
| `mcp__telegram-poster__get_channel_info` | Diagnose connection and posting rights. |

**Local files (images, videos, documents):** upload first, then post by `file_id` — never base64 through a tool call:

```bash
curl -s -X POST https://<your-service>/upload \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "X-Filename: photo.jpg" --data-binary @photo.jpg
# → {"file_id": "..."} — valid ~15 min; pass as file_id to post_photo/post_video/post_document
```

Tools missing? Check `claude mcp list` shows `telegram-poster`.

## Personal-account tools (optional)

Present only when the server is configured with a Telegram **user session** (see the repo README).
They act as the account owner rather than the bot, so their output is private data.

| Tool | Use for |
|---|---|
| `mcp__telegram-poster__whoami` | Confirm which account the session belongs to. |
| `mcp__telegram-poster__list_chats` / `list_folders` | The owner's dialogs (with `folder_id` / `unread_only` filters) and chat folders. |
| `mcp__telegram-poster__read_chat_history` | Messages from one of the owner's chats. |
| `mcp__telegram-poster__pull_channel_posts` | Recent posts from any channel the owner has joined — catch-up and research. |
| `mcp__telegram-poster__search_messages` | Full-text search across the owner's messages. |
| `mcp__telegram-poster__send_dm` | Sends **as the owner** to a person. See rules below. |

**Rules for these tools:**

- **`send_dm` messages real people as the owner.** Always show the exact recipient AND wording, get explicit approval, then send with `confirm: true`. Never batch or improvise recipients. The server caps sends per day.
- **Don't republish private chat content** to channels or other public surfaces unless asked.
- The Telegram service chat is hard-blocked server-side and login/2FA codes are redacted automatically — don't route around either.

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

The server posts via the Bot API in **HTML parse mode**. The Markdown shortcuts from the Telegram app UI (`**bold**`, `_italic_`, `__underline__`, `~~strike~~`, `||spoiler||`) do **not** work here — they post as literal characters. Always use HTML tags:

| Effect | HTML | Good for |
|---|---|---|
| Bold | `<b>text</b>` | the hook line, key points, deadlines |
| Italic | `<i>text</i>` | tone, asides, quoted thoughts |
| Underline | `<u>text</u>` | critical terms (use sparingly) |
| Strikethrough | `<s>text</s>` | corrections, changed plans, ~~old~~ new prices |
| Spoiler | `<tg-spoiler>text</tg-spoiler>` | punchlines, trivia answers, reveals on tap |
| Inline code | `<code>text</code>` | commands, identifiers, formulas |
| Code block | `<pre>text</pre>` | multi-line snippets — preserves spacing and copies cleanly; `<pre><code class="language-ts">…</code></pre>` adds a language hint |
| Quote | `<blockquote>text</blockquote>` | quoting someone or excerpting; `<blockquote expandable>` collapses long quotes behind a tap |
| Link | `<a href="https://…">anchor</a>` | always natural anchor text |

- **Never show a raw URL as visible text.** Wrap every link in `<a href="...">` with natural anchor text that reads as part of the sentence — `<a href="https://github.com/user/repo">The code is on GitHub</a>`, never `Code → <a href="...">github.com/user/repo</a>` and never a bare `https://...` in the body.
- **Escape literal characters:** a bare `<`, `>` or `&` in post text breaks HTML parsing (the classic "can't parse entities" error) — write `&lt;`, `&gt;`, `&amp;`.
- Tags nest fine (`<blockquote><b>…</b></blockquote>`). Telegram has no custom fonts — don't fake them with unicode "font" generators; they break search and screen readers.
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
| App-style Markdown (`**bold**`, `||spoiler||`) in post text | HTML tags only — app shortcuts don't work via the Bot API |
| Literal `<`, `>` or `&` breaking the HTML parse | Escape as `&lt;` `&gt;` `&amp;` |
| Publishing without showing a draft first | Always draft in chat and wait for a go-ahead — "post it" is not one |
| Giving up after first timeout | Cold start — retry once |
| Caption >1024 chars | Shorten it or post text separately |
| Burying the hook | First line bold, says the point |
| Visible raw URL (`github.com/...` as link text) | Hyperlink natural anchor text instead |
