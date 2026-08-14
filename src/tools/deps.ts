import type { PostRegistry } from '../post-registry.js';
import type { TelegramClient } from '../telegram/client.js';
import type { Logger } from '../utils/logger.js';

export interface ToolDeps {
  readonly telegram: TelegramClient;
  readonly channelId: string;
  readonly logger: Logger;
  readonly registry: PostRegistry;
}
