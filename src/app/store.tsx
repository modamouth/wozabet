'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface Odd { selection: string; priceMilli: number; suspended: boolean }
export interface Match {
  id: string; sport: string; league: string; home: string; away: string; kickoff: string; status: string;
  homeScore: number | null; awayScore: number | null; odds: Odd[];
}
export interface Pick { fixtureId: string; selection: '1' | 'X' | '2'; priceMilli: number; pickName: string; game: string }
export interface Me {
  user: { id: string; phone: string; firstName: string; lastName: string; role: string; kycStatus: string; balanceCents: number; sessionReminderMinutes: number | null } | null;
  paymentsEnabled: boolean; minDepositCents: number; minWithdrawalCents: number;
  demoMode: boolean; liveBetting: boolean; minStakeCents: number; maxStakeCents: number;
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public data?: any) { super(message); }
}
export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? 'POST' : 'GET'),
    headers: init?.json !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error?.code ?? 'error', body?.error?.message ?? 'Something went wrong', body?.error?.data);
  return body as T;
}

interface Ctx {
  me: Me | null; refreshMe: () => Promise<void>;
  picks: Record<string, Pick>; toggle: (m: Match, o: Odd) => void; remove: (id: string) => void; clear: () => void;
  applyPrices: (changed: { fixtureId: string; priceMilli: number }[]) => void;
  slipOpen: boolean; setSlipOpen: (v: boolean) => void;
}
const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);

export function Providers({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [slipOpen, setSlipOpen] = useState(false);

  const refreshMe = useCallback(async () => { try { setMe(await api<Me>('/api/me')); } catch { /* offline */ } }, []);
  useEffect(() => { void refreshMe(); }, [refreshMe]);

  const value = useMemo<Ctx>(() => ({
    me, refreshMe, picks, slipOpen, setSlipOpen,
    toggle: (m, o) => setPicks((p) => {
      const n = { ...p };
      if (n[m.id]?.selection === o.selection) { delete n[m.id]; return n; }
      const pickName = o.selection === '1' ? m.home : o.selection === '2' ? m.away : 'Draw';
      n[m.id] = { fixtureId: m.id, selection: o.selection as Pick['selection'], priceMilli: o.priceMilli, pickName: `${pickName} (${o.selection})`, game: `${m.home} vs ${m.away}` };
      return n;
    }),
    remove: (id) => setPicks((p) => { const n = { ...p }; delete n[id]; return n; }),
    clear: () => setPicks({}),
    applyPrices: (changed) => setPicks((p) => {
      const n = { ...p };
      for (const c of changed) if (n[c.fixtureId]) n[c.fixtureId] = { ...n[c.fixtureId], priceMilli: c.priceMilli };
      return n;
    }),
  }), [me, refreshMe, picks, slipOpen]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
