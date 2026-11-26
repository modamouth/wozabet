import type { Db, Q } from './db';
import { AppError } from './errors';
import { formatNad } from './money';

/**
 * Responsible gambling. Everything here is enforced on the server for deposits and bets.
 *
 * Limits use ROLLING windows (last 24 hours / 7 days / 30 days). Lowering or adding a limit applies immediately;
 * raising or removing one only applies after LIMIT_INCREASE_DELAY_HOURS, so it can't be undone in the heat of the moment.
 * Limit changes are stored as an append-only history (rg_limits), which doubles as an audit trail.
 */
export type LimitKind = 'deposit' | 'loss';
export type Period = 'day' | 'week' | 'month';
export const PERIODS: Period[] = ['day', 'week', 'month'];
const WINDOW: Record<Period, string> = { day: '1 day', week: '7 days', month: '30 days' };
const PERIOD_LABEL: Record<Period, string> = { day: 'daily', week: 'weekly', month: 'monthly' };
export const LIMIT_INCREASE_DELAY_HOURS = 24;
export const COOL_OFF_OPTIONS = { '24h': 1, '7d': 7, '30d': 30 } as const; // days
export const SELF_EXCLUSION_OPTIONS = ['1m', '6m', 'permanent'] as const;
export const SESSION_REMINDER_OPTIONS = [15, 30, 60, 120] as const;
export type CoolOff = keyof typeof COOL_OFF_OPTIONS;
export type SelfExclusion = (typeof SELF_EXCLUSION_OPTIONS)[number];

type Runner = Q;
const fmt = (d: Date, time = false) => new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Windhoek', dateStyle: 'medium', ...(time ? { timeStyle: 'short' } : {}) });

export interface LimitState { amountCents: number | null; pending: { amountCents: number | null; effectiveFrom: string } | null }

async function limitRows(q: Runner, userId: string, kind: LimitKind, period: Period) {
  return q<{ amount_cents: number | null; effective_from: Date }>(
    'SELECT amount_cents, effective_from FROM rg_limits WHERE user_id=$1 AND kind=$2 AND period=$3 ORDER BY id DESC LIMIT 20', [userId, kind, period]);
}

/** The limit in force at `now` = the most recently created row that is already effective. */
export async function currentLimit(q: Runner, userId: string, kind: LimitKind, period: Period, now = new Date()): Promise<LimitState> {
  const rows = await limitRows(q, userId, kind, period);
  const active = rows.find((r) => new Date(r.effective_from) <= now);
  const newest = rows[0];
  const pending = newest && new Date(newest.effective_from) > now ? { amountCents: newest.amount_cents, effectiveFrom: new Date(newest.effective_from).toISOString() } : null;
  return { amountCents: active?.amount_cents ?? null, pending };
}

/** Set (amountCents) or remove (null) a limit. Returns when it takes effect. */
export async function setLimit(db: Db, userId: string, kind: LimitKind, period: Period, amountCents: number | null, now = new Date()) {
  if (kind !== 'deposit' && kind !== 'loss') throw new AppError('bad_limit', 'Unknown limit type');
  if (!PERIODS.includes(period)) throw new AppError('bad_period', 'Unknown period');
  if (amountCents !== null && (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 100_000_000)) {
    throw new AppError('bad_amount', 'Enter a limit between N$ 1 and N$ 1,000,000');
  }
  return db.tx(async (q) => {
    await q('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const cur = await currentLimit(q, userId, kind, period, now);
    const loosening = cur.amountCents !== null && (amountCents === null || amountCents > cur.amountCents);
    const effectiveFrom = loosening ? new Date(now.getTime() + LIMIT_INCREASE_DELAY_HOURS * 3_600_000) : now;
    await q('INSERT INTO rg_limits (user_id, kind, period, amount_cents, effective_from, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, kind, period, amountCents, effectiveFrom, now]);
    return { amountCents, effectiveFrom: effectiveFrom.toISOString(), delayed: loosening };
  });
}

/** Account blocks: self-exclusion and cool-off. Players can still log in and withdraw, but can't deposit or bet. */
export async function assertCanGamble(q: Runner, userId: string, now = new Date()) {
  const u = (await q<{ self_excluded_until: Date | null; self_excluded_permanent: boolean; cool_off_until: Date | null }>(
    'SELECT self_excluded_until, self_excluded_permanent, cool_off_until FROM users WHERE id=$1', [userId]))[0];
  if (!u) throw new AppError('no_user', 'User not found', 404);
  if (u.self_excluded_permanent) throw new AppError('self_excluded', 'Your account is permanently self-excluded', 403);
  if (u.self_excluded_until && new Date(u.self_excluded_until) > now) {
    throw new AppError('self_excluded', `Your account is self-excluded until ${fmt(u.self_excluded_until)}`, 403);
  }
  if (u.cool_off_until && new Date(u.cool_off_until) > now) {
    throw new AppError('cooling_off', `You are on a break until ${fmt(u.cool_off_until, true)}`, 403);
  }
}

/** Deposited in the window = completed deposits + deposits still waiting for the provider (so pending requests can't be used to get around the limit). */
export async function depositedInWindow(q: Runner, userId: string, period: Period, now = new Date()) {
  const r = await q<{ s: number }>(
    `SELECT (COALESCE((SELECT SUM(amount_cents) FROM ledger WHERE user_id=$1 AND type='deposit' AND created_at > $2::timestamptz - $3::interval), 0)
           + COALESCE((SELECT SUM(amount_cents) FROM payments WHERE user_id=$1 AND status='pending' AND created_at > $2::timestamptz - $3::interval), 0))::int AS s`,
    [userId, now, WINDOW[period]]);
  return r[0].s;
}

/** Net loss in the window = stakes minus winnings and refunds (open bets count as lost until settled). */
export async function netLossInWindow(q: Runner, userId: string, period: Period, now = new Date()) {
  const r = await q<{ s: number }>(
    `SELECT (-COALESCE(SUM(amount_cents),0))::int AS s FROM ledger
      WHERE user_id=$1 AND type IN ('bet_stake','bet_win','bet_refund') AND created_at > $2::timestamptz - $3::interval`,
    [userId, now, WINDOW[period]]);
  return r[0].s;
}

export async function assertDepositAllowed(q: Runner, userId: string, amountCents: number, now = new Date()) {
  await assertCanGamble(q, userId, now);
  for (const p of PERIODS) {
    const { amountCents: limit } = await currentLimit(q, userId, 'deposit', p, now);
    if (limit === null) continue;
    const used = await depositedInWindow(q, userId, p, now);
    if (used + amountCents > limit) {
      throw new AppError('deposit_limit', `This would exceed your ${PERIOD_LABEL[p]} deposit limit of ${formatNad(limit)}. You can deposit up to ${formatNad(Math.max(0, limit - used))} right now.`, 403);
    }
  }
}

export async function assertStakeAllowed(q: Runner, userId: string, stakeCents: number, now = new Date()) {
  await assertCanGamble(q, userId, now);
  for (const p of PERIODS) {
    const { amountCents: limit } = await currentLimit(q, userId, 'loss', p, now);
    if (limit === null) continue;
    const lost = await netLossInWindow(q, userId, p, now);
    if (lost + stakeCents > limit) {
      throw new AppError('loss_limit', `This stake could take you past your ${PERIOD_LABEL[p]} loss limit of ${formatNad(limit)}. Most you can stake right now: ${formatNad(Math.max(0, limit - lost))}.`, 403);
    }
  }
}

/** A short break. Cannot be shortened or cancelled once started. */
export async function startCoolOff(db: Db, userId: string, option: CoolOff, now = new Date()) {
  const days = COOL_OFF_OPTIONS[option];
  if (!days) throw new AppError('bad_option', 'Choose a break length');
  const until = new Date(now.getTime() + days * 86_400_000);
  const r = await db.q<{ cool_off_until: Date }>(
    'UPDATE users SET cool_off_until = GREATEST(COALESCE(cool_off_until, $2), $2) WHERE id=$1 RETURNING cool_off_until', [userId, until]);
  if (!r[0]) throw new AppError('no_user', 'User not found', 404);
  return { until: new Date(r[0].cool_off_until).toISOString() };
}

/** Self-exclusion. Can only be extended, never shortened or lifted early. */
export async function selfExclude(db: Db, userId: string, option: SelfExclusion, now = new Date()) {
  if (!SELF_EXCLUSION_OPTIONS.includes(option)) throw new AppError('bad_option', 'Choose an exclusion period');
  if (option === 'permanent') {
    const r = await db.q('UPDATE users SET self_excluded_permanent=true WHERE id=$1 RETURNING id', [userId]);
    if (!r[0]) throw new AppError('no_user', 'User not found', 404);
    return { until: null, permanent: true };
  }
  const until = new Date(now);
  until.setUTCMonth(until.getUTCMonth() + (option === '1m' ? 1 : 6));
  const r = await db.q<{ self_excluded_until: Date }>(
    'UPDATE users SET self_excluded_until = GREATEST(COALESCE(self_excluded_until, $2), $2) WHERE id=$1 RETURNING self_excluded_until', [userId, until]);
  if (!r[0]) throw new AppError('no_user', 'User not found', 404);
  return { until: new Date(r[0].self_excluded_until).toISOString(), permanent: false };
}

export async function setSessionReminder(db: Db, userId: string, minutes: number | null) {
  if (minutes !== null && !(SESSION_REMINDER_OPTIONS as readonly number[]).includes(minutes)) throw new AppError('bad_option', 'Choose a reminder interval');
  await db.q('UPDATE users SET session_reminder_minutes=$2 WHERE id=$1', [userId, minutes]);
  return { minutes };
}

/** Everything the "Me → Responsible gambling" screen shows. */
export async function rgOverview(db: Db, userId: string, now = new Date()) {
  const u = (await db.q<any>('SELECT self_excluded_until, self_excluded_permanent, cool_off_until, session_reminder_minutes FROM users WHERE id=$1', [userId]))[0];
  if (!u) throw new AppError('no_user', 'User not found', 404);
  const limits: Record<LimitKind, Record<Period, LimitState & { usedCents: number }>> = { deposit: {} as any, loss: {} as any };
  for (const kind of ['deposit', 'loss'] as const) {
    for (const p of PERIODS) {
      const st = await currentLimit(db.q, userId, kind, p, now);
      const usedCents = kind === 'deposit' ? await depositedInWindow(db.q, userId, p, now) : await netLossInWindow(db.q, userId, p, now);
      limits[kind][p] = { ...st, usedCents };
    }
  }
  const active = (d: Date | null) => (d && new Date(d) > now ? new Date(d).toISOString() : null);
  return {
    limits,
    sessionReminderMinutes: u.session_reminder_minutes as number | null,
    coolOffUntil: active(u.cool_off_until),
    selfExcludedUntil: active(u.self_excluded_until),
    selfExcludedPermanent: !!u.self_excluded_permanent,
  };
}
