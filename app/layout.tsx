// FILE: /app/layout.tsx
import './globals.css';
import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Nunito, Noto_Sans_KR } from 'next/font/google';
import ErrorBoundary from './_error-boundary'; // 에러 추적용

export const metadata = {
  title: '집수리직원관리',
  description: '내부 직원/자재 관리',
  icons: { icon: '/favicon.ico' },
};

// 라틴: Nunito, 한글: Noto Sans KR
const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
});

const notoSansKR = Noto_Sans_KR({
  // 프로젝트 설정에 맞춰 'latin' 유지 (필요 시 'korean'으로 변경 가능)
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-kor',
  display: 'swap',
});

// ✅ AppShell을 CSR로만 렌더(SSR 끔) — Hydration 불일치 차단
const AppShellNoSSR = dynamic(() => import('@/components/AppShell'), {
  ssr: false,
  // 서버/클라 첫 마크업을 동일하게 유지하기 위한 고정 스켈레톤
  loading: () => (
    <div className="min-h-screen w-full flex">
      <aside className="w-[220px] shrink-0 border-r bg-white">
        <div className="h-12 border-b" />
      </aside>
      <div className="flex-1 min-w-0">
        <div className="h-12 border-b" />
      </div>
    </div>
  ),
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${nunito.variable} ${notoSansKR.variable}`}>
        <ErrorBoundary>
          {/* 기존 AppShell 그대로, 단 CSR 전용으로 동작 */}
          <AppShellNoSSR>{children}</AppShellNoSSR>
        </ErrorBoundary>
      </body>
    </html>
  );
}
