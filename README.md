# Wozabet – sportsbook app (MVP)

Mobile-first Next.js app + betting backend. Runs out of the box with **fake data** (no API key, no database server needed).

## Run it

```bash
npm install
cp .env.example .env          # edit secrets; leave API_FOOTBALL_KEY empty for fake data
npm run seed                  # creates the admin user + sample fixtures
npm run dev                   # http://localhost:3000
npm test                      # 18 tests (odds, settlement, wallet, bets)
```

Log in as the admin (`ADMIN_PHONE` / `ADMIN_PASSWORD` from `.env`), open **Me → Admin** to enter results and settle bets.
With `DEMO_MODE=true` the Me page has play-money top-ups.

## How it works

| Part | Where |
|---|---|
| Money = integer cents, odds = integer thousandths (no floats) | `src/lib/money.ts`, `odds.ts` |
| Reference odds -> **your** prices (strip their margin, add yours, round down) | `src/lib/odds.ts` (`MARGIN` in `.env`) |
| Wallet + append-only ledger, idempotent by reference | `src/lib/wallet.ts` |
| Bet placement: stake limits, price-change check, funds, max payout, self-exclusion | `src/lib/bets.ts` |
| Settlement (1X2, two-way, accumulators, void/cancel), idempotent | `src/lib/settle.ts`, `settle-logic.ts` |
| Odds/fixtures feed: API-Football + mock | `src/lib/providers/`, `sync.ts` |
| Accounts: phone + scrypt password, 18+ enforced server-side, signed cookie session | `src/lib/users.ts`, `auth.ts` |
| UI (Home, Live, Bet slip, My bets, Me, Join/Login, Admin) | `src/app/` |

## Going live checklist

1. **Postgres**: set `DATABASE_URL` (tables are created automatically). Dev uses embedded Postgres (PGlite) in `./.data`.
2. **Secrets**: set `AUTH_SECRET` and `CRON_SECRET` (the app refuses to start in production without `AUTH_SECRET`). Set `DEMO_MODE=false`.
3. **Real odds**: set `API_FOOTBALL_KEY` (+ `API_FOOTBALL_LEAGUES`). Schedule `POST /api/cron/sync` every 5-10 min with header `Authorization: Bearer $CRON_SECRET`. The API-Football adapter was written from its public docs and is **not yet tested against the live API**; check it on the free plan first. Rugby/basketball only exist in the mock feed.
4. **Payments** (not built): call `deposit(db, userId, cents, providerReference)` from your payment provider's webhook (idempotent by reference). Withdrawals (with KYC check) are not built either.
5. **Compliance** (not built): KYC document verification, deposit/loss limits, self-exclusion UI, bonus wagering rules, audit/reporting for the Namibia Gambling Board, terms and privacy pages. Have your gambling lawyer review before taking real money.
6. **Settlement**: keep `AUTO_SETTLE=false` at first (admin confirms results by hand); enable once you trust the feed.
7. **Live betting** stays off (`LIVE_BETTING=false`): 30-60s feed delays are not safe for in-play prices.

## Known limits of this MVP
- Login throttling is in-memory (single server). Use Redis/DB if you scale out.
- No rate limiting on other endpoints, no CSRF token (cookies are SameSite=Lax), no email/SMS verification (OTP) yet.
- Only 1X2 / two-way match-winner markets, singles and accumulators.
