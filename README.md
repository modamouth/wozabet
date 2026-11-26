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
| KYC: ID number + document upload to private S3-compatible storage, admin review | `src/lib/kyc.ts`, `storage.ts` |
| Responsible gambling: deposit/loss limits, session reminder, cool-off, self-exclusion (enforced server-side) | `src/lib/rg.ts` |
| Security: SMS OTP (sign-up, withdrawals), DB rate limits, CSRF, append-only audit log | `src/lib/otp.ts`, `ratelimit.ts`, `csrf.ts`, `proxy.ts`, `audit.ts` |
| Accounts: phone + scrypt password, 18+ enforced server-side, signed cookie session | `src/lib/users.ts`, `auth.ts` |
| UI (Home, Live, Bet slip, My bets, Me, Join/Login, Admin) | `src/app/` |

## Going live checklist

1. **Postgres**: set `DATABASE_URL` (tables are created automatically). Dev uses embedded Postgres (PGlite) in `./.data`.
2. **Secrets**: set `AUTH_SECRET` and `CRON_SECRET` (the app refuses to start in production without `AUTH_SECRET`). Set `DEMO_MODE=false`.
3. **Real odds**: set `API_FOOTBALL_KEY` (+ `API_FOOTBALL_LEAGUES`). Schedule `POST /api/cron/sync` every 5-10 min with header `Authorization: Bearer $CRON_SECRET`. The API-Football adapter was written from its public docs and is **not yet tested against the live API**; check it on the free plan first. Rugby/basketball only exist in the mock feed.
4. **Payments**: see [Payments](#payments) below. The mobile-wallet adapter's API details are assumptions until checked against your provider's merchant docs.
5. **Compliance**: KYC and responsible-gambling tools are built (see below). Still to do: bonus wagering rules, audit/reporting for the Namibia Gambling Board, terms and privacy pages. Have your gambling lawyer review before taking real money.
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
- Only 1X2 / two-way match-winner markets, singles and accumulators.
