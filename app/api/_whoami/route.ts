// FILE: /app/api/_whoami/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = (await cookies()).get('sb-access-token')?.value;

  const supabase = createClient(url, anon, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });

  const { data: { user } } = await supabase.auth.getUser();
  return NextResponse.json({ user }); // 로그인 안 돼 있으면 user: null
}
