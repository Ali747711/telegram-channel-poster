import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { DmGuard } from '../telegram/dm-guard.js';
import { isServiceChat, redactSensitive } from '../telegram/sensitive.js';
import type { TelegramUserClient, UserChat, UserMessage } from '../telegram/user-client.js';
import type { ToolDeps } from './deps.js';
import { errorMessage, toolError, toolText } from './helpers.js';

export interface UserToolDeps extends ToolDeps {
  readonly userClient: TelegramUserClient;
  readonly dmGuard: DmGuard;
}

const MAX_TEXT_PREVIEW = 400;

const SERVICE_CHAT_REFUSAL =
  'Refusing: that is the Telegram service chat, which carries login codes and account alerts. ' +
  'This server never reads from or writes to it.';

const formatChat = (chat: UserChat): string => {
  const handle = chat.username !== undefined ? ` (@${chat.username})` : '';
  const unread = chat.unreadCount > 0 ? ` — ${chat.unreadCount} unread` : '';
  const last = chat.lastMessageAt !== undefined ? ` — last ${chat.lastMessageAt}` : '';
  return `[${chat.kind}] ${chat.title}${handle} · id ${chat.id}${unread}${last}`;
};

const formatMessage = (message: UserMessage, withChat: boolean): string => {
  const who = message.outgoing ? 'Me' : (message.senderName ?? 'unknown');
  const where = withChat && message.chatTitle !== undefined ? ` in ${message.chatTitle}` : '';
  const body = redactSensitive(message.text);
  const preview = body.length > MAX_TEXT_PREVIEW ? `${body.slice(0, MAX_TEXT_PREVIEW)}…` : body;
  return `#${message.id} ${message.date} ${who}${where}: ${preview}`;
};

const readMessagesTool = async (
  deps: UserToolDeps,
  chat: string,
  limit: number,
  label: string
): Promise<ReturnType<typeof toolText>> => {
  if (isServiceChat(chat)) {
    return toolError(SERVICE_CHAT_REFUSAL);
  }
  try {
    const messages = await deps.userClient.readHistory({ chat, limit });
    if (messages.length === 0) {
      return toolText(`No messages found in ${chat}.`);
    }
    return toolText(messages.map((message) => formatMessage(message, false)).join('\n'));
  } catch (error) {
    deps.logger.error(`${label} failed`, { message: errorMessage(error) });
    return toolError(`Could not read ${chat}: ${errorMessage(error)}`);
  }
};

export function registerUserTools(server: McpServer, deps: UserToolDeps): void {
  server.registerTool(
    'whoami',
    {
      title: 'Show the logged-in Telegram account',
      description:
        'Report which Telegram user account this server is acting as (from the stored user session). ' +
        'Use to confirm the account connection before other user-account tools.',
      inputSchema: {}
    },
    async () => {
      try {
        const me = await deps.userClient.getMe();
        const handle = me.username !== undefined ? `@${me.username}` : '(no username)';
        return toolText(`Acting as ${me.firstName ?? 'user'} ${handle}, id ${me.id}.`);
      } catch (error) {
        return toolError(`User session is not working: ${errorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'list_chats',
    {
      title: 'List your Telegram chats',
      description:
        'List the account owner’s dialogs (people, groups, channels) newest-activity first, with ' +
        'unread counts and ids. Optionally restrict to one chat folder or to unread chats only. ' +
        'The Telegram service chat is always excluded.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(30).describe('How many chats to return.'),
        folder_id: z
          .number()
          .int()
          .optional()
          .describe('Restrict to a chat folder (see list_folders for ids).'),
        unread_only: z.boolean().default(false).describe('Only chats with unread messages.')
      }
    },
    async ({ limit, folder_id, unread_only }) => {
      try {
        const chats = await deps.userClient.listDialogs({ limit, folderId: folder_id });
        const visible = chats
          .filter((chat) => !isServiceChat(chat.id))
          .filter((chat) => !unread_only || chat.unreadCount > 0);

        if (visible.length === 0) {
          return toolText(unread_only ? 'No unread chats.' : 'No chats found.');
        }
        return toolText(visible.map(formatChat).join('\n'));
      } catch (error) {
        deps.logger.error('list_chats failed', { message: errorMessage(error) });
        return toolError(`Could not list chats: ${errorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'list_folders',
    {
      title: 'List your chat folders',
      description:
        'List the account owner’s Telegram chat folders with their ids and chat counts. ' +
        'Pass an id to list_chats to browse one folder.',
      inputSchema: {}
    },
    async () => {
      try {
        const folders = await deps.userClient.listFolders();
        if (folders.length === 0) {
          return toolText('No custom chat folders configured.');
        }
        return toolText(
          folders.map((folder) => `id ${folder.id}: ${folder.title} (${folder.chatCount} chats)`).join('\n')
        );
      } catch (error) {
        deps.logger.error('list_folders failed', { message: errorMessage(error) });
        return toolError(`Could not list folders: ${errorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'read_chat_history',
    {
      title: 'Read messages from a chat',
      description:
        'Read recent messages from one of the account owner’s chats (by @username, numeric id, or ' +
        'phone-book name). Returns sender, timestamp and text, newest first. Login/2FA codes are redacted.',
      inputSchema: {
        chat: z.string().min(1).describe('@username, numeric chat id, or exact chat title.'),
        limit: z.number().int().min(1).max(100).default(20).describe('How many messages to read.')
      }
    },
    ({ chat, limit }) => readMessagesTool(deps, chat, limit, 'read_chat_history')
  );

  server.registerTool(
    'pull_channel_posts',
    {
      title: 'Pull recent posts from a channel',
      description:
        'Read recent posts from any channel or group the account owner has joined (by @username or id) — ' +
        'useful for catching up, summarising, or sourcing material for your own posts.',
      inputSchema: {
        channel: z.string().min(1).describe('@channelusername or numeric id of a channel you have joined.'),
        limit: z.number().int().min(1).max(100).default(20).describe('How many posts to pull.')
      }
    },
    ({ channel, limit }) => readMessagesTool(deps, channel, limit, 'pull_channel_posts')
  );

  server.registerTool(
    'search_messages',
    {
      title: 'Search your Telegram messages',
      description:
        'Full-text search across the account owner’s messages — everywhere, or inside one chat. ' +
        'Returns matches with their source chat. Login/2FA codes are redacted.',
      inputSchema: {
        query: z.string().min(1).describe('Text to search for.'),
        chat: z
          .string()
          .optional()
          .describe('Restrict the search to one chat (@username or id). Omit to search globally.'),
        limit: z.number().int().min(1).max(50).default(20).describe('How many matches to return.')
      }
    },
    async ({ query, chat, limit }) => {
      if (chat !== undefined && isServiceChat(chat)) {
        return toolError(SERVICE_CHAT_REFUSAL);
      }
      try {
        const messages = await deps.userClient.searchMessages({ query, chat, limit });
        const visible = messages.filter((message) => !isServiceChat(message.chatId));
        if (visible.length === 0) {
          return toolText(`No messages matching "${query}".`);
        }
        return toolText(visible.map((message) => formatMessage(message, true)).join('\n'));
      } catch (error) {
        deps.logger.error('search_messages failed', { message: errorMessage(error) });
        return toolError(`Search failed: ${errorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'send_dm',
    {
      title: 'Send a direct message as the account owner',
      description:
        'Send a Telegram message FROM the account owner’s personal account to a person or chat. ' +
        'This is not a bot message — the recipient sees it from the owner. Requires confirm: true, ' +
        'and the owner must have approved the exact recipient and wording first. Daily send limit applies.',
      inputSchema: {
        to: z.string().min(1).describe('@username, numeric user id, or exact contact name.'),
        text: z.string().min(1).max(4096).describe('Message text (plain text; HTML is not parsed here).'),
        confirm: z
          .boolean()
          .describe(
            'Must be true. Set it only after showing the user the exact recipient and message and getting explicit approval.'
          )
      }
    },
    async ({ to, text, confirm }) => {
      if (confirm !== true) {
        return toolError(
          `Refusing to send: confirm must be true. Show the user the exact recipient (${to}) and message text, then send after they approve.`
        );
      }
      if (isServiceChat(to)) {
        return toolError(SERVICE_CHAT_REFUSAL);
      }

      const budget = await deps.dmGuard.check();
      if (!budget.allowed) {
        return toolError(
          'Daily limit reached for outgoing direct messages. This cap protects the account from ' +
            'Telegram anti-spam limits — it resets at midnight UTC.'
        );
      }

      try {
        const sent = await deps.userClient.sendDm({ to, text });
        await deps.dmGuard.record();
        deps.logger.info('send_dm sent', { messageId: sent.messageId });
        return toolText(
          `Sent to ${to} as you (message_id ${sent.messageId}). ${budget.remaining - 1} sends remaining today.`
        );
      } catch (error) {
        deps.logger.error('send_dm failed', { message: errorMessage(error) });
        return toolError(`Could not send to ${to}: ${errorMessage(error)}`);
      }
    }
  );
}
