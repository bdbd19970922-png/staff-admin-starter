// C:\Users\user\Desktop\staff-admin-starter\app\api\schedules\route.ts
import { NextResponse } from 'next/server';
import { routeClient } from '@/lib/supabaseServer';

async function ensureAdmin(supabase: ReturnType<typeof routeClient>) {
  const { data: { session } } = await (await supabase).auth.getSession();
  if (!session) return { ok: false, status: 401 };
  const { data: prof } = await (await supabase)
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .maybeSingle();
  if (!prof || prof.role !== 'admin') return { ok: false, status: 403 };
  return { ok: true, status: 200 };
}

export async function POST(req: Request) {
  const supabase = routeClient();
  const admin = await ensureAdmin(supabase);
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: admin.status });

  const body = await req.json();
  const payload = {
    title: String(body.title || ''),
    location: String(body.location || ''),
    start_ts: new Date(body.start_ts).toISOString(),
    end_ts: new Date(body.end_ts).toISOString(),
    daily_wage: Number(body.daily_wage || 0),
    status: String(body.status || 'scheduled'),
  };

  const { error } = await (await supabase).from('schedules').insert(payload);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
