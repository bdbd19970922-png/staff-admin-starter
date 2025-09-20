// FILE: components/AuthBar.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type SbUser = {
  id: string;
  email: string | null;
  user_metadata?: Record<string, any>;
};

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

// 프로필 동기화 (원본 로직 유지)
async function ensureProfileFromAuthUser(user: SbUser | null) {
  if (!user?.id) return;
  const meta = user.user_metadata ?? {};
  const nameFromAuth: string | null =
    meta.display_name ?? meta.name ?? meta.full_name ?? null;
  const phoneFromAuth: string | null = meta.phone ?? null;
  const emailFromAuth: string | null = user.email ?? null;

  const { data: prof } = await supabase
    .from('profiles')
    .select('id, name, full_name, phone, email')
    .eq('id', user.id)
    .maybeSingle();

  const nextName =
    (prof?.name && String(prof.name).trim()) ||
    (nameFromAuth && String(nameFromAuth).trim()) ||
    null;

  const nextFullName =
    (prof?.full_name && String(prof.full_name).trim()) ||
    (nameFromAuth && String(nameFromAuth).trim()) ||
    null;

  const nextPhone =
    (prof?.phone && String(prof.phone).trim()) ||
    (phoneFromAuth && String(phoneFromAuth).trim()) ||
    null;

  const nextEmail =
    (prof?.email && String(prof.email).trim()) ||
    (emailFromAuth && String(emailFromAuth).trim()) ||
    null;

  const hasNoChange =
    (prof?.name ?? null) === nextName &&
    (prof?.full_name ?? null) === nextFullName &&
    (prof?.phone ?? null) === nextPhone &&
    (prof?.email ?? null) === nextEmail;

  if (hasNoChange && prof) return;

  const payload = {
    id: user.id,
    name: nextName,
    full_name: nextFullName,
    phone: nextPhone,
    email: nextEmail,
    updated_at: new Date().toISOString(),
  };

  await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
}

export default function AuthBar() {
  const router = useRouter();
  const pathname = usePathname();
  const mounted = useMounted();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const syncingRef = useRef(false);

  const bgSync = (user: SbUser | null) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setTimeout(() => {
      ensureProfileFromAuthUser(user).finally(() => {
        syncingRef.current = false;
      });
    }, 0);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      const user = (session?.user ?? null) as SbUser | null;
      setEmail(user?.email ?? null);
      setLoading(false);
      bgSync(user);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const user = (session?.user ?? null) as SbUser | null;
      setEmail(user?.email ?? null);
      bgSync(user);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const onLogout = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' } as any).catch(() => {});
      await supabase.auth.signOut().catch(() => {});
    } catch {}
    try {
      const keys = Object.keys(window.localStorage);
      keys.forEach((k) => { if (k.startsWith('sb-')) localStorage.removeItem(k); });
      sessionStorage.clear();
    } catch {}
    try {
      router.replace('/login');
    } catch {
      window.location.assign('/login');
    }
  };

  // 로그인 페이지에서는 상단바 숨김 (원본 유지)
  if (pathname?.startsWith('/login')) return null;
  if (!mounted) return null;

  return (
    // 글자가 세로로 세워지지 않도록 강제: writing-mode 가로 고정
    <header className="sticky top-0 z-10 w-full border-b bg-white [writing-mode:horizontal-tb]">
      <div className="mx-auto max-w-screen-xl px-2 sm:px-3">
        {/* === 모바일 (<= sm) : 여백 최소화, 메뉴 버튼 제거, 글자 가로 고정 === */}
        <div className="flex h-9 items-center justify-between gap-2 sm:hidden">
          {/* 좌측: 로고 (필요 시 자동 숨김 처리 유지) */}
          <img
  src="/logo.png"
  alt="로고"
  className="hidden sm:block h-7 w-auto shrink-0 select-none"
  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
/>

          {/* 가운데: 이메일 (최대폭 제한 + 말줄임) */}
          <span
            className="min-w-0 max-w-[58vw] text-[11px] text-gray-700 truncate whitespace-nowrap"
            title={loading ? '확인 중…' : (email ?? '비로그인')}
          >
            {loading ? '확인 중…' : (email ?? '비로그인')}
          </span>

          {/* 우측: 로그아웃(아이콘 느낌으로 컴팩트) */}
          <button
  className="h-7 px-2 text-[11px] rounded border leading-none whitespace-nowrap hover:bg-gray-50 active:scale-[0.98] min-w-[64px]"
  onClick={onLogout}
  aria-label="로그아웃"
>
  로그아웃
</button>
        </div>

        {/* === 데스크탑 (>= sm) : 기존 레이아웃 유지하되 여백 살짝만 다이어트 === */}
        <div className="hidden sm:flex sm:h-12 sm:items-center sm:justify-between sm:gap-2 sm:py-1">
          <div className="text-sm font-semibold whitespace-nowrap">집수리 관리</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 truncate whitespace-nowrap" title={loading ? '확인 중…' : (email ?? '비로그인')}>
              {loading ? '확인 중…' : (email ?? '비로그인')}
            </span>
            {email && (
              <button
  className="h-9 px-3 text-sm rounded border leading-none whitespace-nowrap hover:bg-gray-50 min-w-[72px]"
  onClick={onLogout}
>
  로그아웃
</button>

            )}
          </div>
        </div>
      </div>
    </header>
  );
}
