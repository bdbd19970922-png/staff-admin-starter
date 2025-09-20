// FILE: app/materials/layout.tsx  (🚩새 파일)
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';

export default async function MaterialsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerComponentClient({ cookies });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/'); // 로그인 안 했으면 홈(또는 /login)으로
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !profile?.is_admin) {
    redirect('/dashboard'); // 👈 비관리자 차단
  }

  return <>{children}</>;
}
