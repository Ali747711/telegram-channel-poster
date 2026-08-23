import type { FileStore } from '../file-store.js';
import type { PostRegistry } from '../post-registry.js';
import type { ScheduleStore } from '../schedule-store.js';
import type { TelegramClient } from '../telegram/client.js';
import type { Logger } from '../utils/logger.js';

export interface ToolDeps {
  readonly telegram: TelegramClient;
  readonly channelId: string;
  readonly logger: Logger;
  readonly registry: PostRegistry;
  readonly schedule: ScheduleStore;
  readonly files: FileStore;
  /** True when backed by Redis — controls the honesty caveats in tool output. */
  readonly persistent: boolean;
}
