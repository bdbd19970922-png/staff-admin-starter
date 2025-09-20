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
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);

  // 낙관적 로그인
  const optimisticAuthed = useMemo(() => {
    try {
      const keys = Object.keys(localStorage);
      return keys.some((k) => k.startsWith('sb-') && k.includes('auth'));
    } catch { return false; }
  }, []);

  // 첫 페인트에서 튕김 방지용
  const [allowRedirect, setAllowRedirect] = useState(false);

  // 모바일 사이드바
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);

  // ✅ 중복 리다이렉트 가드
  const redirectedRef = useRef(false);

  // 세션 초기화
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } as any }));
      if (!mounted) return;
      setAuthed(!!session?.user);
      setReady(true);
      setAllowRedirect(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session?.user);
      setAllowRedirect(true);
    });

    return () => {
      mounted = false;
      try { sub.subscription?.unsubscribe(); } catch {}
    };
  }, []);

  // 라우팅 보정
  useEffect(() => {
    if (!allowRedirect || authed === null) return;

    const onAuth = authed === true;
    const onGuest = authed === false;
    const isAuthPg = isAuthRoute(pathname);

    const safeReplace = (dest: string) => {
      if (redirectedRef.current) return;
      if (pathname === dest) return;
      redirectedRef.current = true;
      router.replace(dest);
    };

    if (onAuth && isAuthPg) {
      safeReplace('/dashboard');
      return;
    }
    if (onGuest && !isAuthPg) {
      safeReplace('/login');
      return;
    }
  }, [allowRedirect, authed, pathname, router]);

  // 사이드바/탑탭 노출 여부
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
      <header className="sticky top-0 z-30 border-b border-sky-100/60 bg-white/80 backdrop-blur [writing-mode:horizontal-tb]">
        {/* ⬇️ 모바일 세로 여백 축소: py-2, 데스크탑은 기존 py-3 유지 */}
        <div className="app-container py-2 md:py-3 flex items-center row-tight no-vertical">
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

          {/* 왼쪽 상단 로고 
              - 모바일: 작게(h-6)
              - 데스크탑: 기존 크기(h-[60px]) 유지
              - 파일 경로: /public/logo.png */}
          {showSidebar ? (
            <Link href="/dashboard" className="flex items-center">
              <Image
                src="/logo.png"
                alt="집신 로고"
                width={60}
                height={60}
                priority
                className="h-12 sm:h-[60px] w-auto shrink-0 select-none"
              />
              <span className="sr-only">대시보드</span>
            </Link>
          ) : (
            <div className="flex items-center select-none">
              <Image
                src="/logo.png"
                alt="집신 로고"
                width={60}
                height={60}
                priority
                className="h-6 sm:h-[60px] w-auto shrink-0"
              />
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
        {/* 사이드바(데스크탑): 로그인 후에만 */}
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
