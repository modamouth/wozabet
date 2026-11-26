import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { getKycStorage } from '@/lib/storage';
import { kycState, submitKyc, MAX_DOC_BYTES, type IdType } from '@/lib/kyc';
import { LIMITS, rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const u = await requireUser();
    return ok(await kycState(await getDb(), u.uid));
  });
}

/** multipart/form-data: idType, idNumber, document (file). */
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    await rateLimit(await getDb(), `kyc:${u.uid}`, ...LIMITS.kycPerUser);
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_DOC_BYTES + 64 * 1024) throw new AppError('document_too_large', 'The file must be 5 MB or smaller', 413);
    const form = await req.formData().catch(() => { throw new AppError('invalid', 'Invalid upload'); });
    const file = form.get('document');
    if (!(file instanceof Blob)) throw new AppError('no_document', 'Upload a photo or scan of your ID');
    if (file.size > MAX_DOC_BYTES) throw new AppError('document_too_large', 'The file must be 5 MB or smaller', 413);
    const r = await submitKyc(await getDb(), getKycStorage(), u.uid, {
      idType: String(form.get('idType') ?? '') as IdType,
      idNumber: String(form.get('idNumber') ?? ''),
      document: new Uint8Array(await file.arrayBuffer()),
    });
    return ok(r, 201);
  });
}
