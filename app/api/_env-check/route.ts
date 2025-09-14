// FILE: /app/api/_env-check/route.ts
import { NextResponse } from 'next/server';
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  let host = ''; try { host = new URL(url).host } catch {}
  return NextResponse.json({
    env: process.env.NODE_ENV,
    supabaseHost: host,
    anonPreview: anon ? anon.slice(0, 6) + '...' : '',
  });
}
