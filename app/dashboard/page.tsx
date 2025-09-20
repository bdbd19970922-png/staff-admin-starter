// FILE: app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { startOfMonth, endOfMonth, formatISO } from 'date-fns';

type Stat = { label: string; value: string | number; href?: string; note?: string };

async function waitForAuthReady(maxTries = 6, delayMs = 300) {
  for (let i = 0; i < maxTries; i++) {
    const { data, error } = await supabase.auth.getSession();
    const hasToken = !!data?.session?.access_token;
    if (!error && hasToken) return data.session!;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stat[]>([
    { label: '오늘 일정', value: '-', href: '/schedules' },
    { label: '이번 달 총 매출', value: '-', href: '/reports', note: '리포트 기준' },
    { label: '미지급 급여(건수)', value: '-', href: '/payrolls' },
  ]);

  const [uid, setUid] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isManager, setIsManager] = useState<boolean>(false);
  const isElevated = isAdmin || isManager;
  const [hello, setHello] = useState<string>('');

  useEffect(() => {
    (async () => {
      const session = await waitForAuthReady();
      const _uid = session?.user?.id ?? null;
      const email = (session?.user?.email ?? '').toLowerCase();
      setUid(_uid);

      const parseList = (env?: string) =>
        (env ?? '').split(',').map(s => s.trim()).filter(Boolean);
      const adminIds = parseList(process.env.NEXT_PUBLIC_ADMIN_IDS);
      const adminEmails = parseList(process.env.NEXT_PUBLIC_ADMIN_EMAILS).map(s => s.toLowerCase());

      let elevatedAdmin = (!!_uid && adminIds.includes(_uid)) || (!!email && adminEmails.includes(email));
      let elevatedManager = false;

      let nameFromProfile = '';
      if (_uid) {
        const { data: me } = await supabase
          .from('profiles')
          .select('full_name, is_admin, is_manager')
          .eq('id', _uid)
          .maybeSingle();

        nameFromProfile = (me?.full_name ?? '').trim();
        if (me?.is_admin) elevatedAdmin = true;
        if (me?.is_manager) elevatedManager = true;
      }

      const resolvedName =
        nameFromProfile ||
        (session?.user?.email ? session.user.email.split('@')[0] : '');

      setFullName(resolvedName);
      setIsAdmin(!!elevatedAdmin);
      setIsManager(!!elevatedManager);
      setHello(resolvedName ? `${resolvedName} 님 환영합니다!` : '환영합니다!');
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await waitForAuthReady();

        const now = new Date();
        const todayStr   = formatISO(now, { representation: 'date' });
        const monthStart = formatISO(startOfMonth(now));
        const monthEnd   = formatISO(endOfMonth(now));

        const buildOwnerOr = (meUid: string | null, meName: string) => {
          const nameEnc = (meName ?? '').replace(/([{}%,])/g, '');
          const parts: string[] = [];
          if (meUid) parts.push(`employee_id.eq.${meUid}`);
          if (nameEnc) {
            parts.push(`employee_names.cs.{${nameEnc}}`);
            parts.push(`employee_name.ilike.%${nameEnc}%`);
          }
          return parts.length ? parts.join(',') : 'id.eq.-1';
        };

        const todayCountPromise = (async () => {
          let q = supabase
            .from('schedules_secure')
            .select('id', { count: 'exact', head: true })
            .gte('start_ts', `${todayStr}T00:00:00`)
            .lte('start_ts', `${todayStr}T23:59:59`);
          if (!isElevated) q = q.or(buildOwnerOr(uid, fullName));
          const { count } = await q;
          return typeof count === 'number' ? count : 0;
        })();

        const monthRevenuePromise = (async () => {
          let q = supabase
            .from('schedules_secure')
            .select('revenue,start_ts')
            .gte('start_ts', monthStart)
            .lte('start_ts', monthEnd)
            .limit(5000);
          if (!isElevated) q = q.or(buildOwnerOr(uid, fullName));
          const { data } = await q;
          if (!data) return '-';
          const rev = data.reduce((acc: number, r: any) => acc + toNum(r.revenue), 0);
          return fmtKRW(rev);
        })();

        const unpaidCountPromise = (async () => {
          const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          let q = supabase
            .from('payrolls_secure')
            .select('*', { count: 'exact', head: true })
            .eq('pay_month', ym)
            .eq('paid', false);
          if (!isElevated && uid) q = q.eq('employee_id', uid);
          const { count } = await q;
          return typeof count === 'number' ? count : 0;
        })();

        const monthSpendingPromise = (async () => {
          if (!isAdmin) return null;
          let sum = 0;

          {
            const { data } = await supabase
              .from('schedules_secure')
              .select('material_cost,extra_cost,start_ts')
              .gte('start_ts', monthStart)
              .lte('start_ts', monthEnd)
              .limit(5000);
            if (data) {
              sum += data.reduce((acc: number, r: any) => acc + toNum(r.material_cost) + toNum(r.extra_cost), 0);
            }
          }

          {
            const { data, error } = await supabase
              .from('expenses')
              .select('amount, spent_at')
              .gte('spent_at', monthStart)
              .lte('spent_at', monthEnd)
              .limit(5000);
            if (!error && data) {
              sum += data.reduce((acc: number, r: any) => acc + toNum(r.amount), 0);
            }
          }

          return fmtKRW(sum);
        })();

        const [cnt, rev, unpaid, spend] = await Promise.all([
          todayCountPromise, monthRevenuePromise, unpaidCountPromise, monthSpendingPromise,
        ]);

        const next: Stat[] = [
          { label: '오늘 일정', value: cnt, href: '/schedules' },
          { label: '이번 달 총 매출', value: rev, href: '/reports', note: '리포트 기준' },
          { label: '미지급 급여(건수)', value: unpaid, href: '/payrolls' },
        ];
        if (isAdmin) {
          next.push({ label: '이번 달 지출(자재+경비)', value: spend ?? '-', href: '/reports', note: '리포트 기준' });
        }

        setStats(next);
      } finally {
        setLoading(false);
      }
    })();
  }, [isElevated, isAdmin, fullName, uid]);

  return (
    <div className="min-h-screen text-slate-900 bg-[radial-gradient(900px_500px_at_10%_-10%,rgba(56,189,248,0.18),transparent),radial-gradient(800px_400px_at_90%_-5%,rgba(99,102,241,0.12),transparent),linear-gradient(to_bottom,var(--tw-gradient-stops))] from-slate-50 to-sky-50">
      <header className="sticky top-0 z-10 border-b border-sky-100/60 bg-white/75 backdrop-blur">
        <div className="app-container py-4 md:py-6">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-sky-700 via-sky-600 to-indigo-600 bg-clip-text text-transparent">
              대시보드
            </span>
          </h1>
          <p className="text-slate-600 mt-1 font-medium">{hello}</p>
          {!isElevated && (
            <p className="text-slate-500 text-sm mt-0.5">
              {fullName ? `${fullName} 님, 오늘도 안전 최우선! 항상 노고에 감사드립니다 🙏` : '오늘도 안전 최우선! 항상 노고에 감사드립니다 🙏'}
            </p>
          )}
        </div>
      </header>

      <main className="app-container space-y-7 py-6">
        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <QuickLink href="/schedules" label="스케줄" />
          <QuickLink href="/calendar" label="캘린더" />
          <QuickLink href="/payrolls" label="급여" />
          <QuickLink href="/reports" label="리포트" />
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {stats.map((s, i) => (
            <StatCard key={i} {...s} loading={loading} />
          ))}
        </section>
      </main>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="group block">
      <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/60 bg-white/90 px-5 py-4 min-h-[var(--tap-size)] shadow-sm hover:shadow-md hover:bg-sky-50/60 transition flex items-center justify-between">
        <span className="font-bold tracking-tight text-slate-900 text-base sm:text-lg">{label}</span>
        <span className="font-extrabold text-sky-500 group-hover:translate-x-0.5 transition">→</span>
      </div>
    </Link>
  );
}

function StatCard({ label, value, note, href, loading }: Stat & { loading: boolean }) {
  const Panel = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-gradient-to-br from-white to-sky-50/60 p-5 shadow-[0_6px_16px_rgba(2,132,199,0.08)] hover:shadow-[0_10px_22px_rgba(2,132,199,0.12)] transition h-full min-h-[120px]">
      {children}
    </div>
  );

  const Content = (
    <Panel>
      <div className="text-[12px] font-semibold text-sky-700/80">{label}</div>
      <div className={`mt-2 text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight ${loading ? 'animate-pulse text-slate-300' : 'text-slate-900'}`}>
        {loading ? '88,888' : value}
      </div>
      {note ? <div className="text-[11px] text-slate-500 mt-3 font-medium">{note}</div> : null}
    </Panel>
  );

  return href ? (
    <Link href={href} className="block hover:-translate-y-0.5 transition">
      {Content}
    </Link>
  ) : (
    Content
  );
}

function toNum(v: any): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
function fmtKRW(v: number) {
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${Math.round(v).toLocaleString()}원`;
  }
}
