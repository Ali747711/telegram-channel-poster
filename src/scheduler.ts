import type { PostRegistry } from './post-registry.js';
import type { ScheduleStore } from './schedule-store.js';
import type { TelegramClient } from './telegram/client.js';
import type { Logger } from './utils/logger.js';

export interface SchedulerDeps {
  readonly schedule: ScheduleStore;
  readonly registry: PostRegistry;
  readonly telegram: TelegramClient;
  readonly channelId: string;
  readonly logger: Logger;
  readonly nowFn?: () => number;
}

const MAX_OVERDUE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Publishes every due scheduled post. Failed sends stay queued and retry on
 * the next tick; posts more than a day overdue (e.g. the free-tier server
 * slept through them and only woke much later) are dropped with a warning
 * rather than published embarrassingly late.
 */
export async function runSchedulerTick(deps: SchedulerDeps): Promise<number> {
  const { schedule, registry, telegram, channelId, logger, nowFn = Date.now } = deps;
  const now = nowFn();
  const duePosts = await schedule.due(now);
  let posted = 0;

  for (const post of duePosts) {
    if (now - post.publishAtMs > MAX_OVERDUE_MS) {
      logger.warn('dropping stale scheduled post', { id: post.id, publishAtMs: post.publishAtMs });
      await schedule.remove(post.id);
      continue;
    }

    try {
      const sent = await telegram.sendMessage({
        chatId: channelId,
        text: post.text,
        parseMode: post.parseMode,
        disableLinkPreview: post.disableLinkPreview,
        silent: post.silent
      });
      await registry.record({ messageId: sent.messageId, kind: 'text', content: post.text, link: sent.link });
      await schedule.remove(post.id);
      posted += 1;
      logger.info('scheduled post published', { id: post.id, messageId: sent.messageId });
    } catch (error) {
      logger.error('scheduled post failed, will retry next tick', {
        id: post.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return posted;
}

export function startScheduler(deps: SchedulerDeps, intervalMs = DEFAULT_INTERVAL_MS): { stop: () => void } {
  const tick = (): void => {
    runSchedulerTick(deps).catch((error: unknown) => {
      deps.logger.error('scheduler tick crashed', {
        message: error instanceof Error ? error.message : String(error)
      });
    });
  };

  tick(); // catch-up immediately on boot (the server may have slept through publish times)
  const timer = setInterval(tick, intervalMs);
  timer.unref();

  return Object.freeze({
    stop: () => {
      clearInterval(timer);
    }
  });
}
