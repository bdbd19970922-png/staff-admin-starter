// FILE: /app/debug/clear-auth/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function Page() {
  const router = useRouter()

  const nuke = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {}
    try {
      const keys = Object.keys(window.localStorage)
      keys.forEach(k => { if (k.startsWith('sb-')) localStorage.removeItem(k) })
      sessionStorage.clear()
    } catch {}
    router.replace('/login'); router.refresh()
  }

  return (
    <div className="min-h-screen grid place-items-center">
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-bold">Auth 캐시 강제 초기화</h1>
        <p className="text-gray-600 text-sm">무한 로딩 시 여기서 한 번 눌러주세요.</p>
        <button onClick={nuke} className="px-4 py-2 rounded bg-black text-white">초기화 실행</button>
      </div>
    </div>
  )
}
