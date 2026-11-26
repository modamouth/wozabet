import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Db } from '@/lib/db';
import { localStorage, getKycStorage, type FileStorage } from '@/lib/storage';
import { submitKyc, reviewKyc, kycState, listKycSubmissions, readKycDocument, sniffDocument, validateIdNumber } from '@/lib/kyc';
import { requestWithdrawal } from '@/lib/withdrawals';
import { credit } from '@/lib/wallet';
import { freshDb, makeUser } from './helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = new TextEncoder().encode('%PDF-1.7 fake');
const EXE = new TextEncoder().encode('MZ\x90\x00 not an image');
const DOB = '1990-01-01';
const NAM_ID = '90010100123'; // YYMMDD = 900101

let db: Db;
let storage: FileStorage;
let dir: string;

beforeEach(async () => {
  db = await freshDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wozabet-kyc-test-'));
  storage = localStorage(dir);
});

describe('document & ID validation', () => {
  it('sniffs real file types and ignores claimed ones', () => {
    expect(sniffDocument(PNG)?.mime).toBe('image/png');
    expect(sniffDocument(PDF)?.mime).toBe('application/pdf');
    expect(sniffDocument(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniffDocument(EXE)).toBeNull();
  });
  it('checks Namibian ID format and date-of-birth match', () => {
    expect(validateIdNumber('national_id', '900101 00123', DOB)).toBe(NAM_ID);
    expect(() => validateIdNumber('national_id', '9001010012', DOB)).toThrow(/11 digits/);
    expect(() => validateIdNumber('national_id', '85010100123', DOB)).toThrow(/date of birth/);
    expect(validateIdNumber('passport', 'p1234567', DOB)).toBe('P1234567');
    expect(() => validateIdNumber('passport', '12', DOB)).toThrow();
  });
});

describe('storage config', () => {
  it('refuses a local folder inside the project and requires explicit config in production', () => {
    expect(() => localStorage(path.join(process.cwd(), 'uploads'))).toThrow(/outside the project/);
    expect(() => getKycStorage({ NODE_ENV: 'production' })).toThrow();
    expect(() => getKycStorage({ KYC_STORAGE: 's3', KYC_S3_BUCKET: 'b' })).toThrow();
    expect(getKycStorage({ KYC_STORAGE: 's3', KYC_S3_BUCKET: 'b', KYC_S3_ACCESS_KEY_ID: 'a', KYC_S3_SECRET_ACCESS_KEY: 's' }).kind).toBe('s3');
    expect(getKycStorage({ KYC_LOCAL_DIR: dir }).kind).toBe('local');
  });
  it('rejects path traversal keys', async () => {
    await expect(storage.put('../escape.txt', PNG, 'image/png')).rejects.toThrow(/unsafe/);
  });
});

describe('KYC workflow', () => {
  it('submit -> admin approve -> withdrawals unlocked', async () => {
    const admin = await makeUser(db, { role: 'admin' });
    const u = await makeUser(db);
    await credit(db.q, u.id, 50_000, 'deposit', 'd1');
    await expect(requestWithdrawal(db, u.id, 10_000)).rejects.toMatchObject({ code: 'kyc_required' });

    const s = await submitKyc(db, storage, u.id, { idType: 'national_id', idNumber: NAM_ID, document: PNG });
    expect((await kycState(db, u.id)).status).toBe('submitted');
    await expect(requestWithdrawal(db, u.id, 10_000)).rejects.toMatchObject({ code: 'kyc_required' }); // still blocked while in review
    await expect(submitKyc(db, storage, u.id, { idType: 'national_id', idNumber: NAM_ID, document: PNG })).rejects.toMatchObject({ code: 'kyc_pending' });

    const pending = await listKycSubmissions(db, 'submitted');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ idNumber: NAM_ID, dob: DOB, docMime: 'image/png' });
    const doc = await readKycDocument(db, storage, s.id);
    expect(Array.from(doc.bytes)).toEqual(Array.from(PNG));
    // stored outside the project, owner-only permissions
    const stored = fs.readdirSync(path.join(dir, 'kyc', u.id));
    expect(stored).toHaveLength(1);
    expect(fs.statSync(path.join(dir, 'kyc', u.id, stored[0])).mode & 0o077).toBe(0);

    await expect(reviewKyc(db, admin.id, s.id, { action: 'reject', reason: '' })).rejects.toMatchObject({ code: 'reason_required' });
    await reviewKyc(db, admin.id, s.id, { action: 'approve' });
    await expect(reviewKyc(db, admin.id, s.id, { action: 'reject', reason: 'x' })).rejects.toMatchObject({ code: 'not_pending' });
    expect((await kycState(db, u.id)).status).toBe('verified');
    expect((await requestWithdrawal(db, u.id, 10_000)).status).toBe('pending');
  });

  it('reject shows the reason, frees the ID number and allows resubmission', async () => {
    const admin = await makeUser(db, { role: 'admin' });
    const u = await makeUser(db);
    const s = await submitKyc(db, storage, u.id, { idType: 'national_id', idNumber: NAM_ID, document: PDF });
    await reviewKyc(db, admin.id, s.id, { action: 'reject', reason: 'Photo is blurry' });
    expect(await kycState(db, u.id)).toMatchObject({ status: 'rejected', lastReason: 'Photo is blurry' });
    const other = await makeUser(db);
    // the real owner of that ID can now use it on their account
    expect((await submitKyc(db, storage, other.id, { idType: 'national_id', idNumber: NAM_ID, document: PNG })).status).toBe('submitted');
  });

  it('blocks the same ID on two accounts, bad files, and self-review; cleans up the file on failure', async () => {
    const a = await makeUser(db, { role: 'admin' });
    const u1 = await makeUser(db);
    const u2 = await makeUser(db);
    await submitKyc(db, storage, u1.id, { idType: 'national_id', idNumber: NAM_ID, document: PNG });
    await expect(submitKyc(db, storage, u2.id, { idType: 'national_id', idNumber: NAM_ID, document: PNG })).rejects.toMatchObject({ code: 'id_in_use' });
    expect(fs.existsSync(path.join(dir, 'kyc', u2.id)) ? fs.readdirSync(path.join(dir, 'kyc', u2.id)) : []).toHaveLength(0);
    await expect(submitKyc(db, storage, u2.id, { idType: 'national_id', idNumber: '90010100999', document: EXE })).rejects.toMatchObject({ code: 'bad_document' });
    await expect(submitKyc(db, storage, u2.id, { idType: 'national_id', idNumber: '90010100999', document: new Uint8Array(6 * 1024 * 1024).fill(0xff) })).rejects.toMatchObject({ code: 'document_too_large' });
    await expect(submitKyc(db, storage, u2.id, { idType: 'national_id', idNumber: '85010100999', document: PNG })).rejects.toMatchObject({ code: 'id_dob_mismatch' });
    const own = await submitKyc(db, storage, a.id, { idType: 'passport', idNumber: 'P7654321', document: PNG });
    await expect(reviewKyc(db, a.id, own.id, { action: 'approve' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
