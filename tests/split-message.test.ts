import { describe, expect, it } from 'vitest';

import { splitMessage, TELEGRAM_MESSAGE_LIMIT } from '../src/telegram/split-message.js';

describe('splitMessage', () => {
  it('returns the text as a single chunk when it fits the limit', () => {
    expect(splitMessage('hello world')).toEqual(['hello world']);
  });

  it('uses the Telegram limit of 4096 by default', () => {
    expect(TELEGRAM_MESSAGE_LIMIT).toBe(4096);
    expect(splitMessage('a'.repeat(4096))).toHaveLength(1);
    expect(splitMessage('a'.repeat(4097))).toHaveLength(2);
  });

  it('prefers splitting at paragraph boundaries', () => {
    const text = 'aaa\n\nbbb\n\nccc';

    const chunks = splitMessage(text, 9);

    // greedy: 'bbb\n\nccc' (8 chars) fits the 9-char limit, so it stays whole
    expect(chunks).toEqual(['aaa\n\n', 'bbb\n\nccc']);
  });

  it('falls back to newline boundaries when no paragraph break fits', () => {
    const text = 'aaa\nbbb\nccc';

    const chunks = splitMessage(text, 9);

    expect(chunks).toEqual(['aaa\nbbb\n', 'ccc']);
  });

  it('hard-splits a single overlong word at the limit', () => {
    const chunks = splitMessage('x'.repeat(25), 10);

    expect(chunks).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });

  it('never emits a chunk over the limit and reassembles to the original text', () => {
    const cases = [
      'p1 '.repeat(400) + '\n\n' + 'p2 '.repeat(400) + '\n\n' + 'p3 '.repeat(400),
      'line\n'.repeat(500),
      'nospaceatall'.repeat(200),
      'mixed\n\npara\nline' + 'word'.repeat(300)
    ];

    for (const text of cases) {
      const chunks = splitMessage(text, 100);

      expect(chunks.join('')).toBe(text);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it('does not create an empty leading chunk when a boundary sits at position 0', () => {
    const text = '\n\n' + 'a'.repeat(30);

    const chunks = splitMessage(text, 10);

    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });
});
