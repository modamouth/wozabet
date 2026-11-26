import crypto from 'node:crypto';
import type { Db } from './db';
import { AppError } from './errors';
import type { FileStorage } from './storage';

export type KycStatus = 'unverified' | 'submitted' | 'verified' | 'rejected';
export type IdType = 'national_id' | 'passport';
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

/** Detect the real file type from its first bytes. The browser's claimed MIME type is never trusted. */
export function sniffDocument(b: Uint8Array): { mime: string; ext: string } | null {
  const starts = (sig: number[]) => sig.every((v, i) => b[i] === v);
  if (starts([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

/**
 * Namibian national ID: 11 digits, the first six are the holder's date of birth (YYMMDD).
 * We check the format and that it matches the date of birth given at sign-up. Passports: 6-9 letters/digits.
 */
export function validateIdNumber(type: IdType, raw: string, dob: string): string {
  const v = raw.replace(/[\s-]/g, '').toUpperCase();
  if (type === 'national_id') {
    if (!/^\d{11}$/.test(v)) throw new AppError('bad_id_number', 'A Namibian ID number has 11 digits');
    if (v.slice(0, 6) !== dob.slice(2, 4) + dob.slice(5, 7) + dob.slice(8, 10)) {
      throw new AppError('id_dob_mismatch', 'The ID number does not match your date of birth');
    }
    return v;
  }
  if (!/^[A-Z0-9]{6,9}$/.test(v)) throw new AppError('bad_id_number', 'Enter a valid passport number');
  return v;
}

export async function submitKyc(db: Db, storage: FileStorage, userId: string, input: { idType: IdType; idNumber: string; document: Uint8Array }) {
  if (input.idType !== 'national_id' && input.idType !== 'passport') throw new AppError('bad_id_type', 'Choose an ID type');
  if (input.document.byteLength === 0) throw new AppError('no_document', 'Upload a photo or scan of your ID');
  if (input.document.byteLength > MAX_DOC_BYTES) throw new AppError('document_too_large', 'The file must be 5 MB or smaller');
  const kind = sniffDocument(input.document);
  if (!kind) throw new AppError('bad_document', 'Upload a JPG, PNG or PDF file');

  const pre = (await db.q<{ dob: string; kyc_status: KycStatus }>("SELECT to_char(dob,'YYYY-MM-DD') AS dob, kyc_status FROM users WHERE id=$1", [userId]))[0];
  if (!pre) throw new AppError('no_user', 'User not found', 404);
  const idNumber = validateIdNumber(input.idType, input.idNumber, pre.dob);

  const id = crypto.randomUUID();
  const key = `kyc/${userId}/${id}.${kind.ext}`;
  await storage.put(key, input.document, kind.mime);
  try {
    return await db.tx(async (q) => {
      const u = (await q<{ kyc_status: KycStatus }>('SELECT kyc_status FROM users WHERE id=$1 FOR UPDATE', [userId]))[0];
      if (u.kyc_status === 'submitted') throw new AppError('kyc_pending', 'Your documents are already being reviewed', 409);
      if (u.kyc_status === 'verified') throw new AppError('kyc_done', 'You are already verified', 409);
      const taken = await q('SELECT 1 FROM users WHERE id_type=$1 AND id_number=$2 AND id<>$3', [input.idType, idNumber, userId]);
      if (taken.length) throw new AppError('id_in_use', 'This ID number is linked to another account. Contact support.', 409);
      await q('INSERT INTO kyc_submissions (id, user_id, id_type, id_number, doc_key, doc_mime, doc_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, userId, input.idType, idNumber, key, kind.mime, input.document.byteLength]);
      await q("UPDATE users SET kyc_status='submitted', id_type=$2, id_number=$3 WHERE id=$1", [userId, input.idType, idNumber]);
      return { id, status: 'submitted' as KycStatus };
    });
  } catch (e) {
    await storage.delete(key).catch(() => {});
    throw e;
  }
}

/** Admin decision on a submission. Reject frees the ID number (so a stolen ID can be re-used by its real owner). */
export async function reviewKyc(db: Db, adminId: string, submissionId: string, decision: { action: 'approve' } | { action: 'reject'; reason: string }) {
  if (decision.action === 'reject' && !decision.reason?.trim()) throw new AppError('reason_required', 'Give a reason for rejecting');
  return db.tx(async (q) => {
    const s = (await q<any>('SELECT * FROM kyc_submissions WHERE id=$1 FOR UPDATE', [submissionId]))[0];
    if (!s) throw new AppError('not_found', 'Submission not found', 404);
    if (s.status !== 'submitted') throw new AppError('not_pending', `This submission is already ${s.status}`, 409);
    if (s.user_id === adminId) throw new AppError('forbidden', 'You cannot review your own documents', 403);
    if (decision.action === 'approve') {
      await q("UPDATE kyc_submissions SET status='approved', reviewed_by=$2, reviewed_at=now() WHERE id=$1", [submissionId, adminId]);
      await q("UPDATE users SET kyc_status='verified' WHERE id=$1", [s.user_id]);
    } else {
      await q("UPDATE kyc_submissions SET status='rejected', reviewed_by=$2, reviewed_at=now(), reason=$3 WHERE id=$1", [submissionId, adminId, decision.reason.trim().slice(0, 500)]);
      await q("UPDATE users SET kyc_status='rejected', id_type=NULL, id_number=NULL WHERE id=$1", [s.user_id]);
    }
    return { id: submissionId, userId: s.user_id as string, status: decision.action === 'approve' ? 'approved' : 'rejected' };
  });
}

export async function kycState(db: Db, userId: string) {
  const u = (await db.q<{ kyc_status: KycStatus }>('SELECT kyc_status FROM users WHERE id=$1', [userId]))[0];
  const last = (await db.q<any>('SELECT status, reason, created_at FROM kyc_submissions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [userId]))[0];
  return { status: u?.kyc_status ?? 'unverified', lastReason: last?.status === 'rejected' ? last.reason : null, submittedAt: last?.created_at ?? null };
}

export async function listKycSubmissions(db: Db, status: 'submitted' | 'approved' | 'rejected') {
  const rows = await db.q<any>(
    `SELECT s.id, s.user_id, s.id_type, s.id_number, s.doc_mime, s.status, s.reason, s.created_at,
            u.first_name, u.last_name, u.phone, to_char(u.dob,'YYYY-MM-DD') AS dob
       FROM kyc_submissions s JOIN users u ON u.id = s.user_id WHERE s.status=$1 ORDER BY s.created_at ASC LIMIT 200`, [status]);
  return rows.map((r: any) => ({
    id: r.id, userId: r.user_id, name: `${r.first_name} ${r.last_name}`, phone: r.phone, dob: r.dob,
    idType: r.id_type, idNumber: r.id_number, docMime: r.doc_mime, status: r.status, reason: r.reason, createdAt: r.created_at,
  }));
}

export async function readKycDocument(db: Db, storage: FileStorage, submissionId: string) {
  const s = (await db.q<{ doc_key: string; doc_mime: string }>('SELECT doc_key, doc_mime FROM kyc_submissions WHERE id=$1', [submissionId]))[0];
  if (!s) throw new AppError('not_found', 'Submission not found', 404);
  return { bytes: await storage.get(s.doc_key), mime: s.doc_mime };
}
