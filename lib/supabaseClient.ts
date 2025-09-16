// FILE: /lib/supabaseClient.ts
'use client';

import { createClient } from '@supabase/supabase-js';

/**
 * 환경변수 값에 섞일 수 있는 개행/공백 제거
 * (fetch "Invalid value" 에러 예방)
 */
const clean = (v?: string) => (v ?? '').replace(/\r?\n/g, '').trim();

const SUPABASE_URL = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const SUPABASE_ANON_KEY = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// 런타임 로그 (앱 죽이지 않고 콘솔에만 표시)
if (!SUPABASE_URL) console.error('[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL');
if (!SUPABASE_ANON_KEY) console.error('[Supabase] Missing NEXT_PUBLIC_SUPABASE_ANON_KEY');
try {
  if (SUPABASE_URL) new URL(SUPABASE_URL);
} catch (e) {
  console.error('[Supabase] Invalid URL in NEXT_PUBLIC_SUPABASE_URL:', SUPABASE_URL, e);
}

/**
 * ✅ supabase 클라이언트 (export const supabase 그대로 유지)
 * - persistSession: 세션 유지 (localStorage)
 * - autoRefreshToken: 토큰 자동 갱신
 * - detectSessionInUrl: 로그인 리디렉션 처리
 * - storage: 브라우저에서만 localStorage 사용
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce', // 브라우저 권장 플로우
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});
// 임시 디버그: 어떤 테이블을 from() 했는지 콘솔에 찍기
if (typeof window !== 'undefined') {
  const _from = (supabase as any).from.bind(supabase);
  (supabase as any).from = (table: string) => {
    console.warn('[DBG] supabase.from →', table);
    return _from(table);
  };
}
