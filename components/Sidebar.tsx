// FILE: /components/Sidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  LayoutDashboard, Calendar, Package, Receipt, CreditCard, ClipboardList,
} from 'lucide-react';

const items = [
  { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
  { href: '/schedules', label: '스케줄',  icon: Calendar },
  { href: '/calendar',  label: '캘린더',  icon: Calendar },
  { href: '/payrolls',  label: '급여',    icon: CreditCard },
  { href: '/materials', label: '자재',    icon: Package },
  { href: '/reports',   label: '리포트',  icon: ClipboardList },
];

/** 마운트 여부 훅 (서버/클라 첫 렌더 HTML을 동일하게 유지) */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export default function Sidebar() {
  // ✅ 훅은 컴포넌트 최상단에서 호출
  const pathname = usePathname();
  const mounted = useMounted();
  const [loggedIn, setLoggedIn] = useState(false);

  // 로그인 상태는 "마운트 이후"에만 반영해 초기 HTML 불일치 방지
  useEffect(() => {
    let alive = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      setLoggedIn(!!session);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!alive) return;
      setLoggedIn(!!session);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // 로그인/패스워드 관련 페이지에서는 사이드바 숨김 (서버/클라 동일 조건)
  const hide =
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/reset-password') ||
    pathname?.startsWith('/update-password');

  if (hide) return null;

  // ✅ 마운트 전: 항상 동일한 스켈레톤을 렌더 → 서버/클라 첫 HTML 100% 동일
  if (!mounted) {
    return (
      <aside className="fixed left-0 top-0 h-screen w-[var(--sidebar-width,220px)] border-r bg-white">
        <div className="px-5 py-4 text-xl font-bold">집수리 관리</div>
        <nav className="px-2 space-y-2">
          <div className="h-9 rounded-lg bg-gray-100" />
          <div className="h-9 rounded-lg bg-gray-100" />
          <div className="h-9 rounded-lg bg-gray-100" />
          <div className="h-9 rounded-lg bg-gray-100" />
        </nav>
        <div className="absolute bottom-4 left-0 w-full px-4">
          {/* 버튼 대신 스켈레톤(레이아웃 높이 유지용) */}
          <div className="h-9 w-full rounded-md border border-gray-200 bg-gray-50" />
        </div>
      </aside>
    );
  }

  // ✅ 마운트 후: 실제 UI/기능 렌더 (기존 동작 그대로)
  return (
    <aside className="fixed left-0 top-0 h-screen w-[var(--sidebar-width,220px)] border-r bg-white">
      <div className="px-5 py-4 text-xl font-bold">집수리 관리</div>
      <nav className="px-2">
        {items.map((it) => {
          const Icon = it.icon as any;
          const active = pathname?.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={clsx(
                'my-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-gray-100',
                active ? 'bg-gray-100 font-semibold' : 'text-gray-700'
              )}
            >
              <Icon size={18} />
              {it.label}
            </Link>
          );
        })}
      </nav>
      <div className="absolute bottom-4 left-0 w-full px-4">
        {loggedIn ? (
          <button
            onClick={async () => {
              await supabase.auth.signOut().catch(() => {});
              window.location.replace('/login');
            }}
            className="block w-full rounded-md border px-3 py-2 text-center text-sm hover:bg-gray-50"
          >
            로그아웃
          </button>
        ) : null}
      </div>
    </aside>
  );
}
