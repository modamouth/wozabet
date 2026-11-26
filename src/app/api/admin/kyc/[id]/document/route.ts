import { handle } from '@/lib/http';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getKycStorage } from '@/lib/storage';
import { readKycDocument } from '@/lib/kyc';

export const dynamic = 'force-dynamic';

/** Streams a KYC document to an admin. Never cached; the browser may not sniff or run it. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const doc = await readKycDocument(await getDb(), getKycStorage(), id);
    return new Response(Buffer.from(doc.bytes), {
      headers: {
        'content-type': doc.mime, 'content-disposition': 'inline', 'cache-control': 'no-store, private',
        'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });
}
