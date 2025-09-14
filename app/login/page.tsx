// FILE: /app/login/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';

/**
 * 변경 포인트 (UI/기능 유지)
 * - 로그인 성공 이벤트(onAuthStateChange)에서 즉시 라우팅 → 쿠키/세션 동기화 대기로 인한 체감 렉 제거
 * - 800ms 소프트캡: 혹시 이벤트 지연/누락돼도 0.8초 내 강제 이동 → "무조건 오래 로딩" 현상 차단
 */

export default function Page() {
  const router = useRouter();

  // next 파라미터 (/login?next=/dashboard)
  const [nextUrl, setNextUrl] = useState('/dashboard');
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const n = sp.get('next');
      setNextUrl(n ? decodeURIComponent(n) : '/dashboard');
    } catch {
      setNextUrl('/dashboard');
    }
  }, []);

  const [globalMsg, setGlobalMsg] = useState<string | null>(null);

  // 로그인 상태
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);

  // ✅ onAuthStateChange로 "즉시 라우팅" (쿠키 동기화 기다리지 않음)
  //    + 800ms 소프트캡 타이머
  const capRef = useRef<number | null>(null);
  const redirectedRef = useRef(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user && !redirectedRef.current) {
        redirectedRef.current = true;
        if (capRef.current) window.clearTimeout(capRef.current);
        router.replace(nextUrl);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, nextUrl]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginLoading) return;
    setLoginMsg(null);
    setGlobalMsg(null);
    setLoginLoading(true);

    // ⏱️ 800ms 소프트캡: 이벤트가 약간 늦어도 체감 렉 차단
    if (capRef.current) window.clearTimeout(capRef.current);
    capRef.current = window.setTimeout(() => {
      if (!redirectedRef.current) {
        redirectedRef.current = true;
        router.replace(nextUrl);
      }
    }, 800);

    try {
      const email = loginEmail.trim();
      const { error } = await supabase.auth.signInWithPassword({ email, password: loginPw });
      if (error) throw error;
      // 실제 이동은 onAuthStateChange에서 처리 (위 타이머는 안전망)
    } catch (err: any) {
      setLoginMsg(err?.message || '로그인 실패');
      setLoginLoading(false);
      if (capRef.current) window.clearTimeout(capRef.current);
    }
  };

  // 회원가입 상태 (그대로 유지)
  const [openSignup, setOpenSignup] = useState(false);
  const [suEmail, setSuEmail] = useState('');
  const [suPw, setSuPw] = useState('');
  const [suPw2, setSuPw2] = useState('');
  const [suName, setSuName] = useState('');
  const [suPhone, setSuPhone] = useState('');
  const [suLoading, setSuLoading] = useState(false);
  const [suMsg, setSuMsg] = useState<string | null>(null);

  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const onSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (suLoading) return;

    setSuMsg(null);
    setGlobalMsg(null);

    const email = suEmail.trim();
    const full_name = suName.trim();
    const phone = suPhone.trim();

    if (!email || !isEmail(email)) { setSuMsg('유효한 이메일을 입력하세요.'); return; }
    if (!suPw || !suPw2 || !full_name || !phone) { setSuMsg('모든 항목을 입력하세요.'); return; }
    if (suPw !== suPw2) { setSuMsg('비밀번호가 일치하지 않습니다.'); return; }
    if (suPw.length < 6) { setSuMsg('비밀번호는 6자 이상이어야 합니다.'); return; }

    setSuLoading(true);
    try {
      // 회원 생성 + 메타데이터
      const { data: suData, error: suErr } = await supabase.auth.signUp({
        email,
        password: suPw,
        options: { data: { full_name, phone } },
      });
      if (suErr) throw suErr;

      // 프로필 upsert (있으면 갱신)
      try {
        const { data: me } = await supabase.auth.getUser();
        const uid = me?.user?.id ?? suData.user?.id;
        if (uid) {
          await supabase.from('profiles').upsert({ id: uid, full_name, phone }, { onConflict: 'id' });
        }
      } catch (e) {
        console.warn('profiles upsert skipped:', e);
      }

      // 자동 로그인 실패해도 onAuthStateChange/소프트캡이 처리
      if (!suData.session) {
        await supabase.auth.signInWithPassword({ email, password: suPw }).catch(() => {});
      }

      // 이동은 onAuthStateChange/소프트캡에 맡김
    } catch (err: any) {
      setSuMsg(err?.message || '회원가입 실패');
      setSuLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <main className="app-container w-full">
        <div className="mx-auto w-full max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 로그인 카드 */}
          <section className="card">
            <h1 className="text-xl font-bold mb-4">로그인</h1>
            <form onSubmit={onLogin} className="space-y-3">
              <div>
                <label htmlFor="login-email" className="block text-sm mb-1">이메일</label>
                <input
                  id="login-email"
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label htmlFor="login-password" className="block text-sm mb-1">비밀번호</label>
                <input
                  id="login-password"
                  type="password"
                  className="input"
                  placeholder="••••••••"
                  value={loginPw}
                  onChange={(e) => setLoginPw(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {loginMsg && <div className="text-sm text-red-600" role="alert">{loginMsg}</div>}
              {globalMsg && <div className="text-sm">{globalMsg}</div>}
              <button
                type="submit"
                disabled={loginLoading}
                className={`btn-primary w-full ${loginLoading ? 'opacity-60 cursor-wait' : ''}`}
              >
                {loginLoading ? '로그인 중…' : '로그인'}
              </button>
              <div className="mt-3 text-center">
                <button
                  type="button"
                  className="text-xs text-gray-600 underline"
                  onClick={() => setOpenSignup(v => !v)}
                >
                  {openSignup ? '회원가입 닫기' : '회원가입 열기'}
                </button>
              </div>
            </form>
          </section>

          {/* 회원가입 카드 */}
          <section className={`card transition ${openSignup ? '' : 'opacity-0 pointer-events-none'}`}>
            <h2 className="text-lg font-semibold mb-4">회원가입</h2>
            <form onSubmit={onSignup} className="space-y-3" aria-disabled={!openSignup}>
              <div>
                <label htmlFor="su-email" className="block text-sm mb-1">이메일(아이디)</label>
                <input
                  id="su-email"
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={suEmail}
                  onChange={(e) => setSuEmail(e.target.value)}
                  autoComplete="email"
                  required
                  disabled={!openSignup}
                />
              </div>
              <div>
                <label htmlFor="su-pw" className="block text-sm mb-1">비밀번호</label>
                <input
                  id="su-pw"
                  type="password"
                  className="input"
                  placeholder="••••••••"
                  value={suPw}
                  onChange={(e) => setSuPw(e.target.value)}
                  autoComplete="new-password"
                  required
                  disabled={!openSignup}
                />
              </div>
              <div>
                <label htmlFor="su-pw2" className="block text-sm mb-1">비밀번호 확인</label>
                <input
                  id="su-pw2"
                  type="password"
                  className="input"
                  placeholder="••••••••"
                  value={suPw2}
                  onChange={(e) => setSuPw2(e.target.value)}
                  autoComplete="new-password"
                  required
                  disabled={!openSignup}
                />
              </div>
              <div>
                <label htmlFor="su-name" className="block text-sm mb-1">이름</label>
                <input
                  id="su-name"
                  type="text"
                  className="input"
                  placeholder="홍길동"
                  value={suName}
                  onChange={(e) => setSuName(e.target.value)}
                  required
                  disabled={!openSignup}
                />
              </div>
              <div>
                <label htmlFor="su-phone" className="block text-sm mb-1">번호</label>
                <input
                  id="su-phone"
                  type="tel"
                  className="input"
                  placeholder="010-0000-0000"
                  value={suPhone}
                  onChange={(e) => setSuPhone(e.target.value)}
                  required
                  disabled={!openSignup}
                />
              </div>
              {suMsg && <div className="text-sm text-red-600" role="alert">{suMsg}</div>}
              <button
                type="submit"
                disabled={suLoading || !openSignup}
                className={`btn-primary w-full ${suLoading || !openSignup ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {suLoading ? '처리 중…' : '가입하기'}
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
