import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createFileStore } from '../src/file-store.js';
import { createPostRegistry } from '../src/post-registry.js';
import { createScheduleStore } from '../src/schedule-store.js';
import { createMemoryKv } from '../src/storage/kv.js';
import { TelegramApiError, type TelegramClient } from '../src/telegram/client.js';
import { createLogger } from '../src/utils/logger.js';

const AUTH_TOKEN = 'f0e1d2c3b4a5968778695a4b3c2d1e0f1234567890abcdef';
const CHANNEL_ID = '@testchannel';

const MCP_HEADERS = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json'
} as const;

interface FakeTelegram {
  client: TelegramClient;
  sendMessage: ReturnType<typeof vi.fn>;
  sendPhoto: ReturnType<typeof vi.fn>;
  sendVideo: ReturnType<typeof vi.fn>;
  sendDocument: ReturnType<typeof vi.fn>;
  sendMediaGroup: ReturnType<typeof vi.fn>;
  sendPoll: ReturnType<typeof vi.fn>;
  pinChatMessage: ReturnType<typeof vi.fn>;
  unpinChatMessage: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
  editMessageCaption: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
  getChat: ReturnType<typeof vi.fn>;
  getMe: ReturnType<typeof vi.fn>;
  getChatMember: ReturnType<typeof vi.fn>;
}

const fakeTelegram = (): FakeTelegram => {
  let nextId = 100;
  const sendMessage = vi.fn(async () => {
    nextId += 1;
    return { messageId: nextId, link: `https://t.me/testchannel/${nextId}` };
  });
  const sendPhoto = vi.fn(async () => ({ messageId: 55, link: 'https://t.me/testchannel/55' }));
  const sendVideo = vi.fn(async () => ({ messageId: 66, link: 'https://t.me/testchannel/66' }));
  const sendDocument = vi.fn(async () => ({ messageId: 60, link: 'https://t.me/testchannel/60' }));
  const sendMediaGroup = vi.fn(async () => [
    { messageId: 70, link: 'https://t.me/testchannel/70' },
    { messageId: 71, link: 'https://t.me/testchannel/71' }
  ]);
  const sendPoll = vi.fn(async () => ({ messageId: 88, link: 'https://t.me/testchannel/88' }));
  const pinChatMessage = vi.fn(async () => true);
  const unpinChatMessage = vi.fn(async () => true);
  const editMessageText = vi.fn(async () => ({ messageId: 42, link: 'https://t.me/testchannel/42' }));
  const editMessageCaption = vi.fn(async () => ({ messageId: 42, link: 'https://t.me/testchannel/42' }));
  const deleteMessage = vi.fn(async () => true);
  const getChat = vi.fn(async () => ({
    id: -100999,
    title: "Nabiev's blog",
    username: 'testchannel',
    type: 'channel'
  }));
  const getMe = vi.fn(async () => ({ id: 111, username: 'testbot' }));
  const getChatMember = vi.fn(async () => ({ status: 'administrator', canPostMessages: true }));
  const mocks = {
    sendMessage,
    sendPhoto,
    sendVideo,
    sendDocument,
    sendMediaGroup,
    sendPoll,
    pinChatMessage,
    unpinChatMessage,
    editMessageText,
    editMessageCaption,
    deleteMessage,
    getChat,
    getMe,
    getChatMember
  };
  return { client: mocks as unknown as TelegramClient, ...mocks };
};

interface AppOverrides {
  files?: ReturnType<typeof createFileStore>;
  persistent?: boolean;
}

const appWith = (telegram: TelegramClient, overrides: AppOverrides = {}) => {
  const kv = createMemoryKv();
  return buildApp({
    mcpAuthToken: AUTH_TOKEN,
    logger: createLogger('error'),
    telegram,
    channelId: CHANNEL_ID,
    registry: createPostRegistry(kv),
    schedule: createScheduleStore(kv),
    files: overrides.files ?? createFileStore(),
    persistent: overrides.persistent ?? false
  });
};

const callToolOn = (
  app: ReturnType<typeof appWith>,
  name: string,
  args: Record<string, unknown>
) =>
  request(app)
    .post('/mcp')
    .set(MCP_HEADERS)
    .send({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } });

const callTool = (telegram: TelegramClient, name: string, args: Record<string, unknown>) =>
  callToolOn(appWith(telegram), name, args);

describe('MCP tools', () => {
  it('lists all sixteen tools with schemas', async () => {
    const res = await request(appWith(fakeTelegram().client))
      .post('/mcp')
      .set(MCP_HEADERS)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

    expect(res.status).toBe(200);
    const tools = res.body.result.tools as Array<{ name: string; description?: string; inputSchema?: unknown }>;
    expect(tools.map((t) => t.name).sort()).toEqual([
      'cancel_scheduled_post',
      'delete_post',
      'edit_post',
      'get_channel_info',
      'get_post',
      'list_recent_posts',
      'list_scheduled_posts',
      'pin_post',
      'post_document',
      'post_media_group',
      'post_photo',
      'post_poll',
      'post_to_channel',
      'post_video',
      'schedule_post',
      'unpin_post'
    ]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  describe('post_to_channel', () => {
    it('posts text with defaults (HTML, preview off, not silent) and reports id + link', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_to_channel', { text: 'hello <b>world</b>' });

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBeFalsy();
      expect(fake.sendMessage).toHaveBeenCalledTimes(1);
      expect(fake.sendMessage).toHaveBeenCalledWith({
        chatId: CHANNEL_ID,
        text: 'hello <b>world</b>',
        parseMode: 'HTML',
        disableLinkPreview: true,
        silent: false
      });
      const text = res.body.result.content[0].text as string;
      expect(text).toContain('101');
      expect(text).toContain('https://t.me/testchannel/101');
    });

    it('maps parse_mode "none" to an unset parseMode', async () => {
      const fake = fakeTelegram();

      await callTool(fake.client, 'post_to_channel', { text: 'plain', parse_mode: 'none' });

      expect(fake.sendMessage.mock.calls[0]![0]).toMatchObject({ parseMode: undefined });
    });

    it('splits long text into sequential posts and reports every message id', async () => {
      const fake = fakeTelegram();
      const longText = 'a'.repeat(5000);

      const res = await callTool(fake.client, 'post_to_channel', { text: longText, parse_mode: 'none' });

      expect(fake.sendMessage).toHaveBeenCalledTimes(2);
      expect((fake.sendMessage.mock.calls[0]![0] as { text: string }).text).toHaveLength(4096);
      expect((fake.sendMessage.mock.calls[1]![0] as { text: string }).text).toHaveLength(904);
      const text = res.body.result.content[0].text as string;
      expect(text).toContain('101');
      expect(text).toContain('102');
    });

    it('retries as plain text when Telegram rejects the formatting entities', async () => {
      const fake = fakeTelegram();
      fake.sendMessage.mockRejectedValueOnce(
        new TelegramApiError(
          "Telegram API sendMessage failed (400): Bad Request: can't parse entities: Unsupported start tag \"stuff\"",
          { errorCode: 400 }
        )
      );

      const res = await callTool(fake.client, 'post_to_channel', { text: '<stuff>hi</stuff>' });

      expect(fake.sendMessage).toHaveBeenCalledTimes(2);
      expect(fake.sendMessage.mock.calls[1]![0]).toMatchObject({ parseMode: undefined });
      expect(res.body.result.isError).toBeFalsy();
      expect(res.body.result.content[0].text).toMatch(/plain text/i);
    });

    it('returns an isError tool result with the actionable message on Telegram failure', async () => {
      const fake = fakeTelegram();
      fake.sendMessage.mockRejectedValue(
        new TelegramApiError(
          'Telegram refused the request (403): Forbidden. Make sure the bot is an admin of the channel with the "Post Messages" permission.',
          { errorCode: 403 }
        )
      );

      const res = await callTool(fake.client, 'post_to_channel', { text: 'hi' });

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/admin/i);
    });

    it('reports partial success when a later chunk fails', async () => {
      const fake = fakeTelegram();
      fake.sendMessage
        .mockResolvedValueOnce({ messageId: 201, link: 'https://t.me/testchannel/201' })
        .mockRejectedValueOnce(new TelegramApiError('Telegram rate limit hit (429) persisted after one retry. Try again in a minute.', { errorCode: 429 }));

      const res = await callTool(fake.client, 'post_to_channel', {
        text: 'a'.repeat(5000),
        parse_mode: 'none'
      });

      expect(res.body.result.isError).toBe(true);
      const text = res.body.result.content[0].text as string;
      expect(text).toContain('201');
      expect(text).toMatch(/rate limit/i);
    });

    it('rejects an empty text at the schema boundary', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_to_channel', { text: '' });

      const failedAtProtocol = res.body.error !== undefined;
      const failedAsToolError = res.body.result?.isError === true;
      expect(failedAtProtocol || failedAsToolError).toBe(true);
      expect(fake.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('post_photo', () => {
    it('posts a photo with caption and reports id + link', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_photo', {
        photo_url: 'https://example.com/pic.jpg',
        caption: 'nice'
      });

      expect(res.body.result.isError).toBeFalsy();
      expect(fake.sendPhoto).toHaveBeenCalledWith({
        chatId: CHANNEL_ID,
        photoUrl: 'https://example.com/pic.jpg',
        caption: 'nice',
        parseMode: 'HTML',
        silent: false
      });
      expect(res.body.result.content[0].text).toContain('https://t.me/testchannel/55');
    });

    it('rejects a non-http(s) photo URL at the schema boundary', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_photo', { photo_url: 'ftp://example.com/pic.jpg' });

      const rejected = res.body.error !== undefined || res.body.result?.isError === true;
      expect(rejected).toBe(true);
      expect(fake.sendPhoto).not.toHaveBeenCalled();
    });

    it('rejects a caption over 1024 chars at the schema boundary', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_photo', {
        photo_url: 'https://example.com/pic.jpg',
        caption: 'x'.repeat(1025)
      });

      const rejected = res.body.error !== undefined || res.body.result?.isError === true;
      expect(rejected).toBe(true);
      expect(fake.sendPhoto).not.toHaveBeenCalled();
    });
  });

  describe('edit_post', () => {
    it('edits a text post and reports the link', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'edit_post', { message_id: 42, text: 'updated <b>text</b>' });

      expect(res.body.result.isError).toBeFalsy();
      expect(fake.editMessageText).toHaveBeenCalledWith({
        chatId: CHANNEL_ID,
        messageId: 42,
        text: 'updated <b>text</b>',
        parseMode: 'HTML'
      });
      expect(res.body.result.content[0].text).toContain('https://t.me/testchannel/42');
    });

    it('falls back to a caption edit when the post is a media message', async () => {
      const fake = fakeTelegram();
      fake.editMessageText.mockRejectedValueOnce(
        new TelegramApiError(
          'Telegram API editMessageText failed (400): Bad Request: there is no text in the message to edit',
          { errorCode: 400 }
        )
      );

      const res = await callTool(fake.client, 'edit_post', { message_id: 42, text: 'new caption' });

      expect(fake.editMessageCaption).toHaveBeenCalledWith({
        chatId: CHANNEL_ID,
        messageId: 42,
        caption: 'new caption',
        parseMode: 'HTML'
      });
      expect(res.body.result.isError).toBeFalsy();
      expect(res.body.result.content[0].text).toMatch(/caption/i);
    });

    it('surfaces an actionable error when the message does not exist', async () => {
      const fake = fakeTelegram();
      fake.editMessageText.mockRejectedValue(
        new TelegramApiError(
          'Telegram API editMessageText failed (400): Bad Request: message to edit not found',
          { errorCode: 400 }
        )
      );

      const res = await callTool(fake.client, 'edit_post', { message_id: 9999, text: 'nope' });

      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/not found/i);
    });
  });

  describe('delete_post', () => {
    it('refuses to delete without confirm: true and never calls Telegram', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'delete_post', { message_id: 42, confirm: false });

      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/confirm/i);
      expect(fake.deleteMessage).not.toHaveBeenCalled();
    });

    it('deletes the message when confirmed', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'delete_post', { message_id: 42, confirm: true });

      expect(res.body.result.isError).toBeFalsy();
      expect(fake.deleteMessage).toHaveBeenCalledWith(CHANNEL_ID, 42);
      expect(res.body.result.content[0].text).toMatch(/deleted/i);
    });
  });

  describe('post_video', () => {
    it('posts a video by URL and reports the link', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_video', {
        video_url: 'https://example.com/clip.mp4',
        caption: 'watch'
      });

      expect(res.body.result.isError).toBeFalsy();
      expect(fake.sendVideo).toHaveBeenCalledWith({
        chatId: CHANNEL_ID,
        videoUrl: 'https://example.com/clip.mp4',
        caption: 'watch',
        parseMode: 'HTML',
        silent: false
      });
      expect(res.body.result.content[0].text).toContain('https://t.me/testchannel/66');
    });

    it('rejects a non-http(s) video URL at the schema boundary', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_video', { video_url: 'file:///tmp/x.mp4' });

      const rejected = res.body.error !== undefined || res.body.result?.isError === true;
      expect(rejected).toBe(true);
      expect(fake.sendVideo).not.toHaveBeenCalled();
    });
  });

  describe('post registry (get_post / list_recent_posts)', () => {
    it('tracks a published post and returns its details', async () => {
      const fake = fakeTelegram();
      const app = appWith(fake.client);

      await callToolOn(app, 'post_to_channel', { text: 'diary entry one' });
      const res = await callToolOn(app, 'get_post', { message_id: 101 });

      expect(res.body.result.isError).toBeFalsy();
      const text = res.body.result.content[0].text as string;
      expect(text).toContain('diary entry one');
      expect(text).toContain('101');
    });

    it('says so when a post is not tracked', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'get_post', { message_id: 12345 });

      expect(res.body.result.content[0].text).toMatch(/no record/i);
    });

    it('lists recent posts newest first and reflects edits and deletes', async () => {
      const fake = fakeTelegram();
      const app = appWith(fake.client);

      await callToolOn(app, 'post_to_channel', { text: 'first entry' });
      await callToolOn(app, 'post_to_channel', { text: 'second entry' });
      await callToolOn(app, 'edit_post', { message_id: 101, text: 'first entry (edited)' });
      await callToolOn(app, 'delete_post', { message_id: 102, confirm: true });

      const res = await callToolOn(app, 'list_recent_posts', {});

      const text = res.body.result.content[0].text as string;
      expect(text.indexOf('102')).toBeLessThan(text.indexOf('101'));
      expect(text).toMatch(/edited/i);
      expect(text).toMatch(/deleted/i);
    });
  });

  describe('post_photo with an uploaded file', () => {
    it('resolves a file_id from the file store and sends it as a buffer', async () => {
      const fake = fakeTelegram();
      const files = createFileStore();
      const fileId = files.put({ data: Buffer.from('img'), filename: 'shot.jpg', contentType: 'image/jpeg' });
      const app = appWith(fake.client, { files });

      const res = await callToolOn(app, 'post_photo', { file_id: fileId, caption: 'local!' });

      expect(res.body.result.isError).toBeFalsy();
      const sentWith = fake.sendPhoto.mock.calls[0]![0] as { photoFile?: { filename: string } };
      expect(sentWith.photoFile?.filename).toBe('shot.jpg');
    });

    it('rejects an unknown or expired file_id with an actionable message', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_photo', { file_id: 'gone' });

      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/expire|upload/i);
      expect(fake.sendPhoto).not.toHaveBeenCalled();
    });

    it('rejects providing both photo_url and file_id', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_photo', {
        photo_url: 'https://example.com/a.jpg',
        file_id: 'also-this'
      });

      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/exactly one/i);
    });
  });

  describe('post_document', () => {
    it('posts a document by URL', async () => {
      const fake = fakeTelegram();
      fake.sendDocument = fake.sendDocument ?? vi.fn();

      const res = await callTool(fake.client, 'post_document', {
        document_url: 'https://example.com/notes.pdf',
        caption: 'my notes'
      });

      expect(res.body.result.isError).toBeFalsy();
      expect(fake.sendDocument).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: CHANNEL_ID, documentUrl: 'https://example.com/notes.pdf' })
      );
    });
  });

  describe('post_media_group', () => {
    it('posts an album and reports all message ids', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_media_group', {
        items: [
          { type: 'photo', url: 'https://example.com/1.jpg', caption: 'album' },
          { type: 'photo', url: 'https://example.com/2.jpg' }
        ]
      });

      expect(res.body.result.isError).toBeFalsy();
      const text = res.body.result.content[0].text as string;
      expect(text).toContain('70');
      expect(text).toContain('71');
    });

    it('rejects an album with fewer than two items at the schema boundary', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_media_group', {
        items: [{ type: 'photo', url: 'https://example.com/1.jpg' }]
      });

      const rejected = res.body.error !== undefined || res.body.result?.isError === true;
      expect(rejected).toBe(true);
      expect(fake.sendMediaGroup).not.toHaveBeenCalled();
    });
  });

  describe('post_poll', () => {
    it('posts a poll and records it', async () => {
      const fake = fakeTelegram();
      const app = appWith(fake.client);

      const res = await callToolOn(app, 'post_poll', {
        question: 'Next book?',
        options: ['Deep Work', 'Atomic Habits']
      });

      expect(res.body.result.isError).toBeFalsy();
      expect(fake.sendPoll).toHaveBeenCalledWith(
        expect.objectContaining({ question: 'Next book?', options: ['Deep Work', 'Atomic Habits'] })
      );

      const details = await callToolOn(app, 'get_post', { message_id: 88 });
      expect(details.body.result.content[0].text).toContain('poll');
    });

    it('rejects a quiz index outside the options range', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'post_poll', {
        question: 'x?',
        options: ['a', 'b'],
        quiz_correct_option_index: 5
      });

      expect(res.body.result.isError).toBe(true);
      expect(fake.sendPoll).not.toHaveBeenCalled();
    });
  });

  describe('pin_post / unpin_post', () => {
    it('pins quietly and unpins by id', async () => {
      const fake = fakeTelegram();
      const app = appWith(fake.client);

      const pin = await callToolOn(app, 'pin_post', { message_id: 42 });
      const unpin = await callToolOn(app, 'unpin_post', { message_id: 42 });

      expect(pin.body.result.isError).toBeFalsy();
      expect(fake.pinChatMessage).toHaveBeenCalledWith(CHANNEL_ID, 42, true);
      expect(unpin.body.result.isError).toBeFalsy();
      expect(fake.unpinChatMessage).toHaveBeenCalledWith(CHANNEL_ID, 42);
    });
  });

  describe('scheduling', () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    it('queues, lists and cancels a scheduled post', async () => {
      const fake = fakeTelegram();
      const app = appWith(fake.client);

      const scheduled = await callToolOn(app, 'schedule_post', { text: 'later post', publish_at: futureIso });
      expect(scheduled.body.result.isError).toBeFalsy();
      const idMatch = /Scheduled post ([0-9a-f-]{36})/.exec(scheduled.body.result.content[0].text as string);
      expect(idMatch).not.toBeNull();

      const listed = await callToolOn(app, 'list_scheduled_posts', {});
      expect(listed.body.result.content[0].text).toContain('later post');

      const cancelled = await callToolOn(app, 'cancel_scheduled_post', { id: idMatch![1] });
      expect(cancelled.body.result.isError).toBeFalsy();

      const relisted = await callToolOn(app, 'list_scheduled_posts', {});
      expect(relisted.body.result.content[0].text).toMatch(/no scheduled posts/i);
    });

    it('warns about the in-memory queue when persistence is off', async () => {
      const res = await callTool(fakeTelegram().client, 'schedule_post', {
        text: 'x',
        publish_at: futureIso
      });

      expect(res.body.result.content[0].text).toMatch(/CAUTION|lost/i);
    });

    it('rejects a publish_at in the past', async () => {
      const res = await callTool(fakeTelegram().client, 'schedule_post', {
        text: 'x',
        publish_at: '2020-01-01T00:00:00+00:00'
      });

      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/past/i);
    });

    it('says so when cancelling an unknown id', async () => {
      const res = await callTool(fakeTelegram().client, 'cancel_scheduled_post', { id: 'nope' });

      expect(res.body.result.isError).toBe(true);
    });
  });

  describe('get_channel_info', () => {
    it('reports channel identity and confirms posting rights', async () => {
      const fake = fakeTelegram();

      const res = await callTool(fake.client, 'get_channel_info', {});

      expect(res.body.result.isError).toBeFalsy();
      const text = res.body.result.content[0].text as string;
      expect(text).toContain("Nabiev's blog");
      expect(text).toContain('-100999');
      expect(text).toMatch(/posting rights: yes/i);
      expect(fake.getChatMember).toHaveBeenCalledWith(-100999, 111);
    });

    it('says posting rights are missing when the bot is a plain member', async () => {
      const fake = fakeTelegram();
      fake.getChatMember.mockResolvedValue({ status: 'member' });

      const res = await callTool(fake.client, 'get_channel_info', {});

      const text = res.body.result.content[0].text as string;
      expect(text).toMatch(/posting rights: no/i);
      expect(text).toMatch(/admin/i);
    });

    it('returns an isError result when the channel cannot be read', async () => {
      const fake = fakeTelegram();
      fake.getChat.mockRejectedValue(
        new TelegramApiError(
          'Telegram says "chat not found" (400). Check TELEGRAM_CHANNEL_ID and make sure the bot was added to that channel.',
          { errorCode: 400 }
        )
      );

      const res = await callTool(fake.client, 'get_channel_info', {});

      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/chat not found/i);
    });
  });
});
