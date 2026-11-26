import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { normalizePhone } from '@/lib/users';
import { issueOtp } from '@/lib/otp';
import { getSmsSender } from '@/lib/sms';
import { LIMITS, clientIp, rateLimit } from '@/lib/ratelimit';
import { audit } from '@/lib/audit';

const Body = z.object({ phone: z.string().min(6) });

/** Send a sign-up verification code. */
export async function POST(req: Request) {
  return handle(async () => {
    const db = await getDb();
    const ip = clientIp(req);
    await rateLimit(db, `otp:ip:${ip}`, ...LIMITS.otpSendPerIp);
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    const phone = normalizePhone(b.phone);
    const taken = await db.q('SELECT 1 FROM users WHERE phone=$1', [phone]);
    if (taken.length) throw new AppError('phone_taken', 'That number is already registered. Log in instead.', 409);
    await rateLimit(db, `otp:gap:signup:${phone}`, ...LIMITS.otpResendGap, 'Please wait a minute before asking for another code.');
    await rateLimit(db, `otp:phone:${phone}`, ...LIMITS.otpSendPerPhone);
    const { expiresAt } = await issueOtp(db, getSmsSender(), phone, 'signup');
    await audit(db.q, { actorId: null, action: 'otp.sent', targetType: 'phone', targetId: phone, details: { purpose: 'signup' }, ip });
    return ok({ sent: true, expiresAt });
  });
}
