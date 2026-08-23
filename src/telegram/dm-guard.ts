import type { Kv } from '../storage/kv.js';

/**
 * Conservative cap on outbound direct messages per calendar day (UTC).
 * Automated DMing is what Telegram's anti-spam system watches; this keeps
 * a runaway loop or a bad prompt from getting the account limited.
 */
export const DM_DAILY_LIMIT = 20;

export interface DmBudget {
  readonly allowed: boolean;
  readonly remaining: number;
}

export interface DmGuard {
  readonly check: () => Promise<DmBudget>;
  readonly record: () => Promise<void>;
}

const dayKey = (nowMs: number): string => `dm:sent:${new Date(nowMs).toISOString().slice(0, 10)}`;

export function createDmGuard(kv: Kv, nowFn: () => number = Date.now): DmGuard {
  const readCount = async (): Promise<number> => {
    const raw = await kv.get(dayKey(nowFn()));
    const parsed = raw === undefined ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return Object.freeze({
    check: async (): Promise<DmBudget> => {
      const sent = await readCount();
      return { allowed: sent < DM_DAILY_LIMIT, remaining: Math.max(0, DM_DAILY_LIMIT - sent) };
    },

    record: async (): Promise<void> => {
      await kv.set(dayKey(nowFn()), String((await readCount()) + 1));
    }
  });
}
