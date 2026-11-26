/**
 * Structured logging: one JSON object per line on stdout/stderr, which Docker, Vercel and most log platforms
 * parse natively. Sensitive fields are redacted by key name, so secrets, OTPs and ID numbers can't leak into logs.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|otp|code_hash|^code$|api[_-]?key|id_?number|document|signature|msisdn|phone/i;

export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack?.split('\n').slice(0, 8).join('\n'), ...('code' in v ? { code: (v as any).code } : {}) };
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE.test(k) ? '[redacted]' : redact(x, depth + 1)]));
  }
  if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + '…';
  return v;
}

export function formatLine(level: Level, msg: string, fields: Record<string, unknown> = {}, now = new Date()): string {
  return JSON.stringify({ ts: now.toISOString(), level, msg, service: 'wozabet', ...(redact(fields) as object) });
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const min = (process.env.LOG_LEVEL as Level) || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
  if (ORDER[level] < (ORDER[min] ?? 20)) return;
  const line = formatLine(level, msg, fields);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, f),
};
