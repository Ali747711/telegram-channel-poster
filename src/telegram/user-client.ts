import { Api, TelegramClient as GramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

export interface UserIdentity {
  readonly id: string;
  readonly username?: string;
  readonly firstName?: string;
}

export interface UserChat {
  readonly id: string;
  readonly title: string;
  readonly kind: 'user' | 'group' | 'channel';
  readonly username?: string;
  readonly unreadCount: number;
  readonly lastMessageAt?: string;
}

export interface UserMessage {
  readonly id: number;
  readonly chatId: string;
  readonly chatTitle?: string;
  readonly senderName?: string;
  readonly text: string;
  readonly date: string;
  readonly outgoing: boolean;
}

export interface ChatFolder {
  readonly id: number;
  readonly title: string;
  readonly chatCount: number;
}

/**
 * The user-account (MTProto) surface: acts AS the account owner, unlike the
 * bot client. Kept as a narrow domain interface so tools can be tested with
 * fakes and the GramJS specifics stay in one place.
 */
export interface TelegramUserClient {
  readonly getMe: () => Promise<UserIdentity>;
  readonly listDialogs: (params: { limit: number; folderId?: number }) => Promise<readonly UserChat[]>;
  readonly listFolders: () => Promise<readonly ChatFolder[]>;
  readonly readHistory: (params: { chat: string; limit: number }) => Promise<readonly UserMessage[]>;
  readonly searchMessages: (params: {
    query: string;
    chat?: string;
    limit: number;
  }) => Promise<readonly UserMessage[]>;
  readonly sendDm: (params: { to: string; text: string }) => Promise<{ messageId: number }>;
  readonly disconnect: () => Promise<void>;
}

export interface UserClientOptions {
  readonly apiId: number;
  readonly apiHash: string;
  readonly session: string;
}

const CONNECTION_RETRIES = 3;

const toIsoDate = (seconds: number | undefined): string =>
  new Date((seconds ?? 0) * 1000).toISOString();

/** Folder titles are plain strings on old layers, TextWithEntities on new ones. */
const folderTitle = (title: unknown): string => {
  if (typeof title === 'string') {
    return title;
  }
  if (typeof title === 'object' && title !== null && 'text' in title) {
    return String((title as { text: unknown }).text);
  }
  return 'untitled';
};

const dialogKind = (dialog: { isUser?: boolean; isGroup?: boolean }): UserChat['kind'] => {
  if (dialog.isUser === true) {
    return 'user';
  }
  return dialog.isGroup === true ? 'group' : 'channel';
};

const senderName = (message: { sender?: unknown; postAuthor?: string }): string | undefined => {
  const sender = message.sender as
    | { username?: string; firstName?: string; title?: string }
    | undefined;
  return (
    sender?.username ?? sender?.firstName ?? sender?.title ?? message.postAuthor ?? undefined
  );
};

export function createUserClient(options: UserClientOptions): TelegramUserClient {
  const client = new GramClient(new StringSession(options.session), options.apiId, options.apiHash, {
    connectionRetries: CONNECTION_RETRIES,
    autoReconnect: true
  });

  let connecting: Promise<void> | undefined;
  /** Lazily connect once; GramJS handles reconnects after the host sleeps. */
  const ensureConnected = async (): Promise<void> => {
    if (client.connected === true) {
      return;
    }
    connecting ??= client.connect().then(() => undefined);
    await connecting;
    connecting = undefined;
  };

  const mapMessages = async (
    chat: string,
    limit: number,
    search?: string
  ): Promise<readonly UserMessage[]> => {
    await ensureConnected();
    const entity = await client.getEntity(chat);
    const messages = await client.getMessages(entity, {
      limit,
      ...(search !== undefined ? { search } : {})
    });
    const chatTitle =
      (entity as { title?: string; username?: string }).title ??
      (entity as { username?: string }).username;

    return messages
      .filter((message) => typeof message.message === 'string' && message.message.length > 0)
      .map((message) => ({
        id: message.id,
        chatId: String(message.chatId ?? chat),
        chatTitle,
        senderName: senderName(message as never),
        text: message.message ?? '',
        date: toIsoDate(message.date),
        outgoing: message.out === true
      }));
  };

  // Annotated so the method parameters get their types from the interface.
  const impl: TelegramUserClient = {
    getMe: async (): Promise<UserIdentity> => {
      await ensureConnected();
      const me = (await client.getMe()) as {
        id: unknown;
        username?: string;
        firstName?: string;
      };
      return {
        id: String(me.id),
        ...(me.username !== undefined ? { username: me.username } : {}),
        ...(me.firstName !== undefined ? { firstName: me.firstName } : {})
      };
    },

    listDialogs: async ({ limit, folderId }): Promise<readonly UserChat[]> => {
      await ensureConnected();
      const dialogs = await client.getDialogs({ limit });

      const allowedIds =
        folderId === undefined ? undefined : new Set(await folderPeerIds(client, folderId));

      return dialogs
        .filter((dialog) => allowedIds === undefined || allowedIds.has(String(dialog.id)))
        .map((dialog) => ({
          id: String(dialog.id),
          title: dialog.title ?? dialog.name ?? 'untitled',
          kind: dialogKind(dialog),
          ...(typeof (dialog.entity as { username?: string })?.username === 'string'
            ? { username: (dialog.entity as { username?: string }).username }
            : {}),
          unreadCount: dialog.unreadCount ?? 0,
          ...(dialog.message?.date !== undefined
            ? { lastMessageAt: toIsoDate(dialog.message.date) }
            : {})
        }));
    },

    listFolders: async (): Promise<readonly ChatFolder[]> => {
      await ensureConnected();
      const result = (await client.invoke(new Api.messages.GetDialogFilters())) as unknown as {
        filters?: unknown[];
      };
      const filters = Array.isArray(result.filters) ? result.filters : [];

      return filters
        .filter((filter): filter is { id: number; title: unknown; includePeers?: unknown[] } => {
          const candidate = filter as { className?: string; id?: number };
          return candidate.className !== 'DialogFilterDefault' && typeof candidate.id === 'number';
        })
        .map((filter) => ({
          id: filter.id,
          title: folderTitle(filter.title),
          chatCount: Array.isArray(filter.includePeers) ? filter.includePeers.length : 0
        }));
    },

    readHistory: ({ chat, limit }) => mapMessages(chat, limit),

    searchMessages: async ({ query, chat, limit }): Promise<readonly UserMessage[]> => {
      if (chat !== undefined) {
        return mapMessages(chat, limit, query);
      }
      await ensureConnected();
      const found = (await client.invoke(
        new Api.messages.SearchGlobal({
          q: query,
          filter: new Api.InputMessagesFilterEmpty(),
          minDate: 0,
          maxDate: 0,
          offsetRate: 0,
          offsetPeer: new Api.InputPeerEmpty(),
          offsetId: 0,
          limit
        })
      )) as unknown as { messages?: unknown[]; chats?: unknown[]; users?: unknown[] };

      const titles = new Map<string, string>();
      for (const peer of [...(found.chats ?? []), ...(found.users ?? [])]) {
        const entry = peer as { id?: unknown; title?: string; username?: string };
        if (entry.id !== undefined) {
          titles.set(String(entry.id), entry.title ?? entry.username ?? 'unknown');
        }
      }

      return (found.messages ?? [])
        .map((raw) => raw as { id: number; message?: string; date?: number; out?: boolean; peerId?: unknown })
        .filter((message) => typeof message.message === 'string' && message.message.length > 0)
        .map((message) => {
          const peer = message.peerId as
            | { userId?: unknown; chatId?: unknown; channelId?: unknown }
            | undefined;
          const chatId = String(peer?.channelId ?? peer?.chatId ?? peer?.userId ?? 'unknown');
          return {
            id: message.id,
            chatId,
            ...(titles.has(chatId) ? { chatTitle: titles.get(chatId) } : {}),
            text: message.message ?? '',
            date: toIsoDate(message.date),
            outgoing: message.out === true
          };
        });
    },

    sendDm: async ({ to, text }): Promise<{ messageId: number }> => {
      await ensureConnected();
      const entity = await client.getEntity(to);
      const sent = await client.sendMessage(entity, { message: text });
      return { messageId: sent.id };
    },

    disconnect: async (): Promise<void> => {
      if (client.connected === true) {
        await client.disconnect();
      }
    }
  };

  return Object.freeze(impl);
}

/** Resolves the peer IDs a custom chat folder includes. */
async function folderPeerIds(client: GramClient, folderId: number): Promise<readonly string[]> {
  const result = (await client.invoke(new Api.messages.GetDialogFilters())) as unknown as {
    filters?: unknown[];
  };
  const filter = (Array.isArray(result.filters) ? result.filters : []).find(
    (candidate) => (candidate as { id?: number }).id === folderId
  ) as { includePeers?: unknown[] } | undefined;

  return (filter?.includePeers ?? []).map((peer) => {
    const entry = peer as { userId?: unknown; chatId?: unknown; channelId?: unknown };
    return String(entry.channelId ?? entry.chatId ?? entry.userId ?? '');
  });
}
