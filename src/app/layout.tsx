import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './store';
import Shell from './shell';

export const metadata: Metadata = { title: 'Wozabet – Bet Namibia Online', description: 'Wozabet sports betting for Namibia. 18+ Gamble responsibly.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0a0a0a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
