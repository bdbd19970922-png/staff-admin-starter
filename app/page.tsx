// FILE: /app/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// ✅ 완전 정적으로 그려서 첫 화면이 즉시 뜨게 함 (배포에서도 동일)
export const dynamic = 'force-static';

export default function Page() {
  const router = useRouter();

  useEffect(() => {
    // 첫 페인트 후 부드럽게 로그인으로 교체 이동 (뒤로가기 기록 어지럽히지 않음)
    router.replace('/login');
  }, [router]);

  // ⛳ JS 느린 환경/저사양에서도 바로 보일 초경량 화면
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">집수리 직원관리</h1>
      <p className="mt-2">잠시만요… 로그인 화면으로 이동합니다.</p>

      {/* 수동 이동 버튼(즉시 클릭 가능) */}
      <div className="mt-4">
        <a href="/login" className="underline">바로 이동</a>
      </div>

      {/* JS 비활성 브라우저 대비 */}
      <noscript>
        <p className="mt-2">
          자바스크립트가 꺼져 있어 자동 이동이 되지 않습니다. <a href="/login">여기를 눌러 이동</a>
        </p>
      </noscript>
    </main>
  );
}
