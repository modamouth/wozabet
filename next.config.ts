import type { NextConfig } from 'next';

const config: NextConfig = {
  // self-contained server bundle for the Docker image (Vercel ignores this)
  output: 'standalone',
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
};
export default config;
