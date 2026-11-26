# Wozabet – sportsbook app (MVP)

Mobile-first Next.js app + betting backend. Runs out of the box with **fake data** (no API key, no database server needed).

## Run it

```bash
npm install
cp .env.example .env          # edit secrets; leave API_FOOTBALL_KEY empty for fake data
npm run seed                  # creates the admin user + sample fixtures
npm run dev                   # http://localhost:3000
npm test                      # odds, settlement, wallet, bets, payments, withdrawals
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
| Mobile-wallet deposits (initiate + HMAC-signed webhook), withdrawals with admin review | `src/lib/payments/`, `withdrawals.ts` |
| Accounts: phone + scrypt password, 18+ enforced server-side, signed cookie session | `src/lib/users.ts`, `auth.ts` |
| UI (Home, Live, Bet slip, My bets, Me, Join/Login, Admin) | `src/app/` |

## Going live checklist

1. **Postgres**: set `DATABASE_URL` (tables are created automatically). Dev uses embedded Postgres (PGlite) in `./.data`.
2. **Secrets**: set `AUTH_SECRET` and `CRON_SECRET` (the app refuses to start in production without `AUTH_SECRET`). Set `DEMO_MODE=false`.
3. **Real odds**: set `API_FOOTBALL_KEY` (+ `API_FOOTBALL_LEAGUES`). Schedule `POST /api/cron/sync` every 5-10 min with header `Authorization: Bearer $CRON_SECRET`. The API-Football adapter was written from its public docs and is **not yet tested against the live API**; check it on the free plan first. Rugby/basketball only exist in the mock feed.
4. **Payments**: see [Payments](#payments) below. The mobile-wallet adapter's API details are assumptions until checked against your provider's merchant docs.
5. **Compliance** (not built): KYC document verification, deposit/loss limits, self-exclusion UI, bonus wagering rules, audit/reporting for the Namibia Gambling Board, terms and privacy pages. Have your gambling lawyer review before taking real money.
6. **Settlement**: keep `AUTO_SETTLE=false` at first (admin confirms results by hand); enable once you trust the feed.
7. **Live betting** stays off (`LIVE_BETTING=false`): 30-60s feed delays are not safe for in-play prices.

## Payments

**Deposits (mobile wallet).** `POST /api/payments/deposit {amountCents}` records a `pending` row in `payments` and asks the provider to push a payment request to the user's **registered** number (the client can't choose another one). Nothing is credited at this point. The provider then calls `POST /api/payments/webhook/<provider>`:

- The signature is checked against the raw body first: HMAC-SHA256 of `"<x-timestamp>.<body>"` in `x-signature`, rejected if more than 5 minutes old.
- On success the wallet is credited through `deposit()`, ledger type `deposit` with ref `<provider>:<transactionId>`, in the same transaction that marks the payment `completed`. Replays do nothing.
- A wrong amount, currency or transaction id, or a success arriving after a failure, sets the payment to `review` and credits **nothing**. Check these rows against the provider's statement by hand.

`src/lib/payments/mobileWallet.ts` is written against an **assumed** API: endpoint, field names and signature headers are marked `PROVIDER-SPECIFIC`. Confirm each one with your provider (MTC, Bank Windhoek EasyWallet, etc.) before you go live.

**Local testing:** set `PAYMENTS_PROVIDER=sandbox` and `PAYMENT_WEBHOOK_SECRET=<anything long>`, start a deposit in the app, then confirm it with `npm run sandbox:webhook -- <paymentId> <amountCents>`. The payment id comes from the response or from the `payments` table.

**Withdrawals.** `POST /api/withdrawals {amountCents}` needs `kyc_status='verified'`. The amount leaves the balance straight away (ledger `withdrawal`, ref = withdrawal id) and the request is created as `pending`. An admin opens **Me → Admin: withdrawals**:
- **Approve** after the payout has been sent from the wallet merchant portal. No automatic payout API is wired yet.
- **Reject** (a reason is required) refunds the wallet (ledger `withdrawal_reversal`).

Each request can only be decided once, and admins can't review their own.

## Known limits of this MVP
- Login throttling is in-memory (single server). Use Redis/DB if you scale out.
- No rate limiting on other endpoints, no CSRF token (cookies are SameSite=Lax), no email/SMS verification (OTP) yet.
- Only 1X2 / two-way match-winner markets, singles and accumulators.
