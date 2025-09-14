// FILE: /hooks/useAuthGate.ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type AuthState = 'checking' | 'authed' | 'guest' | 'timeout'

export function useAuthGate() {
  const [state, setState] = useState<AuthState>('checking')
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    // 1) 최초 세션 확인
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      setState(data.session ? 'authed' : 'guest')
    })()

    // 2) 세션 변화 구독
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? 'authed' : 'guest')
    })

    // 3) 하드 타임아웃 (1.5초) — checking이 길어지면 강제 탈출
    timeoutRef.current = window.setTimeout(() => {
      setState(prev => (prev === 'checking' ? 'timeout' : prev))
    }, 1500)

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  const isReady = state === 'authed' || state === 'guest'
  return { state, isReady }
}
