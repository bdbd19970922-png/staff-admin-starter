// FILE: app/materials/layout.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';

function parseCsv(v?: string) {
  return (v ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * ✅ SSR 게이트 (관대한 판정)
 * - '직원'이 **명백히** 확정될 때만 대시보드로 리다이렉트
 * - 그 외(세션없음/프로필조회불가/ENV매칭됨)는 통과시켜 클라이언트 게이트에서 최종 판정
 */
export default async function MaterialsLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerComponentClient({ cookies });

  // 1) 유저 조회 (없으면 SSR에서 막지 않음 — 클라 게이트가 처리)
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) {
    // 세션 읽기 실패 → 막지 않음
    return <>{children}</>;
  }
  if (!user) {
    // 비로그인 → 여기서도 막지 않음(클라에서 로그인 유도/리다이렉트)
    return <>{children}</>;
  }

  // 2) 환경변수 화이트리스트(백업 경로)
  const email = (user.email ?? '').toLowerCase();
  const adminIds = parseCsv(process.env.NEXT_PUBLIC_ADMIN_IDS);
  const adminEmails = parseCsv(process.env.NEXT_PUBLIC_ADMIN_EMAILS).map(s => s.toLowerCase());

  const envAllow =
    (user.id && adminIds.includes(user.id)) ||
    (email && adminEmails.includes(email));

  if (envAllow) {
    // ENV로 관리자 확정 → 통과
    return <>{children}</>;
  }

  // 3) DB 프로필로 정식 판정(실패하면 막지 않음)
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('is_admin, is_manager')
    .eq('id', user.id)
    .maybeSingle();

  if (profErr) {
    // RLS/조회 문제 등 → 막지 않음(클라에서 재확인)
    return <>{children}</>;
  }

  const isAdmin = !!profile?.is_admin;
  const isManager = !!profile?.is_manager;

  // 4) 여기까지 왔고, 관리자/매니저가 아니면 = '직원' 확정 → 리다이렉트
  if (!(isAdmin || isManager)) {
    redirect('/dashboard'); // 필요시 존재하는 경로로 변경
  }

  // 관리자/매니저 → 통과
  return <>{children}</>;
}
