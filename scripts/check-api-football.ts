/**
 * Read-only check of the API-Football account and response shapes (≈6 requests).
 *   npm run check:api-football [YYYY-MM-DD]
 * Never prints the key.
 */
const BASE = 'https://v3.football.api-sports.io';
const key = process.env.API_FOOTBALL_KEY ?? '';
if (!key) { console.error('API_FOOTBALL_KEY is not set in .env'); process.exit(1); }

const shape = (v: any, depth = 0): any => {
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1)] : [];
  if (v && typeof v === 'object') return depth > 4 ? '{…}' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  return v === null ? null : typeof v;
};
async function get(path: string) {
  const res = await fetch(BASE + path, { headers: { 'x-apisports-key': key } });
  const body: any = await res.json().catch(() => ({}));
  console.log(`\n## GET ${path} -> HTTP ${res.status} | remaining today: ${res.headers.get('x-ratelimit-requests-remaining')} | errors: ${JSON.stringify(body.errors)} | results: ${body.results} | paging: ${JSON.stringify(body.paging)}`);
  return body;
}

async function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const status = await get('/status');
  console.log('account:', JSON.stringify({ plan: status.response?.subscription?.plan, active: status.response?.subscription?.active, requests: status.response?.requests }));

  const nam = await get('/leagues?country=Namibia');
  for (const l of nam.response ?? []) console.log('  Namibia league:', l.league?.id, l.league?.name, l.league?.type, 'seasons:', (l.seasons ?? []).map((s: any) => `${s.year}${s.current ? '*' : ''}(odds:${s.coverage?.odds})`).join(' '));

  const fx = await get(`/fixtures?date=${date}`);
  if (fx.response?.[0]) console.log('fixture shape:', JSON.stringify(shape(fx.response[0])));
  const statuses: Record<string, number> = {};
  for (const r of fx.response ?? []) statuses[r.fixture?.status?.short] = (statuses[r.fixture?.status?.short] ?? 0) + 1;
  console.log('status codes seen:', JSON.stringify(statuses));

  const bets = await get('/odds/bets');
  for (const b of bets.response ?? []) if (/^(Match Winner|Goals Over\/Under|Both Teams Score|Double Chance)$/.test(b.name)) console.log('  bet:', b.id, b.name);

  const odds = await get(`/odds?date=${date}&bookmaker=${process.env.API_FOOTBALL_BOOKMAKER || 8}&page=1`);
  const o = odds.response?.[0];
  if (o) {
    console.log('odds shape:', JSON.stringify(shape({ ...o, bookmakers: o.bookmakers?.slice(0, 1).map((b: any) => ({ ...b, bets: b.bets?.slice(0, 1) })) })));
    const bm = o.bookmakers?.[0];
    console.log('odds update:', o.update, '| bookmaker:', bm?.id, bm?.name);
    for (const b of bm?.bets ?? []) if ([1, 5, 8, 12].includes(b.id)) console.log(`  bet ${b.id} ${b.name}:`, JSON.stringify(b.values));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
