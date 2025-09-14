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

/** 마운트 여부 훅 (서버/클라 첫 HTML 일치 보장용) */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** auth.users → public.profiles 동기화 (렌더 블로킹 금지) */
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

  // 중복 동기화 방지 + 백그라운드 실행
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

      const user = (session?.user ?? null) as unknown as SbUser | null;
      setEmail(user?.email ?? null);
      setLoading(false);
      bgSync(user);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const user = (session?.user ?? null) as unknown as SbUser | null;
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

  const hideOnLogin = pathname?.startsWith('/login');
  if (hideOnLogin) return null;

  // 마운트 전 스켈레톤 (Hydration 불일치 차단)
  if (!mounted) {
    return (
      <div className="sticky top-0 z-10 w-full border-b bg-white">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between px-4 py-2">
          <div className="text-sm font-semibold">집수리 관리</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-600">확인 중…</span>
            <div className="h-7 w-16 rounded border border-gray-200 bg-gray-50" />
          </div>
        </div>
      </div>
    );
  }

  // 마운트 후 실제 UI
  return (
    <div className="sticky top-0 z-10 w-full border-b bg-white">
      <div className="mx-auto flex max-w-screen-xl items-center justify-between px-4 py-2">
        <div className="text-sm font-semibold">집수리 관리</div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">
            {loading ? '확인 중…' : (email ?? '비로그인')}
          </span>
          {email ? (
            <button
              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
              onClick={onLogout}
            >
              로그아웃
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
