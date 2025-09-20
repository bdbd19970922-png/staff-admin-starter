// FILE: app/components/AuthBar.tsx
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

  if (pathname?.startsWith('/login')) return null;
  if (!mounted) return null;

  return (
    <header className="sticky top-0 z-10 w-full border-b bg-white">
      <div className="mx-auto max-w-screen-xl px-2 sm:px-4">
        {/* 모바일: 더 얇은 바 (h-10) - [메뉴][로고][이메일][로그아웃] */}
        <div className="flex h-10 items-center justify-between sm:hidden">
          {/* 메뉴 */}
          <button
            className="h-8 px-3 rounded border text-sm shrink-0"
            onClick={() => window.dispatchEvent(new CustomEvent('toggle-menu'))}
            aria-label="메뉴"
          >
            메뉴
          </button>

          {/* 로고 + 이메일 (가운데 묶음) */}
          <div className="flex items-center gap-2 min-w-0">
            {/* 로고: 메뉴 버튼과 같은 높이(h-8) */}
            <img
              src="/logo.png"
              alt="로고"
              className="h-8 w-auto shrink-0 select-none"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="text-xs text-gray-700 truncate max-w-[55vw]">
              {loading ? '확인 중…' : (email ?? '비로그인')}
            </span>
          </div>

          {/* 로그아웃 */}
          <button
            className="h-8 px-3 rounded border text-sm shrink-0"
            onClick={onLogout}
            aria-label="로그아웃"
          >
            로그아웃
          </button>
        </div>

        {/* 데스크탑: 기존 UI 유지 */}
        <div className="hidden sm:flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold">집수리 관리</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-600">
              {loading ? '확인 중…' : (email ?? '비로그인')}
            </span>
            {email && (
              <button
                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
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
