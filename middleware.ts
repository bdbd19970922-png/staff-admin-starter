// FILE: /middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * ✅ 최소 동작 보장 + 추가 안전장치
 * - SSR에서 인증/리다이렉트 절대 안 함(클라이언트에서만 처리)
 * - 정적/이미지/API/인증콜백 등은 완전 제외
 * - 프리플라이트/HEAD 요청 빠른 통과
 * - 로딩/리다이렉트 캐싱 방지를 위해 no-store 헤더 부착
 */

export function middleware(req: NextRequest) {
  // 1) 프리플라이트/HEAD는 즉시 통과
  if (req.method === 'OPTIONS' || req.method === 'HEAD') {
    return NextResponse.next();
  }

  // 2) 기본은 전부 통과 + no-store (이전 상태 캐시로 인한 되감기 방지)
  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

// ✅ 정적 리소스, API, 인증 콜백 등 완전 제외
export const config = {
  matcher: [
    // 모든 경로 중에서 아래 항목들은 제외(실행 안 함)
    // _next, 정적파일, 이미지류, 파비콘, 로봇/사이트맵, API, Vercel 내부, Supabase 콜백
    '/((?!_next/static|_next/image|favicon.ico|favicon.png|robots.txt|sitemap.xml|api|_vercel|auth/callback|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)).*)',
  ],
};

/* ------------------------------------------------------
 * 참고: 서버 사이드 보호 로직(나중에 복원하고 싶을 때)
 *  - @supabase/auth-helpers-nextjs와 SSR 세션 쿠키 구성이
 *    완전히 안정화된 후 단계적으로 사용하세요.
 *
 * import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
 *
 * export async function middleware(req: NextRequest) {
 *   const res = NextResponse.next();
 *   const supabase = createMiddlewareClient({ req, res });
 *   const { data: { session } } = await supabase.auth.getSession();
 *
 *   const protectedPaths = ['/dashboard','/schedules','/materials','/expenses','/payrolls','/reports'];
 *   const isProtected = protectedPaths.some(p => req.nextUrl.pathname.startsWith(p));
 *
 *   if (isProtected && !session) {
 *     const url = req.nextUrl.clone();
 *     url.pathname = '/login';
 *     url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
 *     return NextResponse.redirect(url);
 *   }
 *
 *   if (req.nextUrl.pathname === '/login' && session) {
 *     const url = req.nextUrl.clone();
 *     url.pathname = '/dashboard';
 *     return NextResponse.redirect(url);
 *   }
 *
 *   return res;
 * }
 * ------------------------------------------------------ */
