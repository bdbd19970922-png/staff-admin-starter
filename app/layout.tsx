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
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-kor',
  display: 'swap',
});

// ✅ AppShell을 CSR로만 렌더(SSR 끔) — Hydration 불일치 차단
const AppShellNoSSR = dynamic(() => import('@/components/AppShell'), {
  ssr: false,
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

// ✅ React Query Provider도 클라이언트에서만 감싸기
const RQProviderNoSSR = dynamic(() => import('./_rq-provider'), { ssr: false });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 📱 모바일 뷰포트 필수 */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>

      {/* 본문 색상/배경은 globals.css 기준 유지 */}
      <body className={`${nunito.variable} ${notoSansKR.variable} antialiased`}>
        <ErrorBoundary>
          {/* 
            📱 모바일 전용 파스텔톤 전역 배경 래퍼
            - <sm: 파스텔 그라데이션 배경
            - ≥sm: 배경을 흰색으로 고정(기존 데스크탑 UI와 충돌 없음)
          */}
          <div
            id="__mobilePastel"
            className="
              min-h-screen
              bg-[radial-gradient(900px_500px_at_10%_-10%,rgba(56,189,248,0.18),transparent),
                  radial-gradient(800px_400px_at_90%_-5%,rgba(99,102,241,0.12),transparent),
                  linear-gradient(to_bottom,rgba(248,250,252,1),rgba(240,249,255,1))]
              sm:bg-white
            "
          >
            {/* ✅ React Query Provider로 감싼 뒤 AppShell 렌더 */}
            <RQProviderNoSSR>
              <AppShellNoSSR>{children}</AppShellNoSSR>
            </RQProviderNoSSR>
          </div>
        </ErrorBoundary>
      </body>
    </html>
  );
}
