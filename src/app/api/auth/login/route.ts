import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { authenticate, normalizePhone } from '@/lib/users';
import { createSession } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { LIMITS, clearKey, clientIp, hit, peek, rateLimit } from '@/lib/ratelimit';
import { audit } from '@/lib/audit';

const Body = z.object({ phone: z.string().min(6), password: z.string().min(1) });

export async function POST(req: Request) {
  return handle(async () => {
    const db = await getDb();
    const ip = clientIp(req);
    await rateLimit(db, `login:ip:${ip}`, ...LIMITS.loginPerIp);
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    const phone = normalizePhone(b.phone);
    const failKey = `login-fail:${phone}`;
    const [max, win] = LIMITS.loginFailPerPhone;
    if ((await peek(db, failKey, win)) >= max) throw new AppError('too_many_attempts', 'Too many attempts. Try again in 10 minutes.', 429);
    try {
      const u = await authenticate(db, b.phone, b.password);
      await clearKey(db, failKey);
      await createSession(u.id, u.role);
      await audit(db.q, { actorId: u.id, action: 'auth.login', targetType: 'user', targetId: u.id, ip });
      return ok({ ok: true });
    } catch (e) {
      if (e instanceof AppError && e.code === 'bad_credentials') {
        await hit(db, failKey, max, win);
        await audit(db.q, { actorId: null, action: 'auth.login_failed', targetType: 'phone', targetId: phone, ip });
      }
      throw e;
    }
  });
}
