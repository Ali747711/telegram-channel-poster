export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Picks where to cut a window of text: after the last paragraph break if one
 * exists past position 0, else after the last newline, else at the window end.
 * Cutting AFTER the separator keeps chunks non-empty and makes
 * chunks.join('') === original hold exactly.
 */
const findCut = (window: string): number => {
  const paragraph = window.lastIndexOf('\n\n');
  if (paragraph > 0) {
    return paragraph + 2;
  }
  const line = window.lastIndexOf('\n');
  if (line > 0) {
    return line + 1;
  }
  return window.length;
};

/**
 * Splits text into chunks of at most `limit` characters (Telegram's 4096 by
 * default), preferring paragraph then line boundaries. Guarantees: every chunk
 * is non-empty, no chunk exceeds the limit, and chunks.join('') reassembles
 * the original text.
 */
export function splitMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const cut = findCut(rest.slice(0, limit));
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  return chunks;
}
