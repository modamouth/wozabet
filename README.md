# Wozabet – sportsbook app (MVP)

Mobile-first Next.js app + betting backend. Runs out of the box with **fake data** (no API key, no database server needed).

## Run it

```bash
npm install
cp .env.example .env          # edit secrets; leave API_FOOTBALL_KEY empty for fake data
                              # with a key set there is no sample data: run Me → Admin → "Sync odds & fixtures now" (or POST /api/cron/sync)
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
| Markets: match result, double chance, over/under 2.5, both teams to score (football, 90 minutes) | `src/lib/markets.ts` |
| Settlement (all markets, accumulators, void/cancel), idempotent | `src/lib/settle.ts`, `settle-logic.ts` |
| Odds/fixtures feed: API-Football + mock | `src/lib/providers/`, `sync.ts` |
| Mobile-wallet deposits (initiate + HMAC-signed webhook), withdrawals with admin review | `src/lib/payments/`, `withdrawals.ts` |
| KYC: ID number + document upload to private S3-compatible storage, admin review | `src/lib/kyc.ts`, `storage.ts` |
| Responsible gambling: deposit/loss limits, session reminder, cool-off, self-exclusion (enforced server-side) | `src/lib/rg.ts` |
| Security: SMS OTP (sign-up, withdrawals), DB rate limits, CSRF, append-only audit log | `src/lib/otp.ts`, `ratelimit.ts`, `csrf.ts`, `proxy.ts`, `audit.ts` |
| Accounts: phone + scrypt password, 18+ enforced server-side, signed cookie session | `src/lib/users.ts`, `auth.ts` |
| UI (Home, Live, Bet slip, My bets, Me, Join/Login, Admin) | `src/app/` |

## Going live checklist

1. **Postgres**: set `DATABASE_URL` (tables are created automatically). Dev uses embedded Postgres (PGlite) in `./.data`.
2. **Secrets**: set `AUTH_SECRET` and `CRON_SECRET` (the app refuses to start in production without `AUTH_SECRET`). Set `DEMO_MODE=false`.
3. **Real odds**: set `API_FOOTBALL_KEY` and `API_FOOTBALL_LEAGUES`, then schedule `POST /api/cron/sync` with the header `Authorization: Bearer $CRON_SECRET`. See [Odds feed](#odds-feed) for the plan you need and how often to sync. Football only: rugby and basketball were removed until a real data source is contracted.
4. **Payments**: see [Payments](#payments) below. The mobile-wallet adapter's API details are assumptions until checked against your provider's merchant docs.
5. **Compliance**: KYC and responsible-gambling tools are built (see below). Still to do: bonus wagering rules, audit/reporting for the Namibia Gambling Board, terms and privacy pages. Have your gambling lawyer review before taking real money.
6. **Settlement**: keep `AUTO_SETTLE=false` at first (admin confirms results by hand); enable once you trust the feed.
7. **Live betting** stays off (`LIVE_BETTING=false`): 30-60s feed delays are not safe for in-play prices.

## Odds feed

The adapter (`src/lib/providers/apiFootball.ts`) was **checked against the live API on 2026-11-26** (free plan). Recorded responses in `tests/fixtures/api-football/` drive the unit tests. `npm run check:api-football` shows your plan, quota and the real response shapes, and `npm run check:api-football:sync` runs a real sync into a throwaway database. `API_FOOTBALL_LIVE_TEST=1 npx vitest run tests/api-football.live.test.ts` is an opt-in live test.

What the live check showed:
- **Free plan: 100 requests a day and 10 a minute.** It refuses `league` + `season` filters for the current season (it returns HTTP 200 with `errors.plan`), so the adapter always queries by date and filters leagues itself.
- **Every sync spends a request budget** (`API_FOOTBALL_MAX_REQUESTS_PER_SYNC`). That's one `/fixtures?date` call per date, then odds for the soonest matches in your leagues:
  - With a small budget it makes one request per match.
  - It only pages through `/odds?date` (about 11 pages on a busy day) when the budget covers all the pages.
  - It stops early on the per-minute limit, on a 429, or when the daily quota drops to `API_FOOTBALL_MIN_DAILY_REMAINING`.
- **The free plan is for testing only.** It allows roughly 10 syncs a day, which means most prices end up suspended as stale. Production needs a paid plan, with the budget raised and the cron set to every 5–10 minutes.
- **Namibia Premier League** is in API-Football (league 409), but its latest season is 2018 with no odds. Namibian football needs another data source.
- API league names are ambiguous ("Premier League" is England, Namibia, Uganda, Libya…), so `src/lib/leagues.ts` maps ids to display names. Leagues not in the map are shown as "Country Competition".

**Stale-odds protection.** Prices go suspended when we haven't refreshed them for `ODDS_MAX_AGE_MINUTES` (the feed is down or sync isn't running), or when the provider hasn't changed them for `ODDS_MAX_SOURCE_AGE_MINUTES` (the feed is frozen upstream). The check runs in SQL both when matches are listed **and** when a bet is placed, so a stale price is never bettable even if no job has run. Each sync also writes the suspension to the database (recorded in the audit log as `odds.suspended_stale`), and fresh prices lift it.

**Exposure limit.** `MAX_MARKET_LIABILITY_CENTS` caps the worst-case loss on one market across all players: the payout if a selection wins, minus single-bet stakes held on that market. Accumulator legs count their full potential return. A bet over the limit gets `market_limit`. Bets lock the fixture rows involved, so parallel bets can't slip past the limit together.

## Markets

| Market | Selections | Wins when (90-minute score) |
|---|---|---|
| Match result `1x2` | 1 / X / 2 | home win / draw / away win |
| Double chance `dc` | 1X / 12 / X2 | either of the two outcomes |
| Over/under 2.5 `ou25` | O / U | 3+ goals / 0–2 goals |
| Both teams to score `btts` | Y / N | each side scores at least once / not |

- Everything settles on **regular time**. For AET/PEN matches the adapter takes `score.fulltime` rather than `goals`, which includes extra time. A cancelled or abandoned match voids every leg.
- The margin is applied per market. Double chance is normalised to a 200% book because each outcome is covered by two selections.
- Prices come from API-Football bets 1, 12, 5 and 8 (ids checked live). A market is only offered when the provider sends every one of its selections.
- The exposure limit is per market: fixture + market + selection.
- Unknown market/selection pairs are refused at placement, and voided rather than guessed at settlement.

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

## KYC (identity verification)

Players open **Me → Verify identity** and enter a Namibian ID number or passport number, plus a photo or scan (JPG/PNG/PDF, max 5 MB).
- The file type is detected from the file's bytes, not from what the browser claims.
- A Namibian ID must be 11 digits, and its first six (YYMMDD) must match the date of birth given at sign-up.
- An ID number can only be linked to one account. A rejection frees it again, in case someone used a stolen ID.
- Files go to `KYC_STORAGE`: S3-compatible with server-side encryption, or a local folder that must be **outside** the project, written with 0600 permissions. They're never publicly reachable. Admins view them through `/api/admin/kyc/<id>/document`, which is admin-only and served with `no-store` and a locked-down CSP.
- Status flow: `unverified → submitted → verified | rejected` (after a rejection the player can resubmit). Admins review under **Me → Admin: identity checks** and can't review their own documents. Withdrawals stay blocked until the status is `verified`.

## Responsible gambling

Players manage these under **Me → Deposit & loss limits** and **Me → Take a break**. All checks run on the server: `assertDepositAllowed` in deposit initiation, `assertStakeAllowed` in `placeBet`. Both run inside the transaction with the user row locked, so two parallel requests can't both slip under a limit.

| Tool | Rule |
|---|---|
| Deposit limits (daily / weekly / monthly) | Rolling 24 h / 7 d / 30 d. Completed deposits **and pending payment requests** count towards the limit. |
| Loss limit (daily / weekly / monthly) | Net loss = stakes − winnings − refunds in the window. Open bets count as lost. A stake is refused if losing it could break the limit. |
| Changing limits | Lowering or adding a limit applies now. Raising or removing one applies after **24 h**. Every change is kept in `rg_limits`. |
| Session reminder | Off / 15 / 30 / 60 / 120 min. Shows a "time check" dialog with Continue / Take a break / Log out. |
| Cool-off | 24 h / 7 d / 30 d. Blocks bets and deposits. Can only be extended. |
| Self-exclusion | 1 month / 6 months / permanent. Blocks bets and deposits. Can only be extended, never lifted early. |

Players on a cool-off or self-exclusion can still log in and **withdraw** their balance. The help page is `/responsible-gambling`, and its helpline details are placeholders for your compliance team.

## Security

- **SMS OTP.** Sign-up is: details → `POST /api/auth/otp` → code → `POST /api/auth/register {…, otpCode}`. Withdrawals are: `POST /api/withdrawals/otp` → `POST /api/withdrawals {amountCents, otpCode}`.
  - Codes are 6 digits, valid for 5 minutes, and stored only as an HMAC. A code works once, for its own phone number and purpose.
  - Five wrong guesses burn the code. You can request a code once a minute, up to 5 per hour.
  - In dev, codes are printed in the server log (`SMS_PROVIDER=console`). In production `SMS_PROVIDER=twilio` is required.
- **Rate limits** are stored in Postgres (`rate_limits` table), so they hold across servers and restarts. They cover login (per IP, plus failures per phone), register, OTP sends, bets, deposits, withdrawals, KYC uploads, limit changes, admin actions and webhooks. All values are in `LIMITS` in `src/lib/ratelimit.ts`. Set `TRUST_PROXY=true` only behind your own load balancer.
- **CSRF.** `src/proxy.ts` checks every API write: the Origin (or Referer) must be our own site or `ALLOWED_ORIGINS`, and the `wb_csrf` cookie must match the `x-csrf-token` header. Webhooks and cron are exempt because they use signatures or a bearer secret, not cookies. The proxy also sets security headers (nosniff, frame-deny, referrer policy, and HSTS in production).
- **Audit log.** The `audit_log` table is append-only: a database trigger blocks UPDATE and DELETE. It's written in the same transaction as the action it records. It covers deposits (initiated, completed, failed, review), withdrawals (requested, approved, rejected), KYC (submitted, approved, rejected, document viewed), results and settlement, bets placed, responsible-gambling changes, logins and failed logins, OTP sends, and manual syncs. Admins can view it under **Me → Admin: audit log**.

## Known limits of this MVP
- Sessions are 30-day signed cookies with no server-side revocation list yet. Changing the password doesn't sign out other devices.
- Singles and accumulators only (no system bets or bet builder). One pick per match in an accumulator, because outcomes on the same match are correlated.
