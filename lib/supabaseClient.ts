// FILE: /lib/supabaseClient.ts
'use client';

import { createClient } from '@supabase/supabase-js';

/** 환경변수 문자열 정리 (개행/공백 제거) */
const clean = (v?: string) => (v ?? '').replace(/\r?\n/g, '').trim();

const SUPABASE_URL = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const SUPABASE_ANON_KEY = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// 런타임 경고 (앱 중단 X)
if (!SUPABASE_URL) console.error('[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL');
if (!SUPABASE_ANON_KEY) console.error('[Supabase] Missing NEXT_PUBLIC_SUPABASE_ANON_KEY');
try {
  if (SUPABASE_URL) new URL(SUPABASE_URL);
} catch (e) {
  console.error('[Supabase] Invalid URL in NEXT_PUBLIC_SUPABASE_URL:', SUPABASE_URL, e);
}

/**
 * ✅ Supabase 클라이언트
 * - apikey/Authorization 헤더를 "항상" 포함 → No API key 에러 방지
 * - 로그인 후에는 supabase-js가 사용자 JWT로 Authorization 자동 교체
 * - 세션 유지/자동갱신/PKCE 플로우 그대로 유지
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  global: {
    headers: {
      // 👇 PostgREST가 요구하는 apikey 명시
      apikey: SUPABASE_ANON_KEY,
      // 👇 초기엔 anon 키, 로그인 후엔 사용자 JWT로 자동 대체됨
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  },
});

// (선택) 디버그: from() 호출 테이블 로깅 — 기존 기능 유지
if (typeof window !== 'undefined') {
  const _from = (supabase as any).from.bind(supabase);
  (supabase as any).from = (table: string) => {
    console.warn('[DBG] supabase.from →', table);
    return _from(table);
  };
}
