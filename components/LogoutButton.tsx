'use client';
import { supabase } from '@/lib/supabaseClient';

export default function LogoutButton() {
  const onLogout = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      // 세션 쿠키 동기화 기다리면 SSR에서 깔끔
      setTimeout(() => { window.location.href = '/login'; }, 50);
    }
  };
  return (
    <button onClick={onLogout} className="rounded-md border px-3 py-2 text-sm">
      로그아웃
    </button>
  );
}
