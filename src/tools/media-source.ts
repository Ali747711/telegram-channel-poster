import type { FilePayload } from '../telegram/client.js';
import type { ToolDeps } from './deps.js';

export interface MediaSource {
  readonly url?: string;
  readonly file?: FilePayload;
  readonly error?: string;
}

/**
 * Resolves the url-or-file_id choice every media tool offers.
 * Exactly one of the two must be provided; file_id comes from POST /upload.
 */
export function resolveMediaSource(
  deps: ToolDeps,
  url: string | undefined,
  fileId: string | undefined
): MediaSource {
  if ((url === undefined) === (fileId === undefined)) {
    return { error: 'Provide exactly one of: a public http(s) URL, or a file_id from POST /upload.' };
  }
  if (url !== undefined) {
    return { url };
  }
  const stored = deps.files.get(fileId!);
  if (stored === undefined) {
    return {
      error: `No uploaded file with id "${fileId}". Uploads expire after ${Math.round(deps.files.ttlMs / 60_000)} minutes — upload again via POST /upload.`
    };
  }
  return { file: stored };
}
