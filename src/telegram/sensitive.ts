/** Telegram's official service account — delivers login codes and account alerts. */
export const SERVICE_CHAT_ID = '777000';

export function isServiceChat(id: string | number | undefined): boolean {
  return id !== undefined && String(id).replace('-100', '') === SERVICE_CHAT_ID;
}

/**
 * Patterns for credentials that must never leave this server, even if a user
 * forwards them into an ordinary chat. Deliberately broad: a false positive
 * only masks a number, a false negative leaks account access.
 */
const CODE_PATTERNS: readonly RegExp[] = [
  /((?:login|verification|confirmation|one[-\s]?time|2fa|otp|auth(?:entication)?)[^.\n]{0,20}?(?:code|password|pass)\D{0,12})(\d[\d\s-]{3,})/gi,
  /((?:code|password)[^.\n]{0,10}?(?:is|:)\s*)(\d[\d\s-]{3,})/gi,
  /(код[^.\n]{0,24}?[:\s])(\d[\d\s-]{3,})/gi
];

/**
 * Masks login/2FA codes in text pulled from Telegram before it reaches a model
 * or a tool result. Ordinary numbers in ordinary sentences are left alone.
 */
export function redactSensitive(text: string): string {
  return CODE_PATTERNS.reduce(
    (masked, pattern) => masked.replace(pattern, (_match, prefix: string) => `${prefix}[REDACTED]`),
    text
  );
}
