import { handle, ok } from '@/lib/http';
import { clearSession } from '@/lib/auth';

export async function POST() {
  return handle(async () => {
    await clearSession();
    return ok({ ok: true });
  });
}
