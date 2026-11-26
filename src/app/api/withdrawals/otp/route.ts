import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { issueOtp } from '@/lib/otp';
import { getSmsSender } from '@/lib/sms';
import { LIMITS, rateLimit } from '@/lib/ratelimit';

/** Text a withdrawal confirmation code to the user's registered number. */
export async function POST() {
  return handle(async () => {
    const u = await requireUser();
    const db = await getDb();
    const row = (await db.q<{ phone: string; kyc_status: string }>('SELECT phone, kyc_status FROM users WHERE id=$1', [u.uid]))[0];
    if (row.kyc_status !== 'verified') throw new AppError('kyc_required', 'Verify your identity before withdrawing', 403);
    await rateLimit(db, `otp:gap:withdrawal:${row.phone}`, ...LIMITS.otpResendGap, 'Please wait a minute before asking for another code.');
    await rateLimit(db, `otp:phone:${row.phone}`, ...LIMITS.otpSendPerPhone);
    const { expiresAt } = await issueOtp(db, getSmsSender(), row.phone, 'withdrawal');
    return ok({ sent: true, expiresAt });
  });
}
