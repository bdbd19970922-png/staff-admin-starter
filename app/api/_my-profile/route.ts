// FILE: /app/api/_my-profile/route.ts
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
  if (!user) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,email,is_admin,is_manager,name')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({ userId: user.id, profile: data, error });
}
