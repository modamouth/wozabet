import { handle, ok } from '@/lib/http';
import { getDb } from '@/lib/db';
import { listMatches } from '@/lib/fixtures';
import { ensureData } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    await ensureData();
    const matches = await listMatches(await getDb(), {
      sport: url.searchParams.get('sport') || undefined,
      live: url.searchParams.get('live') === '1',
    });
    return ok({ matches });
  });
}
