import { randomUUID } from 'node:crypto';

export interface StoredFile {
  readonly data: Buffer;
  readonly filename: string;
  readonly contentType: string;
}

export interface FileStoreOptions {
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
  readonly ttlMs?: number;
  readonly nowFn?: () => number;
}

export interface FileStore {
  readonly put: (file: StoredFile) => string;
  readonly get: (id: string) => StoredFile | undefined;
  readonly maxFileBytes: number;
  readonly ttlMs: number;
}

const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * Short-lived in-memory store for uploaded files: upload → get a file_id →
 * post it within the TTL. Deliberately ephemeral — files exist to bridge one
 * upload to one Telegram send, not to be a media library.
 */
export function createFileStore(options: FileStoreOptions = {}): FileStore {
  const {
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
    ttlMs = DEFAULT_TTL_MS,
    nowFn = Date.now
  } = options;

  const files = new Map<string, StoredFile & { expiresAt: number }>();

  const sweep = (): void => {
    const now = nowFn();
    for (const [id, file] of files) {
      if (file.expiresAt <= now) {
        files.delete(id);
      }
    }
  };

  const totalBytes = (): number =>
    [...files.values()].reduce((sum, file) => sum + file.data.byteLength, 0);

  return Object.freeze({
    maxFileBytes,
    ttlMs,

    put: (file: StoredFile): string => {
      sweep();
      if (file.data.byteLength > maxFileBytes) {
        throw new Error(
          `File too large: ${file.data.byteLength} bytes (limit ${maxFileBytes}). Compress it or use a public URL instead.`
        );
      }
      if (totalBytes() + file.data.byteLength > maxTotalBytes) {
        throw new Error('Upload storage full — wait a few minutes for old uploads to expire and retry.');
      }
      const id = randomUUID();
      files.set(id, { ...file, expiresAt: nowFn() + ttlMs });
      return id;
    },

    get: (id: string): StoredFile | undefined => {
      sweep();
      const file = files.get(id);
      return file === undefined
        ? undefined
        : { data: file.data, filename: file.filename, contentType: file.contentType };
    }
  });
}
