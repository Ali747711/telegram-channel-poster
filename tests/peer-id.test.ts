import { describe, expect, it } from 'vitest';

import { normalizePeerId } from '../src/telegram/user-client.js';

describe('normalizePeerId', () => {
  it('matches the two id shapes Telegram reports for the same channel', () => {
    // dialogs report "-100…", folder include_peers report the bare id
    expect(normalizePeerId('-1002144083844')).toBe(normalizePeerId('2144083844'));
  });

  it('strips the plain negative sign used by legacy groups', () => {
    expect(normalizePeerId('-1152680949')).toBe('1152680949');
  });

  it('leaves plain user ids untouched', () => {
    expect(normalizePeerId('1288836399')).toBe('1288836399');
    expect(normalizePeerId(1288836399)).toBe('1288836399');
  });
});
