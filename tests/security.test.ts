import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Db } from '@/lib/db';
import { issueOtp, checkOtp, consumeOtp, OTP_MAX_ATTEMPTS } from '@/lib/otp';

const verify = async (db: Db, phone: string, purpose: 'signup' | 'withdrawal', code: string, now?: Date) => {
  const id = await checkOtp(db, phone, purpose, code, now);
  await db.tx((q) => consumeOtp(q, id));
};
import { hit, rateLimit, clientIp } from '@/lib/ratelimit';
import { csrfCheck, readCsrfCookie } from '@/lib/csrf';
import { audit, listAudit } from '@/lib/audit';
import { getSmsSender, twilioSms } from '@/lib/sms';
import { createUser } from '@/lib/users';
import { credit } from '@/lib/wallet';
import { requestWithdrawal, reviewWithdrawal } from '@/lib/withdrawals';
import { freshDb, makeUser, captureSms, withdrawWithOtp } from './helpers';

let db: Db;
beforeEach(async () => { db = await freshDb(); });
const PHONE = '+264812000001';

describe('SMS OTP', () => {
  it('texts a 6-digit code that works once', async () => {
    const sms = captureSms();
    const { code } = await issueOtp(db, sms, PHONE, 'signup');
    expect(code).toMatch(/^\d{6}$/);
    expect(sms.sent[0]).toMatchObject({ to: PHONE });
    expect(sms.sent[0].text).toContain(code);
    expect((await db.q('SELECT code_hash FROM otp_codes'))[0].code_hash).not.toContain(code); // only a hash is stored
    await verify(db, PHONE, 'signup', code);
    await expect(verify(db, PHONE, 'signup', code)).rejects.toMatchObject({ code: 'otp_expired' });
  });
  it('a checked code is only consumed once, and only if the action commits', async () => {
    const { code } = await issueOtp(db, captureSms(), PHONE, 'signup');
    const id = await checkOtp(db, PHONE, 'signup', code);
    await expect(db.tx(async (q) => { await consumeOtp(q, id); throw new Error('action failed'); })).rejects.toThrow('action failed');
    const again = await checkOtp(db, PHONE, 'signup', code); // still usable after the rollback
    await db.tx((q) => consumeOtp(q, again));
    await expect(db.tx((q) => consumeOtp(q, id))).rejects.toMatchObject({ code: 'otp_expired' });
  });
  it('is bound to phone and purpose, expires, and a new code replaces the old one', async () => {
    const sms = captureSms();
    const { code } = await issueOtp(db, sms, PHONE, 'signup');
    await expect(verify(db, PHONE, 'withdrawal', code)).rejects.toMatchObject({ code: 'otp_expired' });
    await expect(verify(db, '+264812000002', 'signup', code)).rejects.toMatchObject({ code: 'otp_expired' });
    const second = await issueOtp(db, sms, PHONE, 'signup');
    if (second.code !== code) await expect(verify(db, PHONE, 'signup', code)).rejects.toMatchObject({ code: 'otp_invalid' });
    const later = new Date(Date.now() + 301_000);
    await expect(verify(db, PHONE, 'signup', second.code, later)).rejects.toMatchObject({ code: 'otp_expired' });
  });
  it(`burns the code after ${OTP_MAX_ATTEMPTS} wrong guesses`, async () => {
    const { code } = await issueOtp(db, captureSms(), PHONE, 'signup');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) await expect(verify(db, PHONE, 'signup', wrong)).rejects.toMatchObject({ code: 'otp_invalid' });
    await expect(verify(db, PHONE, 'signup', code)).rejects.toMatchObject({ code: 'otp_expired' });
  });
  it('sign-up with OTP marks the phone verified; a wrong code creates nothing', async () => {
    const input = { phone: '0812000001', password: 'secret-pass', firstName: 'A', lastName: 'B', dob: '1990-01-01' };
    await issueOtp(db, captureSms(), PHONE, 'signup');
    await expect(createUser(db, input, { otpCode: '999999' })).rejects.toMatchObject({ code: expect.stringMatching(/otp_/) });
    expect(await db.q('SELECT 1 FROM users')).toHaveLength(0);
    const { code } = await issueOtp(db, captureSms(), PHONE, 'signup');
    const u = await createUser(db, input, { otpCode: code });
    expect((await db.q('SELECT phone_verified_at FROM users WHERE id=$1', [u.id]))[0].phone_verified_at).not.toBeNull();
  });
  it('withdrawals need a valid SMS code', async () => {
    const u = await makeUser(db, { kyc: 'verified' });
    await credit(db.q, u.id, 50_000, 'deposit', 'd');
    await expect(requestWithdrawal(db, u.id, 10_000, { otpCode: '123456' })).rejects.toMatchObject({ code: 'otp_expired' });
    await expect(requestWithdrawal(db, u.id, 10_000, { otpCode: '' })).rejects.toMatchObject({ code: 'otp_invalid' });
    expect((await withdrawWithOtp(db, u.id, 10_000)).status).toBe('pending');
  });
  it('SMS sender: dev console only outside production; Twilio request shape', async () => {
    expect(getSmsSender({}).name).toBe('console');
    expect(() => getSmsSender({ NODE_ENV: 'production' })).toThrow();
    expect(() => getSmsSender({ SMS_PROVIDER: 'console', NODE_ENV: 'production' })).toThrow();
    let sent: any;
    const t = twilioSms({ accountSid: 'AC1', authToken: 'tok', from: 'Wozabet', fetchImpl: (async (url: string, init: any) => { sent = { url, init }; return new Response('{}', { status: 201 }); }) as any });
    await t.send(PHONE, 'hi');
    expect(sent.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(new URLSearchParams(sent.init.body).get('To')).toBe(PHONE);
  });
});

describe('rate limiting (database)', () => {
  it('counts per key and window and resets in the next window', async () => {
    const t = new Date('2026-11-26T10:00:05Z');
    for (let i = 1; i <= 3; i++) expect((await hit(db, 'k', 3, 60, t)).ok).toBe(true);
    const r = await hit(db, 'k', 3, 60, t);
    expect(r).toMatchObject({ ok: false, count: 4 });
    expect(r.retryAfterSec).toBe(55);
    expect((await hit(db, 'other', 3, 60, t)).ok).toBe(true);
    expect((await hit(db, 'k', 3, 60, new Date('2026-11-26T10:01:00Z'))).ok).toBe(true);
    await expect((async () => { for (let i = 0; i < 5; i++) await rateLimit(db, 'x', 2, 60); })()).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
  });
  it('counts correctly under concurrent hits', async () => {
    const t = new Date();
    const rs = await Promise.all(Array.from({ length: 10 }, () => hit(db, 'c', 5, 60, t)));
    expect(rs.filter((r) => r.ok)).toHaveLength(5);
  });
  it('only trusts X-Forwarded-For behind a configured proxy', () => {
    const req = new Request('http://x/', { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } });
    expect(clientIp(req, {})).toBe('direct');
    expect(clientIp(req, { TRUST_PROXY: 'true' })).toBe('1.2.3.4');
  });
  it('login route locks a phone after repeated failures', async () => {
    await makeUser(db);
    const phone = (await db.q<{ phone: string }>('SELECT phone FROM users'))[0].phone;
    const { POST } = await import('@/app/api/auth/login/route');
    const login = (password: string) => POST(new Request('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }), headers: { 'content-type': 'application/json' } }));
    for (let i = 0; i < 8; i++) expect((await login('wrong-password')).status).toBe(401);
    expect((await login('wrong-password')).status).toBe(429);
    expect((await listAudit(db.q, { action: 'auth.login_failed' })).length).toBe(8);
  });
});

describe('CSRF', () => {
  const base = { url: 'https://wozabet.na/api/bets', origin: 'https://wozabet.na', referer: null, cookieToken: 'a'.repeat(32), headerToken: 'a'.repeat(32) };
  it('allows same-origin writes with matching token', () => {
    expect(csrfCheck({ ...base, method: 'POST' }).ok).toBe(true);
    expect(csrfCheck({ ...base, method: 'POST', origin: null, referer: 'https://wozabet.na/me' }).ok).toBe(true);
  });
  it('blocks cross-site, missing origin, missing or mismatched token', () => {
    expect(csrfCheck({ ...base, method: 'POST', origin: 'https://evil.example' })).toEqual({ ok: false, reason: 'bad_origin' });
    expect(csrfCheck({ ...base, method: 'POST', origin: null })).toEqual({ ok: false, reason: 'bad_origin' });
    expect(csrfCheck({ ...base, method: 'POST', headerToken: null })).toEqual({ ok: false, reason: 'bad_token' });
    expect(csrfCheck({ ...base, method: 'DELETE', headerToken: 'b'.repeat(32) })).toEqual({ ok: false, reason: 'bad_token' });
    expect(csrfCheck({ ...base, method: 'POST', cookieToken: 'short', headerToken: 'short' })).toEqual({ ok: false, reason: 'bad_token' });
  });
  it('skips safe methods, pages, webhooks, cron; honours ALLOWED_ORIGINS', () => {
    expect(csrfCheck({ ...base, method: 'GET', origin: 'https://evil.example', headerToken: null }).ok).toBe(true);
    expect(csrfCheck({ ...base, method: 'POST', url: 'https://wozabet.na/join', origin: null, headerToken: null }).ok).toBe(true);
    expect(csrfCheck({ ...base, method: 'POST', url: 'https://wozabet.na/api/payments/webhook/mobile_wallet', origin: null, headerToken: null }).ok).toBe(true);
    expect(csrfCheck({ ...base, method: 'POST', url: 'https://wozabet.na/api/cron/sync', origin: null, headerToken: null }).ok).toBe(true);
    expect(csrfCheck({ ...base, method: 'POST', origin: 'https://www.wozabet.na', allowedOrigins: ['https://www.wozabet.na'] }).ok).toBe(true);
  });
  it('reads the token from document.cookie', () => {
    expect(readCsrfCookie('a=1; wb_csrf=abc123; b=2')).toBe('abc123');
    expect(readCsrfCookie('a=1')).toBe('');
  });
});

describe('audit log', () => {
  it('is append-only at database level', async () => {
    await audit(db.q, { actorId: null, action: 'test.event' });
    await expect(db.q("UPDATE audit_log SET action='tampered'")).rejects.toThrow(/append-only/);
    await expect(db.q('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
    expect((await listAudit(db.q))[0].action).toBe('test.event');
  });
  it('records money events and admin actions, and rolls back with a failed action', async () => {
    const admin = await makeUser(db, { role: 'admin' });
    const u = await makeUser(db, { kyc: 'verified' });
    await credit(db.q, u.id, 50_000, 'deposit', 'd');
    const w = await withdrawWithOtp(db, u.id, 10_000);
    await reviewWithdrawal(db, admin.id, w.id, { action: 'reject', reason: 'Test' });
    const actions = (await listAudit(db.q, { targetId: w.id })).map((e) => e.action);
    expect(actions.sort()).toEqual(['withdrawal.rejected', 'withdrawal.requested']);
    const rej = (await listAudit(db.q, { action: 'withdrawal.rejected' }))[0];
    expect(rej).toMatchObject({ actorId: admin.id, amountCents: 10_000, details: { reason: 'Test', userId: u.id } });

    const before = (await listAudit(db.q)).length;
    await expect(withdrawWithOtp(db, u.id, 999_999)).rejects.toBeTruthy(); // insufficient funds -> no audit row
    expect((await listAudit(db.q)).length).toBe(before);
  });
});
