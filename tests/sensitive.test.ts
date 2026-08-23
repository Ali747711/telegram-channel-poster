import { describe, expect, it } from 'vitest';

import { isServiceChat, redactSensitive, SERVICE_CHAT_ID } from '../src/telegram/sensitive.js';

describe('isServiceChat', () => {
  it('recognises the Telegram service account that delivers login codes', () => {
    expect(isServiceChat(SERVICE_CHAT_ID)).toBe(true);
    expect(isServiceChat('777000')).toBe(true);
    expect(isServiceChat(777000)).toBe(true);
  });

  it('treats normal chats as non-service', () => {
    expect(isServiceChat('123456789')).toBe(false);
    expect(isServiceChat(undefined)).toBe(false);
  });
});

describe('redactSensitive', () => {
  it('masks Telegram login codes in any phrasing', () => {
    expect(redactSensitive('Login code: 12345. Do not give it to anyone.')).not.toContain('12345');
    expect(redactSensitive('Your login code is 54321')).not.toContain('54321');
    expect(redactSensitive('Код подтверждения: 24680')).not.toContain('24680');
  });

  it('masks 2FA / verification / one-time codes', () => {
    expect(redactSensitive('Your verification code: 998877')).not.toContain('998877');
    expect(redactSensitive('2FA code 4321')).not.toContain('4321');
    expect(redactSensitive('Your one-time password is 135790')).not.toContain('135790');
  });

  it('leaves ordinary text and ordinary numbers untouched', () => {
    const text = 'I ran 12345 steps today and finished chapter 7.';

    expect(redactSensitive(text)).toBe(text);
  });

  it('leaves an empty string alone', () => {
    expect(redactSensitive('')).toBe('');
  });
});
