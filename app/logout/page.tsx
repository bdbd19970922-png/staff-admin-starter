// FILE: /app/logout/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

// ✅ 정적 프리렌더만 강제 해제 (revalidate 줄은 아예 없음)
export const dynamic = 'force-dynamic';

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        await supabase.auth.signOut();
      } finally {
        router.replace('/login');
      }
    })();
  }, [router]);

  return <div className="card text-sm">로그아웃 중…</div>;
}
