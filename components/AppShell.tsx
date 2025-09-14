// FILE: /components/AppShell.tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import AuthBar from '@/components/AuthBar';
import { supabase } from '@/lib/supabaseClient';
import Image from 'next/image';

type NavItem = { label: string; href: string };

const NAV: NavItem[] = [
  { label: '대시보드', href: '/dashboard' },
  { label: '스케줄', href: '/schedules' },
  { label: '캘린더', href: '/calendar' },
  { label: '급여', href: '/payrolls' },
  { label: '리포트', href: '/reports' },
  { label: '자재', href: '/materials' },
];

// ⚠️ 관리자 전용 경로: 네비게이션에 절대 노출하지 않기 위한 블랙리스트
const HIDDEN_FROM_NAV = new Set<string>(['/admin']);
const NAV_SAFE: NavItem[] = NAV.filter((item) => !HIDDEN_FROM_NAV.has(item.href));

// 인증 라우트 판정
function isAuthRoute(pathname: string | null) {
  if (!pathname) return true;
  return (
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/reset')
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // ------- 세션 상태 -------
  // ready: 세션 판정 완료 여부
  // authed: 로그인 여부 (판정 전엔 null)
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);

  // 낙관적 로그인: 로컬스토리지에 sb- 토큰이 있으면 "잠정 로그인"으로 가정(튕김 방지)
  const optimisticAuthed = useMemo(() => {
    try {
      const keys = Object.keys(localStorage);
      return keys.some((k) => k.startsWith('sb-') && k.includes('auth'));
    } catch { return false; }
  }, []);

  // 첫 페인트에서 튕김 방지용: 판정 전엔 리다이렉트 금지
  const [allowRedirect, setAllowRedirect] = useState(false);

  // 모바일 사이드바
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);

  // ✅ 중복 리다이렉트 가드
  const redirectedRef = useRef(false);

  // 세션 초기화: 느려도 기다리고, 판정 나올 때까지는 절대 리다이렉트 안 함
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } as any }));
      if (!mounted) return;
      setAuthed(!!session?.user);
      setReady(true);
      // 판정이 끝난 뒤에만 리다이렉트 허용
      setAllowRedirect(true);
    })();

    // 세션 변화 구독(로그인/로그아웃)
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session?.user);
      // 이 시점 이후에만 라우팅 보정
      setAllowRedirect(true);
    });

    return () => {
      mounted = false;
      try { sub.subscription?.unsubscribe(); } catch {}
    };
  }, []);

  // 라우팅 보정: "판정 완료 + 리다이렉트 허용"일 때만 동작
  useEffect(() => {
    if (!allowRedirect || authed === null) return;

    const onAuth = authed === true;
    const onGuest = authed === false;
    const isAuthPg = isAuthRoute(pathname);

    // 중복 리다이렉트/자기경로 방지
    const safeReplace = (dest: string) => {
      if (redirectedRef.current) return;
      if (pathname === dest) return;
      redirectedRef.current = true;
      router.replace(dest); // ❌ router.refresh() 제거: 깜빡임/렉 방지
    };

    // 로그인 페이지에 있는데 로그인이 확인되면 대시보드로
    if (onAuth && isAuthPg) {
      safeReplace('/dashboard');
      return;
    }
    // 보호 라우트에 있는데 "게스트"로 확정된 경우에만 로그인으로
    if (onGuest && !isAuthPg) {
      safeReplace('/login');
      return;
    }
    // authed === null (아직 모름) 이거나 authRoute인 경우: 아무것도 하지 않음(대기)
  }, [allowRedirect, authed, pathname, router]);

  // 사이드바/탑탭 노출 여부
  // 판정 전에는 낙관적으로 표시(optimisticAuthed)해서 튕김/깜빡임을 최소화
  const authRoute = isAuthRoute(pathname);
  const showSidebar = (authed ?? optimisticAuthed) && !authRoute;

  return (
    <div
      className="
        min-h-screen text-slate-900
        from-slate-50 to-sky-50
        bg-[radial-gradient(900px_500px_at_10%_-10%,rgba(56,189,248,0.12),transparent),
            radial-gradient(800px_400px_at_90%_-5%,rgba(99,102,241,0.08),transparent),
            linear-gradient(to_bottom,var(--tw-gradient-stops))]
      "
    >
      {/* TopBar */}
      <header className="sticky top-0 z-30 border-b border-sky-100/60 bg-white/80 backdrop-blur">
        <div className="app-container py-3 flex items-center gap-3">
          {/* 모바일 햄버거: 로그인 후에만 */}
          {showSidebar && (
            <button
              className="md:hidden rounded-xl border px-3 py-2 text-sm hover:bg-sky-50 transition"
              onClick={() => setOpen((v) => !v)}
              aria-label="메뉴 열기"
            >
              메뉴
            </button>
          )}

          {/* 왼쪽 상단 로고 */}
          {showSidebar ? (
            <Link href="/dashboard" className="flex items-center">
              <Image src="/logo.jpg" alt="집신 로고" width={60} height={60} priority />
              <span className="sr-only">대시보드</span>
            </Link>
          ) : (
            <div className="flex items-center select-none">
              <Image src="/logo.jpg" alt="집신 로고" width={60} height={60} priority />
            </div>
          )}

          {/* 상단 빠른 메뉴(데스크톱): 로그인 후에만 */}
          {showSidebar && (
            <nav className="hidden md:flex items-center gap-1 ml-3">
              {NAV_SAFE.slice(0, 4).map((item) => (
                <TopLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  active={pathname?.startsWith(item.href) ?? false}
                />
              ))}
            </nav>
          )}

          <div className="ml-auto">
            <AuthBar />
          </div>
        </div>
      </header>

      {/* 본문 레이아웃 */}
      <div
        className={`app-container py-4 grid gap-6 ${
          showSidebar
            ? 'grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)]'
            : 'grid-cols-1'
        }`}
      >
        {/* 사이드바(데스크톱): 로그인 후에만 */}
        {showSidebar && (
          <aside className="hidden lg:block">
            <Sidebar pathname={pathname ?? ''} items={NAV_SAFE} />
          </aside>
        )}

        {/* 사이드바(모바일 오버레이): 로그인 후에만 */}
        {showSidebar && open && (
          <div className="md:hidden fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-0 h.full w-[260px] bg-white shadow-xl">
              <div className="p-3 border-b">
                <div className="font-bold text-sky-700">메뉴</div>
              </div>
              <div className="p-2">
                <Sidebar
                  pathname={pathname ?? ''}
                  items={NAV_SAFE}
                  onNavigate={() => setOpen(false)}
                />
              </div>
            </div>
          </div>
        )}

        {/* 페이지 컨텐츠 */}
        <main className="min-w-0">
          {/* ✅ 로그인/회원가입 등 "인증 라우트"에서는 스켈레톤을 아예 보여주지 않음 */}
          {!authRoute && !ready && (
            <div className="card text-sm">
              로딩 중… 네트워크/쿠키 동기화가 느릴 수 있어요.
              <div className="mt-2 flex gap-2">
                <button
                  className="px-3 py-1.5 rounded border"
                  onClick={() => { router.refresh(); }}
                >
                  다시 시도
                </button>
              </div>
            </div>
          )}
          {/* ready가 아니더라도 authRoute면 children 즉시 렌더 */}
          {(authRoute || ready) && children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  pathname,
  items,
  onNavigate,
}: {
  pathname: string;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  return (
    <nav className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white/90 p-2 shadow-sm">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm mb-1 last:mb-0 transition
              ${
                active
                  ? 'bg-sky-50 text-sky-800 font-semibold border border-sky-200'
                  : 'hover:bg-sky-50/70 text-slate-700 border border-transparent'
              }`}
          >
            <span>{item.label}</span>
            <span className={`font-extrabold ${active ? 'text-sky-500' : 'text-sky-300'}`}>→</span>
          </Link>
        );
      })}
    </nav>
  );
}

function TopLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-xl px-3 py-2 text-sm transition border
        ${active ? 'bg-sky-50 text-sky-800 border-sky-200' : 'hover:bg-sky-50/70 text-slate-700 border-transparent'}`}
    >
      {label}
    </Link>
  );
}
