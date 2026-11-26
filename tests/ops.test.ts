import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatLine, redact, log } from '@/lib/log';
import { freshDb } from './helpers';

describe('structured logging', () => {
  afterEach(() => { vi.restoreAllMocks(); delete process.env.LOG_LEVEL; });
  it('writes one JSON object per line with timestamp, level and message', () => {
    const line = formatLine('info', 'odds sync', { fixtures: 3 }, new Date('2026-11-26T10:00:00Z'));
    expect(JSON.parse(line)).toEqual({ ts: '2026-11-26T10:00:00.000Z', level: 'info', msg: 'odds sync', service: 'wozabet', fixtures: 3 });
    expect(line).not.toContain('\n');
  });
  it('redacts secrets, OTPs, ID numbers and documents at any depth', () => {
    const out = redact({ phone: '+264811234567', password: 'p', otpCode: '123456', nested: { authorization: 'Bearer x', idNumber: '90010100123', ok: 1 }, list: [{ apiKey: 'k' }], code: '654321', status: 'fine' }) as any;
    expect(out).toEqual({ phone: '[redacted]', password: '[redacted]', otpCode: '[redacted]', nested: { authorization: '[redacted]', idNumber: '[redacted]', ok: 1 }, list: [{ apiKey: '[redacted]' }], code: '[redacted]', status: 'fine' });
  });
  it('serialises errors with message and code, and respects LOG_LEVEL', () => {
    const e = Object.assign(new Error('boom'), { code: 'X1' });
    expect(redact(e)).toMatchObject({ name: 'Error', message: 'boom', code: 'X1' });
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.env.LOG_LEVEL = 'warn';
    log.info('hidden');
    log.error('shown', { err: e });
    expect(out).not.toHaveBeenCalled();
    expect(JSON.parse(String(err.mock.calls[0][0]))).toMatchObject({ level: 'error', msg: 'shown', err: { message: 'boom' } });
  });
});

describe('health endpoint', () => {
  it('is 200 with a working database and 503 when the database is down', async () => {
    await freshDb();
    const { GET } = await import('@/app/api/health/route');
    const ok = await GET();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
    expect(ok.headers.get('cache-control')).toBe('no-store');

    (globalThis as any).__wozaDb = Promise.resolve({ q: async () => { throw new Error('connection refused'); } });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const bad = await GET();
    expect(bad.status).toBe(503);
    const body = await bad.json();
    expect(body).toMatchObject({ status: 'degraded', checks: { database: 'down' } });
    expect(JSON.stringify(body)).not.toContain('connection refused'); // no internals leaked
  });
});
