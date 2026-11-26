import { NextResponse, type NextRequest } from 'next/server';
import { CSRF_COOKIE, CSRF_HEADER, csrfCheck } from './lib/csrf';
import { log } from './lib/log';

/** Runs before every request: CSRF checks for API writes, CSRF cookie issuing, and security headers. */
export function proxy(req: NextRequest) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const r = csrfCheck({
    method: req.method, url: req.url, origin: req.headers.get('origin'), referer: req.headers.get('referer'),
    cookieToken: req.cookies.get(CSRF_COOKIE)?.value, headerToken: req.headers.get(CSRF_HEADER), allowedOrigins,
  });
  if (!r.ok) {
    log.warn('csrf refused', { reason: r.reason, method: req.method, path: req.nextUrl.pathname });
    return NextResponse.json({ error: { code: 'csrf', message: 'Your session needs a refresh. Reload the page and try again.' } }, { status: 403 });
  }
  const res = NextResponse.next();
  if (!req.cookies.get(CSRF_COOKIE)) {
    res.cookies.set(CSRF_COOKIE, crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''), {
      httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
    });
  }
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  res.headers.set('x-frame-options', 'DENY');
  res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains');
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|hero.jpg).*)'] };
