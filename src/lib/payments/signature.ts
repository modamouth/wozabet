import crypto from 'node:crypto';

/** Webhooks older than this are rejected, so a captured request can't be replayed later. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** HMAC-SHA256 (hex) over `${timestamp}.${rawBody}`. */
export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifyHmac(secret: string, rawBody: string, timestampHeader: string | null, signatureHeader: string | null, now = new Date()): boolean {
  if (!secret || !timestampHeader || !signatureHeader) return false;
  if (!/^\d{1,12}$/.test(timestampHeader) || !/^[0-9a-f]{64}$/i.test(signatureHeader)) return false;
  const ts = Number(timestampHeader);
  if (Math.abs(now.getTime() / 1000 - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signPayload(secret, ts, rawBody), 'hex');
  const given = Buffer.from(signatureHeader, 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
