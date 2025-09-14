// FILE: /app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthBar from '@/components/AuthBar';
import { supabase } from '@/lib/supabaseClient';
import { startOfMonth, endOfMonth, formatISO } from 'date-fns';

type Stat = { label: string; value: string | number; href?: string; note?: string };

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stat[]>([
    { label: '오늘 일정', value: '-', href: '/schedules' },
    { label: '이번 달 총 매출', value: '-', href: '/reports', note: '리포트 기준' },
    { label: '미지급 급여(건수)', value: '-', href: '/payrolls' },
    { label: '이번 달 지출(자재+경비)', value: '-', href: '/reports', note: '리포트 기준' },
  ]);
  const [hello, setHello] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        // 인사 (이메일 → 이름으로)
const { data: { session } } = await supabase.auth.getSession();
const uid = session?.user?.id;

if (uid) {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', uid)
    .single();

  const name = !error && data?.full_name ? data.full_name : session?.user?.email?.split('@')[0] ?? '';
  setHello(name ? `${name} 님 환영합니다!` : '환영합니다!');
}



        // 기간
        const now = new Date();
        const todayStr = formatISO(now, { representation: 'date' }); // YYYY-MM-DD
        const monthStart = formatISO(startOfMonth(now));
        const monthEnd = formatISO(endOfMonth(now));

        // 1) 오늘 일정 개수
        const todayCount = supabase
          .from('schedules')
          .select('*', { count: 'exact', head: true })
          .gte('start_ts', `${todayStr}T00:00:00`)
          .lte('start_ts', `${todayStr}T23:59:59`)
          .then(({ count, error }) => (!error && typeof count === 'number' ? count : 0));

        // 2) 이번 달 매출 합계
        const monthRevenue = supabase
          .from('schedules')
          .select('revenue, material_cost, daily_wage, extra_cost, start_ts')
          .gte('start_ts', monthStart)
          .lte('start_ts', monthEnd)
          .limit(5000)
          .then(({ data, error }) => {
            if (error || !data) return '-';
            const rev = data.reduce((acc: number, r: any) => acc + num(r.revenue), 0);
            return fmtKRW(rev);
          });

        // 3) 미지급 급여 건수
        const unpaidCount = (() => {
          const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          return supabase
            .from('payrolls')
            .select('*', { count: 'exact', head: true })
            .eq('pay_month', ym)
            .eq('paid', false)
            .then(({ count, error }) => (!error && typeof count === 'number' ? count : 0));
        })();

        // 4) 이번 달 지출(자재+경비)
        const monthSpending = (async () => {
          let sum = 0;

          const s = await supabase
            .from('schedules')
            .select('material_cost, extra_cost, start_ts')
            .gte('start_ts', monthStart)
            .lte('start_ts', monthEnd)
            .limit(5000);
          if (!s.error && s.data) {
            sum += s.data.reduce((acc: number, r: any) => acc + num(r.material_cost) + num(r.extra_cost), 0);
          }

          const e = await supabase
            .from('expenses')
            .select('amount, spent_at')
            .gte('spent_at', monthStart)
            .lte('spent_at', monthEnd)
            .limit(5000);
          if (!e.error && e.data) {
            sum += e.data.reduce((acc: number, r: any) => acc + num(r.amount), 0);
          }

          return fmtKRW(sum);
        })();

        const [cnt, rev, unpaid, spend] = await Promise.all([todayCount, monthRevenue, unpaidCount, monthSpending]);

        setStats([
          { label: '오늘 일정', value: cnt, href: '/schedules' },
          { label: '이번 달 총 매출', value: rev, href: '/reports', note: '리포트 기준' },
          { label: '미지급 급여(건수)', value: unpaid, href: '/payrolls' },
          { label: '이번 달 지출(자재+경비)', value: spend, href: '/reports', note: '리포트 기준' },
        ]);
      } catch {
        // 무시
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div
      className="
        min-h-screen text-slate-900
        from-slate-50 to-sky-50
        bg-[radial-gradient(900px_500px_at_10%_-10%,rgba(56,189,248,0.18),transparent),
            radial-gradient(800px_400px_at_90%_-5%,rgba(99,102,241,0.12),transparent),
            linear-gradient(to_bottom,var(--tw-gradient-stops))]
      "
    >
      

      {/* 상단 헤더: 파스텔 블루 포인트 + 얇은 경계선 */}
      <header className="sticky top-0 z-10 border-b border-sky-100/60 bg-white/75 backdrop-blur">
        <div className="app-container py-5">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-sky-700 via-sky-600 to-indigo-600 bg-clip-text text-transparent">
              대시보드
            </span>
          </h1>
          <p className="text-slate-600 mt-1 font-medium">{hello}</p>
        </div>
      </header>

      <main className="app-container space-y-7 py-6">
        {/* 빠른 이동: 부드러운 파란 버튼 */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickLink href="/schedules" label="스케줄" />
          <QuickLink href="/calendar" label="캘린더" />
          <QuickLink href="/payrolls" label="급여" />
          <QuickLink href="/reports" label="리포트" />
        </section>

        {/* KPI 카드: 화이트→파스텔 블루 그라데이션 + 얇은 링 + 고급 그림자 */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {stats.map((s, i) => (
            <StatCard key={i} {...s} loading={loading} />
          ))}
        </section>
      </main>
    </div>
  );
}

/* ---------- 파스텔 QuickLink ---------- */
function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="group block">
      <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/60 bg-white/90 px-5 py-4 shadow-sm hover:shadow-md hover:bg-sky-50/60 transition flex items-center justify-between">
        <span className="font-bold tracking-tight text-slate-900">{label}</span>
        <span className="font-extrabold text-sky-500 group-hover:translate-x-0.5 transition">→</span>
      </div>
    </Link>
  );
}

/* ---------- 파스텔 StatCard ---------- */
function StatCard({ label, value, note, href, loading }: Stat & { loading: boolean }) {
  const Panel = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-gradient-to-br from-white to-sky-50/60 p-5 shadow-[0_6px_16px_rgba(2,132,199,0.08)] hover:shadow-[0_10px_22px_rgba(2,132,199,0.12)] transition h-full">
      {children}
    </div>
  );

  const Content = (
    <Panel>
      <div className="text-[12px] font-semibold text-sky-700/80">{label}</div>
      <div className={`mt-2 text-3xl md:text-4xl font-extrabold tracking-tight ${loading ? 'animate-pulse text-slate-300' : 'text-slate-900'}`}>
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

/* -------- 유틸 -------- */
function num(v: any): number {
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
