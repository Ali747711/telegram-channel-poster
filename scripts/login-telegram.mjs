#!/usr/bin/env node
/**
 * One-time interactive Telegram user login.
 *
 *   npm run login:telegram
 *
 * Asks Telegram to send you a login code, then prints a SESSION STRING.
 * That string IS your account — anyone holding it can read your messages and
 * send as you. It is written to .env (gitignored); never commit or share it.
 * Revoke anytime: Telegram → Settings → Devices → terminate the session.
 */
import { appendFileSync, readFileSync } from 'node:fs';

import input from 'input';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const ENV_PATH = new URL('../.env', import.meta.url).pathname;

const apiId = Number.parseInt(process.env.TELEGRAM_API_ID ?? '', 10);
const apiHash = process.env.TELEGRAM_API_HASH ?? '';

if (!Number.isFinite(apiId) || apiHash.length === 0) {
  process.stderr.write(
    'Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in .env.\n' +
      'Get them from https://my.telegram.org → API development tools.\n'
  );
  process.exit(1);
}

if (/^TELEGRAM_SESSION=.+/m.test(readFileSync(ENV_PATH, 'utf8'))) {
  const replace = await input.confirm('A TELEGRAM_SESSION already exists in .env. Log in again?', {
    default: false
  });
  if (!replace) {
    process.stdout.write('Keeping the existing session. Nothing changed.\n');
    process.exit(0);
  }
}

process.stdout.write('\nLogging in to Telegram as a USER (not a bot).\n');
process.stdout.write('The code Telegram sends you stays in this terminal.\n\n');

const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });

await client.start({
  phoneNumber: () => input.text('Phone number (international format, e.g. +82…): '),
  password: () => input.password('Two-step verification password (blank if none): '),
  phoneCode: () => input.text('Login code Telegram just sent you: '),
  onError: (error) => {
    process.stderr.write(`Login error: ${error?.message ?? String(error)}\n`);
  }
});

const session = String(client.session.save());
const me = await client.getMe();
await client.disconnect();

appendFileSync(ENV_PATH, `\nTELEGRAM_SESSION=${session}\n`);

process.stdout.write(
  `\n✅ Logged in as ${me.firstName ?? ''} ${me.username ? '@' + me.username : ''} (id ${me.id}).\n` +
    'TELEGRAM_SESSION has been appended to .env (gitignored).\n\n' +
    'To enable the user-account tools in production, copy these three values into\n' +
    'Render → Environment: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION.\n' +
    'Treat the session like a password. Revoke via Telegram → Settings → Devices.\n'
);
