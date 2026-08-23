import { describe, expect, it, vi } from 'vitest';

import { createTelegramClient, TelegramApiError } from '../src/telegram/client.js';

const BOT_TOKEN = '999999:FAKE-token-abcDEF123456';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

const okResult = (result: unknown): Response => jsonResponse({ ok: true, result });

const apiError = (
  errorCode: number,
  description: string,
  parameters?: Record<string, unknown>
): Response =>
  jsonResponse({ ok: false, error_code: errorCode, description, parameters }, errorCode);

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

const parseBody = (body: unknown): Record<string, unknown> => {
  if (body instanceof FormData) {
    const parsed: Record<string, unknown> = {};
    for (const [key, value] of body.entries()) {
      parsed[key] = value;
    }
    return parsed;
  }
  return JSON.parse(String(body)) as Record<string, unknown>;
};

const buildClient = (responses: Response[] | Error) => {
  const calls: Sent[] = [];
  const fetchFn = vi.fn(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (responses instanceof Error) throw responses;
    calls.push({ url: String(url), body: parseBody(init?.body) });
    const next = responses.shift();
    if (!next) throw new Error('test: no more stubbed responses');
    return next;
  });
  const sleepFn = vi.fn(async (_ms: number) => {});
  const client = createTelegramClient({ botToken: BOT_TOKEN, fetchFn, sleepFn });
  return { client, fetchFn, sleepFn, calls };
};

const sentMessage = (username?: string) =>
  okResult({ message_id: 42, chat: { id: -100123, ...(username ? { username } : {}) } });

describe('createTelegramClient', () => {
  describe('sendMessage', () => {
    it('POSTs to the sendMessage endpoint with the expected payload', async () => {
      const { client, calls } = buildClient([sentMessage('mychan')]);

      await client.sendMessage({
        chatId: '@mychan',
        text: 'hello <b>world</b>',
        parseMode: 'HTML',
        disableLinkPreview: true,
        silent: false
      });

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
      expect(calls[0]!.body).toEqual({
        chat_id: '@mychan',
        text: 'hello <b>world</b>',
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        disable_notification: false
      });
    });

    it('returns the message ID and a t.me link for public channels', async () => {
      const { client } = buildClient([sentMessage('mychan')]);

      const result = await client.sendMessage({ chatId: '@mychan', text: 'hi' });

      expect(result).toEqual({ messageId: 42, link: 'https://t.me/mychan/42' });
    });

    it('returns no link for private channels (no username)', async () => {
      const { client } = buildClient([sentMessage()]);

      const result = await client.sendMessage({ chatId: -100123, text: 'hi' });

      expect(result.messageId).toBe(42);
      expect(result.link).toBeUndefined();
    });

    it('omits parse_mode entirely when not requested', async () => {
      const { client, calls } = buildClient([sentMessage('mychan')]);

      await client.sendMessage({ chatId: '@mychan', text: 'plain' });

      expect(calls[0]!.body).not.toHaveProperty('parse_mode');
    });
  });

  describe('sendPhoto', () => {
    it('POSTs photo URL and caption to the sendPhoto endpoint', async () => {
      const { client, calls } = buildClient([sentMessage('mychan')]);

      const result = await client.sendPhoto({
        chatId: '@mychan',
        photoUrl: 'https://example.com/pic.jpg',
        caption: 'nice pic',
        parseMode: 'HTML'
      });

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`);
      expect(calls[0]!.body).toEqual({
        chat_id: '@mychan',
        photo: 'https://example.com/pic.jpg',
        caption: 'nice pic',
        parse_mode: 'HTML',
        disable_notification: false
      });
      expect(result).toEqual({ messageId: 42, link: 'https://t.me/mychan/42' });
    });
  });

  describe('getChat', () => {
    it('returns mapped chat info', async () => {
      const { client, calls } = buildClient([
        okResult({ id: -100999, title: 'My Channel', username: 'mychan', type: 'channel' })
      ]);

      const info = await client.getChat('@mychan');

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/getChat`);
      expect(info).toEqual({ id: -100999, title: 'My Channel', username: 'mychan', type: 'channel' });
    });
  });

  describe('sendPhoto with a file buffer', () => {
    it('sends multipart form data with the photo as a blob', async () => {
      const { client, calls } = buildClient([sentMessage('mychan')]);

      const result = await client.sendPhoto({
        chatId: '@mychan',
        photoFile: { data: Buffer.from('fake-image-bytes'), filename: 'pic.jpg', contentType: 'image/jpeg' },
        caption: 'from a local file'
      });

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`);
      expect(calls[0]!.body.chat_id).toBe('@mychan');
      expect(calls[0]!.body.caption).toBe('from a local file');
      expect(calls[0]!.body.photo).toBeInstanceOf(Blob);
      expect(result.messageId).toBe(42);
    });

    it('rejects when neither URL nor file is provided', async () => {
      const { client } = buildClient([sentMessage('mychan')]);

      await expect(client.sendPhoto({ chatId: '@mychan' })).rejects.toThrow(/photo_url|file/i);
    });
  });

  describe('sendDocument', () => {
    it('posts a document by URL', async () => {
      const { client, calls } = buildClient([sentMessage('mychan')]);

      const result = await client.sendDocument({
        chatId: '@mychan',
        documentUrl: 'https://example.com/report.pdf',
        caption: 'the report'
      });

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`);
      expect(calls[0]!.body).toEqual({
        chat_id: '@mychan',
        document: 'https://example.com/report.pdf',
        caption: 'the report',
        disable_notification: false
      });
      expect(result.messageId).toBe(42);
    });
  });

  describe('sendMediaGroup', () => {
    it('posts an album and returns every message reference', async () => {
      const { client, calls } = buildClient([
        okResult([
          { message_id: 50, chat: { id: -100123, username: 'mychan' } },
          { message_id: 51, chat: { id: -100123, username: 'mychan' } }
        ])
      ]);

      const results = await client.sendMediaGroup({
        chatId: '@mychan',
        items: [
          { type: 'photo', url: 'https://example.com/1.jpg', caption: 'album!', parseMode: 'HTML' },
          { type: 'video', url: 'https://example.com/2.mp4' }
        ]
      });

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`);
      expect(calls[0]!.body.media).toEqual([
        { type: 'photo', media: 'https://example.com/1.jpg', caption: 'album!', parse_mode: 'HTML' },
        { type: 'video', media: 'https://example.com/2.mp4' }
      ]);
      expect(results.map((r) => r.messageId)).toEqual([50, 51]);
      expect(results[0]!.link).toBe('https://t.me/mychan/50');
    });
  });

  describe('sendPoll', () => {
    it('posts an anonymous poll', async () => {
      const { client, calls } = buildClient([sentMessage('mychan')]);

      await client.sendPoll({
        chatId: '@mychan',
        question: 'Next book?',
        options: ['Deep Work', 'Atomic Habits']
      });

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendPoll`);
      expect(calls[0]!.body).toEqual({
        chat_id: '@mychan',
        question: 'Next book?',
        options: [{ text: 'Deep Work' }, { text: 'Atomic Habits' }],
        is_anonymous: true,
        allows_multiple_answers: false,
        disable_notification: false
      });
    });

    it('posts a quiz with the correct option index', async () => {
      const { client, calls } = buildClient([sentMessage('mychan')]);

      await client.sendPoll({
        chatId: '@mychan',
        question: '2+2?',
        options: ['3', '4'],
        quizCorrectOptionIndex: 1
      });

      expect(calls[0]!.body.type).toBe('quiz');
      expect(calls[0]!.body.correct_option_id).toBe(1);
    });
  });

  describe('pin and unpin', () => {
    it('pins quietly by default', async () => {
      const { client, calls } = buildClient([okResult(true)]);

      const result = await client.pinChatMessage('@mychan', 42);

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/pinChatMessage`);
      expect(calls[0]!.body).toEqual({ chat_id: '@mychan', message_id: 42, disable_notification: true });
      expect(result).toBe(true);
    });

    it('unpins by message id', async () => {
      const { client, calls } = buildClient([okResult(true)]);

      await client.unpinChatMessage('@mychan', 42);

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/unpinChatMessage`);
      expect(calls[0]!.body).toEqual({ chat_id: '@mychan', message_id: 42 });
    });
  });

  describe('getMe', () => {
    it('returns the bot identity', async () => {
      const { client, calls } = buildClient([
        okResult({ id: 111, is_bot: true, first_name: 'bloger', username: 'mybot' })
      ]);

      const me = await client.getMe();

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
      expect(me).toEqual({ id: 111, username: 'mybot' });
    });
  });

  describe('getChatMember', () => {
    it('returns membership status and post permission', async () => {
      const { client, calls } = buildClient([
        okResult({ status: 'administrator', can_post_messages: true })
      ]);

      const member = await client.getChatMember(-100999, 111);

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`);
      expect(calls[0]!.body).toEqual({ chat_id: -100999, user_id: 111 });
      expect(member).toEqual({ status: 'administrator', canPostMessages: true });
    });

    it('omits canPostMessages when Telegram does not send it', async () => {
      const { client } = buildClient([okResult({ status: 'member' })]);

      const member = await client.getChatMember(-100999, 111);

      expect(member.status).toBe('member');
      expect(member.canPostMessages).toBeUndefined();
    });
  });

  describe('editMessageText', () => {
    it('edits a text post and returns the updated message reference', async () => {
      const { client, calls } = buildClient([sentMessage('mychan')]);

      const result = await client.editMessageText({
        chatId: '@mychan',
        messageId: 42,
        text: 'updated <b>text</b>',
        parseMode: 'HTML'
      });

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`);
      expect(calls[0]!.body).toEqual({
        chat_id: '@mychan',
        message_id: 42,
        text: 'updated <b>text</b>',
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });
      expect(result).toEqual({ messageId: 42, link: 'https://t.me/mychan/42' });
    });
  });

  describe('editMessageCaption', () => {
    it('edits a media caption', async () => {
      const { client, calls } = buildClient([sentMessage('mychan')]);

      await client.editMessageCaption({
        chatId: '@mychan',
        messageId: 42,
        caption: 'new caption',
        parseMode: 'HTML'
      });

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageCaption`);
      expect(calls[0]!.body).toEqual({
        chat_id: '@mychan',
        message_id: 42,
        caption: 'new caption',
        parse_mode: 'HTML'
      });
    });
  });

  describe('deleteMessage', () => {
    it('deletes a message and returns true', async () => {
      const { client, calls } = buildClient([okResult(true)]);

      const result = await client.deleteMessage('@mychan', 42);

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`);
      expect(calls[0]!.body).toEqual({ chat_id: '@mychan', message_id: 42 });
      expect(result).toBe(true);
    });
  });

  describe('sendVideo', () => {
    it('posts a video by URL with caption and streaming enabled', async () => {
      const { client, calls } = buildClient([sentMessage('mychan')]);

      const result = await client.sendVideo({
        chatId: '@mychan',
        videoUrl: 'https://example.com/clip.mp4',
        caption: 'watch this',
        parseMode: 'HTML'
      });

      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`);
      expect(calls[0]!.body).toEqual({
        chat_id: '@mychan',
        video: 'https://example.com/clip.mp4',
        caption: 'watch this',
        parse_mode: 'HTML',
        disable_notification: false,
        supports_streaming: true
      });
      expect(result).toEqual({ messageId: 42, link: 'https://t.me/mychan/42' });
    });
  });

  describe('error mapping', () => {
    it('maps 401 to an actionable bot-token error', async () => {
      const { client } = buildClient([apiError(401, 'Unauthorized')]);

      await expect(client.getChat('@x')).rejects.toThrow(/bot token.*401|401.*bot token/i);
    });

    it('maps "chat not found" to a TELEGRAM_CHANNEL_ID hint', async () => {
      const { client } = buildClient([apiError(400, 'Bad Request: chat not found')]);

      await expect(client.sendMessage({ chatId: '@x', text: 'hi' })).rejects.toThrow(
        /chat not found/i
      );
    });

    it('maps 403 to an admin-permission hint', async () => {
      const { client } = buildClient([apiError(403, 'Forbidden: bot is not a member')]);

      await expect(client.sendMessage({ chatId: '@x', text: 'hi' })).rejects.toThrow(
        /admin|permission/i
      );
    });

    it('throws TelegramApiError instances carrying the error code', async () => {
      const { client } = buildClient([apiError(401, 'Unauthorized')]);

      const error = await client.getChat('@x').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TelegramApiError);
      expect((error as TelegramApiError).errorCode).toBe(401);
    });

    it('wraps network failures without leaking the bot token', async () => {
      const { client } = buildClient(
        new Error(`connect ETIMEDOUT https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)
      );

      const error = await client.sendMessage({ chatId: '@x', text: 'hi' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TelegramApiError);
      expect((error as Error).message).not.toContain(BOT_TOKEN);
      expect((error as Error).message).toMatch(/unreachable/i);
    });

    it('handles non-JSON responses with a clear error', async () => {
      const { client } = buildClient([
        new Response('<html>Bad Gateway</html>', { status: 502 })
      ]);

      await expect(client.getChat('@x')).rejects.toThrow(/non-JSON|502/i);
    });
  });

  describe('429 retry', () => {
    it('waits retry_after seconds and retries once on 429', async () => {
      const { client, fetchFn, sleepFn } = buildClient([
        apiError(429, 'Too Many Requests', { retry_after: 3 }),
        sentMessage('mychan')
      ]);

      const result = await client.sendMessage({ chatId: '@mychan', text: 'hi' });

      expect(sleepFn).toHaveBeenCalledWith(3000);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.messageId).toBe(42);
    });

    it('gives up after a second 429 with a clear rate-limit error', async () => {
      const { client, fetchFn } = buildClient([
        apiError(429, 'Too Many Requests', { retry_after: 1 }),
        apiError(429, 'Too Many Requests', { retry_after: 60 })
      ]);

      await expect(client.sendMessage({ chatId: '@x', text: 'hi' })).rejects.toThrow(
        /rate limit/i
      );
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('fails fast without waiting when retry_after exceeds the in-request cap', async () => {
      const { client, fetchFn, sleepFn } = buildClient([
        apiError(429, 'Too Many Requests', { retry_after: 120 })
      ]);

      await expect(client.sendMessage({ chatId: '@x', text: 'hi' })).rejects.toThrow(
        /rate limit|try again/i
      );
      expect(sleepFn).not.toHaveBeenCalled();
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });
});
