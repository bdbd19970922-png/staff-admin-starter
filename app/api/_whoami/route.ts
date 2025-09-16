// FILE: /app/api/_whoami/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const token = (await cookies()).get('sb-access-token')?.value

  // ✅ apikey + Authorization 헤더 같이 설정
  const supabase = createClient(url, anon, {
    global: {
      headers: {
        apikey: anon, // ← 반드시 포함
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  })

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) {
    return NextResponse.json({ user: null, error: error.message }, { status: 401 })
  }

  return NextResponse.json({ user }) // 로그인 안 돼 있으면 user: null
}
