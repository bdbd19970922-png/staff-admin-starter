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
    { label: '이번 달 매출', value: '-', href: '/reports', note: '리포트 기준' }, // ← 히어로로 단독 노출
    { label: '미지급 급여', value: '-', href: '/payrolls' },
  ]);

  const [uid, setUid] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isManager, setIsManager] = useState<boolean>(false);
  const isElevated = isAdmin || isManager;

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

      const resolvedName = nameFromProfile || (session?.user?.email ? session.user.email.split('@')[0] : '');
      setFullName(resolvedName);
      setIsAdmin(!!elevatedAdmin);
      setIsManager(!!elevatedManager);
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

        const [cnt, rev, unpaid] = await Promise.all([
          todayCountPromise, monthRevenuePromise, unpaidCountPromise,
        ]);

        const next: Stat[] = [
          { label: '오늘 일정', value: cnt, href: '/schedules' },
          { label: '이번 달 매출', value: rev, href: '/reports', note: '리포트 기준' },
          { label: '미지급 급여', value: unpaid, href: '/payrolls' },
        ];
        setStats(next);
      } finally {
        setLoading(false);
      }
    })();
  }, [isElevated, fullName, uid]);

  return (
    <div className="min-h-screen text-slate-900">
      {/* ====== 데스크탑/태블릿(기존 유지) ====== */}
      <div className="hidden sm:block">
        <header className="border-b bg-white">
          <div className="app-container py-6">
            <h1 className="text-3xl font-extrabold tracking-tight">대시보드</h1>
            <p className="text-slate-600 mt-1">요약 지표와 바로가기를 확인하세요.</p>
          </div>
        </header>

        <main className="app-container space-y-7 py-6">
          {/* 기존/공통 카드 */}
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {stats.map((s, i) => (
              <StatCardDesktop key={i} {...s} loading={loading} />
            ))}
          </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <QuickLink href="/schedules" label="스케줄" />
            <QuickLink href="/calendar"  label="캘린더" />
            <QuickLink href="/payrolls"  label="급여" />
            <QuickLink href="/reports"   label="리포트" />
          </section>
        </main>
      </div>

      {/* ====== 📱 모바일 전용 ====== */}
      <div className="sm:hidden relative overflow-hidden">
        {/* 배경 */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -left-32 w-[320px] h-[320px] rounded-full bg-sky-400/20 blur-3xl" />
          <div className="absolute -top-16 right-[-120px] w-[260px] h-[260px] rounded-full bg-indigo-400/20 blur-3xl" />
        </div>

        {/* 상단 히어로(텍스트) */}
        <header className="sticky top-0 z-10 backdrop-blur bg-white/60 border-b border-white/40">
          <div className="px-4 py-4">
            <div className="text-[12px] font-semibold text-sky-700/80">DASHBOARD</div>
            <div className="mt-0.5 text-xl font-extrabold tracking-tight">
              {fullName ? `${fullName}님, 좋은 하루되세요!` : '좋은 하루되세요!'}
            </div>
          </div>
        </header>

        <main className="px-4 py-5 space-y-6">
          {/* ✅ 매출 히어로(단독·가장 위) */}
          <RevenueHero
            loading={loading}
            value={String(stats[1]?.value ?? '-')}
            href={stats[1]?.href}
          />

          {/* 나머지 두 KPI는 그 아래 2칸 */}
          <section className="grid grid-cols-2 gap-2">
            <KpiCard icon="📅" label="오늘 일정" value={loading ? '…' : String(stats[0]?.value ?? '-')} href={stats[0]?.href} />
            <KpiCard icon="✅" label="미지급 급여" value={loading ? '…' : String(stats[2]?.value ?? '-')} href={stats[2]?.href} />
          </section>

          {/* 바로가기 */}
          <section className="grid grid-cols-2 gap-3">
            <ActionCard href="/schedules" title="스케줄" subtitle="일정 확인/관리" emoji="📋" />
            <ActionCard href="/calendar"  title="캘린더" subtitle="월간 보기"     emoji="🗓️" />
            <ActionCard href="/payrolls"  title="급여"   subtitle="지급/정리"     emoji="💳" />
            <ActionCard href="/reports"   title="리포트" subtitle="매출/분석"     emoji="📈" />
          </section>
        </main>
      </div>
    </div>
  );
}

/* ========= 데스크탑용(기존 스타일 유지) ========= */
function StatCardDesktop({ label, value, note, href, loading }: Stat & { loading: boolean }) {
  const Panel = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition h-full">
      {children}
    </div>
  );
  const Content = (
    <Panel>
      <div className="text-[12px] font-semibold text-slate-600">{label}</div>
      <div className={`mt-2 text-3xl font-extrabold tracking-tight ${loading ? 'animate-pulse text-slate-300' : 'text-slate-900'}`}>
        {loading ? '88,888' : value}
      </div>
      {note ? <div className="text-[11px] text-slate-500 mt-3">{note}</div> : null}
    </Panel>
  );
  return href ? (
    <Link href={href} className="block">{Content}</Link>
  ) : Content;
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="group block">
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:shadow-md transition flex items-center justify-between">
        <span className="font-bold tracking-tight text-slate-900 text-lg">{label}</span>
        <span className="font-extrabold text-slate-400 group-hover:text-slate-600 transition">→</span>
      </div>
    </Link>
  );
}

/* ========= 모바일 전용 컴포넌트 ========= */

/** 이번 달 매출을 단독·크게 노출. 잘림 방지: 넉넉한 패딩/라인/오버플로우 */
function RevenueHero({ value, href, loading }: { value: string; href?: string; loading: boolean }) {
  const body = (
    <div
      className="
        rounded-3xl border border-white/60 bg-white/70 backdrop-blur
        px-4 py-5 shadow-[0_12px_30px_rgba(2,132,199,0.18)]
        overflow-visible
      "
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none">💰</div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-slate-600">이번 달</div>
          <div className="text-sm font-semibold text-slate-700">매출</div>
          <div className={`mt-2 font-extrabold tracking-tight ${loading ? 'animate-pulse text-slate-300' : 'text-slate-900'}`}>
            <span className="block text-[26px] leading-[1.15] break-words">{loading ? '…' : value}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">리포트 기준</div>
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href} className="block active:scale-[0.99] transition">{body}</Link> : body;
}

function KpiCard({ icon, label, value, href }: { icon: string; label: string; value: string; href?: string }) {
  const body = (
    <div className="rounded-2xl border border-white/40 bg-white/60 backdrop-blur px-3 py-3 shadow-[0_6px_18px_rgba(2,132,199,0.12)] overflow-visible">
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">{icon}</span>
        <span className="text-[11px] text-slate-600">{label}</span>
      </div>
      <div className="mt-1 text-xl font-extrabold tracking-tight leading-[1.15] break-words">{value}</div>
    </div>
  );
  return href ? <Link href={href} className="block active:scale-[0.99] transition">{body}</Link> : body;
}

function ActionCard({ href, title, subtitle, emoji }: { href: string; title: string; subtitle: string; emoji: string }) {
  return (
    <Link href={href} className="block active:scale-[0.99] transition">
      <div className="rounded-3xl border border-white/50 bg-white/60 backdrop-blur px-4 py-4 shadow-[0_10px_24px_rgba(99,102,241,0.15)]">
        <div className="flex items-center gap-3">
          <div className="text-2xl leading-none">{emoji}</div>
          <div className="min-w-0">
            <div className="font-extrabold tracking-tight">{title}</div>
            <div className="text-[12px] text-slate-600 truncate">{subtitle}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ===== 유틸 ===== */
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
