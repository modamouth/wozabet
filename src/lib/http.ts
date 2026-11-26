import { NextResponse } from 'next/server';
import { AppError } from './errors';
import { ZodError } from 'zod';
import { log } from './log';

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) {
      if (e.status >= 500) log.error('request failed', { code: e.code, status: e.status, err: e });
      else if (e.status === 429 || e.code === 'csrf') log.warn('request refused', { code: e.code, status: e.status });
    }
    if (e instanceof AppError) return NextResponse.json({ error: { code: e.code, message: e.message, data: e.data } }, { status: e.status });
    if (e instanceof ZodError) {
      return NextResponse.json({ error: { code: 'invalid', message: e.issues[0]?.message ?? 'Invalid input' } }, { status: 400 });
    }
    log.error('unhandled error', { err: e });
    return NextResponse.json({ error: { code: 'server_error', message: 'Something went wrong' } }, { status: 500 });
  }
}
