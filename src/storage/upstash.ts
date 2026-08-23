import type { Kv } from './kv.js';

/**
 * Upstash Redis over its REST API — plain fetch, no driver dependency.
 * One JSON array per request: ["SET", "key", "value"] → { result: "OK" }.
 */
export function createUpstashKv(restUrl: string, restToken: string, fetchFn: typeof fetch = fetch): Kv {
  const exec = async (command: readonly string[]): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchFn(restUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${restToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(10_000)
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Upstash is unreachable (${command[0]}): ${detail}`);
    }

    let body: { result?: unknown; error?: string };
    try {
      body = (await response.json()) as { result?: unknown; error?: string };
    } catch {
      throw new Error(`Upstash returned a non-JSON response (${command[0]}, HTTP ${response.status})`);
    }
    if (body.error !== undefined) {
      throw new Error(`Upstash ${command[0]} failed: ${body.error}`);
    }
    return body.result;
  };

  const asStrings = (result: unknown): readonly string[] =>
    Array.isArray(result) ? result.map(String) : [];

  return Object.freeze({
    get: async (key: string) => {
      const result = await exec(['GET', key]);
      return result === null || result === undefined ? undefined : String(result);
    },
    set: async (key: string, value: string) => {
      await exec(['SET', key, value]);
    },
    del: async (keys: readonly string[]) => {
      if (keys.length > 0) {
        await exec(['DEL', ...keys]);
      }
    },
    rpush: async (key: string, value: string) => {
      await exec(['RPUSH', key, value]);
    },
    lrange: async (key: string, start: number, stop: number) =>
      asStrings(await exec(['LRANGE', key, String(start), String(stop)])),
    ltrim: async (key: string, start: number, stop: number) => {
      await exec(['LTRIM', key, String(start), String(stop)]);
    },
    zadd: async (key: string, score: number, member: string) => {
      await exec(['ZADD', key, String(score), member]);
    },
    zrange: async (key: string, start: number, stop: number) =>
      asStrings(await exec(['ZRANGE', key, String(start), String(stop)])),
    zrangebyscore: async (key: string, min: number, max: number) =>
      asStrings(await exec(['ZRANGEBYSCORE', key, String(min), String(max)])),
    zrem: async (key: string, member: string) => {
      await exec(['ZREM', key, member]);
    }
  });
}
