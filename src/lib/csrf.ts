/**
 * CSRF protection for cookie-authenticated API calls (two layers, on top of SameSite=Lax cookies):
 *  1. Origin check: state-changing requests must come from our own origin (or ALLOWED_ORIGINS).
 *  2. Double-submit token: the `wb_csrf` cookie must be echoed in the `x-csrf-token` header.
 *     A cross-site page can neither read our cookie nor set custom headers on a cross-origin request.
 * Server-to-server endpoints (provider webhooks, cron with a bearer secret) are exempt: they don't use cookies.
 */
export const CSRF_COOKIE = 'wb_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT = [/^\/api\/payments\/webhook\//, /^\/api\/cron\//, /^\/api\/health$/];

export function csrfCheck(input: { method: string; url: string; origin: string | null; referer: string | null; cookieToken: string | undefined; headerToken: string | null; allowedOrigins?: string[] }): { ok: true } | { ok: false; reason: string } {
  const url = new URL(input.url);
  if (SAFE.has(input.method.toUpperCase())) return { ok: true };
  if (!url.pathname.startsWith('/api/')) return { ok: true };
  if (EXEMPT.some((re) => re.test(url.pathname))) return { ok: true };

  const allowed = new Set([url.origin, ...(input.allowedOrigins ?? [])]);
  const from = input.origin ?? (input.referer ? safeOrigin(input.referer) : null);
  if (!from || !allowed.has(from)) return { ok: false, reason: 'bad_origin' };
  if (!input.cookieToken || !input.headerToken || input.cookieToken.length < 16 || !equal(input.cookieToken, input.headerToken)) {
    return { ok: false, reason: 'bad_token' };
  }
  return { ok: true };
}

function safeOrigin(u: string) { try { return new URL(u).origin; } catch { return null; } }
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Read the CSRF cookie in the browser (it is deliberately not httpOnly). */
export function readCsrfCookie(cookie: string): string {
  return cookie.split(/;\s*/).find((c) => c.startsWith(CSRF_COOKIE + '='))?.slice(CSRF_COOKIE.length + 1) ?? '';
}
