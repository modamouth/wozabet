import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { authenticate, normalizePhone } from '@/lib/users';
import { createSession, throttleCheck, throttleClear, throttleFail } from '@/lib/auth';
import { AppError } from '@/lib/errors';

const Body = z.object({ phone: z.string().min(6), password: z.string().min(1) });

export async function POST(req: Request) {
  return handle(async () => {
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    const id = normalizePhone(b.phone);
    throttleCheck(id);
    try {
      const u = await authenticate(await getDb(), b.phone, b.password);
      throttleClear(id);
      await createSession(u.id, u.role);
      return ok({ ok: true });
    } catch (e) {
      if (e instanceof AppError && e.code === 'bad_credentials') throttleFail(id);
      throw e;
    }
  });
}
