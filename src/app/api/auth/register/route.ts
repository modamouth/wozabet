import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { createUser } from '@/lib/users';
import { createSession } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { LIMITS, clientIp, rateLimit } from '@/lib/ratelimit';

const Body = z.object({
  phone: z.string().min(6),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Surname is required').max(80),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD'),
  accept18: z.literal(true, { message: 'You must confirm you are 18 or older' }),
  acceptTerms: z.literal(true, { message: 'You must accept the Terms & Conditions' }),
  otpCode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code we sent you'),
});

export async function POST(req: Request) {
  return handle(async () => {
    const db = await getDb();
    await rateLimit(db, `register:ip:${clientIp(req)}`, ...LIMITS.registerPerIp);
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    const u = await createUser(db, b, { otpCode: b.otpCode });
    await createSession(u.id, u.role);
    return ok({ ok: true }, 201);
  });
}
