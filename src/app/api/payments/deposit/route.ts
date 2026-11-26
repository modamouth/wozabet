import { z } from 'zod';
import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { getPaymentProvider, webhookUrl } from '@/lib/payments';
import { initiateDeposit } from '@/lib/payments/service';

const Body = z.object({ amountCents: z.number().int() });

/** Start a mobile-wallet deposit. The user approves it on their phone; the wallet is credited by the webhook. */
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const provider = getPaymentProvider();
    if (!provider) throw new AppError('payments_disabled', 'Deposits are not available yet', 503);
    const b = Body.parse(await req.json().catch(() => { throw new AppError('invalid', 'Invalid request'); }));
    const r = await initiateDeposit(await getDb(), provider, { userId: u.uid, amountCents: b.amountCents, callbackUrl: webhookUrl(provider) });
    return ok({ payment: r }, 201);
  });
}
