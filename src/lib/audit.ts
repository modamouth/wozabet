import type { Q } from './db';

/**
 * Append-only audit trail for admin actions and money events. The table rejects UPDATE/DELETE at database level.
 * Write it with the SAME `q` as the action, so the audit row commits or rolls back together with it.
 */
export interface AuditEntry {
  actorId: string | null; // null = system / provider
  action: string; // e.g. 'withdrawal.approved'
  targetType?: string;
  targetId?: string;
  amountCents?: number;
  details?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(q: Q, e: AuditEntry) {
  await q('INSERT INTO audit_log (actor_id, action, target_type, target_id, amount_cents, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    e.actorId, e.action, e.targetType ?? null, e.targetId ?? null, e.amountCents ?? null, JSON.stringify(e.details ?? {}), e.ip ?? null,
  ]);
}

export async function listAudit(q: Q, opts: { action?: string; targetId?: string; actorId?: string; limit?: number } = {}) {
  const where: string[] = [];
  const p: unknown[] = [];
  if (opts.action) { p.push(opts.action + '%'); where.push(`a.action LIKE $${p.length}`); }
  if (opts.targetId) { p.push(opts.targetId); where.push(`a.target_id = $${p.length}`); }
  if (opts.actorId) { p.push(opts.actorId); where.push(`a.actor_id = $${p.length}`); }
  p.push(Math.min(opts.limit ?? 200, 1000));
  const rows = await q<any>(
    `SELECT a.*, u.phone AS actor_phone, u.role AS actor_role FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT $${p.length}`, p);
  return rows.map((r: any) => ({
    id: r.id, at: r.at, actorId: r.actor_id, actorPhone: r.actor_phone, actorRole: r.actor_role, action: r.action,
    targetType: r.target_type, targetId: r.target_id, amountCents: r.amount_cents, details: r.details, ip: r.ip,
  }));
}
