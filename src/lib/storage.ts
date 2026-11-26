import path from 'node:path';
import os from 'node:os';
import { AppError } from './errors';

/** Private file storage for sensitive uploads (KYC documents). Never served publicly; read back only by admins. */
export interface FileStorage {
  kind: 'local' | 's3';
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,200}$/i;
function checkKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) throw new Error(`unsafe storage key: ${key}`);
}

/** Files on local disk. The directory must be OUTSIDE the project folder so uploads can never be committed or served. */
export function localStorage(dir: string, projectRoot = process.cwd()): FileStorage {
  const root = path.resolve(/*turbopackIgnore: true*/ dir);
  const proj = path.resolve(/*turbopackIgnore: true*/ projectRoot);
  if (root === proj || root.startsWith(proj + path.sep)) throw new Error(`KYC_LOCAL_DIR must be outside the project folder (got ${root})`);
  const full = (key: string) => { checkKey(key); return path.join(/*turbopackIgnore: true*/ root, key); };
  return {
    kind: 'local',
    async put(key, data) {
      const fs = await import('node:fs/promises');
      const f = full(key);
      await fs.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
      await fs.writeFile(f, data, { mode: 0o600, flag: 'wx' });
    },
    async get(key) { return new Uint8Array(await (await import('node:fs/promises')).readFile(full(key))); },
    async delete(key) { await (await import('node:fs/promises')).rm(full(key), { force: true }); },
  };
}

export interface S3Config { bucket: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string; forcePathStyle?: boolean }

/** Any S3-compatible store (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces…). Objects are written with server-side encryption. */
export function s3Storage(cfg: S3Config): FileStorage {
  let clientP: Promise<{ client: any; mod: any }> | null = null;
  const c = () => (clientP ??= import('@aws-sdk/client-s3').then((mod) => ({
    mod,
    client: new mod.S3Client({
      region: cfg.region, endpoint: cfg.endpoint || undefined, forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    }),
  })));
  return {
    kind: 's3',
    async put(key, data, contentType) {
      checkKey(key);
      const { client, mod } = await c();
      await client.send(new mod.PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: cfg.endpoint ? undefined : 'AES256' }));
    },
    async get(key) {
      checkKey(key);
      const { client, mod } = await c();
      const r = await client.send(new mod.GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return new Uint8Array(await r.Body.transformToByteArray());
    },
    async delete(key) {
      checkKey(key);
      const { client, mod } = await c();
      await client.send(new mod.DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
  };
}

/**
 * KYC_STORAGE=s3 (production) or local (dev). In production, local storage must be chosen explicitly
 * (e.g. a mounted, backed-up volume) — it is never picked silently.
 */
export function getKycStorage(env: Record<string, string | undefined> = process.env): FileStorage {
  const kind = env.KYC_STORAGE || (env.NODE_ENV === 'production' ? '' : 'local');
  if (kind === 's3') {
    const { KYC_S3_BUCKET: bucket = '', KYC_S3_REGION: region = 'auto', KYC_S3_ENDPOINT: endpoint, KYC_S3_ACCESS_KEY_ID: accessKeyId = '', KYC_S3_SECRET_ACCESS_KEY: secretAccessKey = '' } = env;
    if (!bucket || !accessKeyId || !secretAccessKey) throw new AppError('storage_misconfigured', 'Document storage is not configured', 503);
    return s3Storage({ bucket, region, endpoint, accessKeyId, secretAccessKey, forcePathStyle: env.KYC_S3_FORCE_PATH_STYLE === 'true' });
  }
  if (kind === 'local') return localStorage(env.KYC_LOCAL_DIR || path.join(os.homedir(), '.wozabet', 'kyc-dev'));
  throw new AppError('storage_misconfigured', 'Document storage is not configured (set KYC_STORAGE)', 503);
}
