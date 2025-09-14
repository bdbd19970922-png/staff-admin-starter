export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { serverClient } from '@/lib/supabaseServer';

export default async function ExpensesPage() {
  const supabase = serverClient();
  const { data } = await (await supabase)
    .from('expenses')
    .select('id,category,spent_at,amount,memo')
    .order('spent_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">경비</h1>
      <table className="w-full rounded-xl border bg-white text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">일자</th><th className="p-2">카테고리</th><th className="p-2">메모</th><th className="p-2">금액</th>
          </tr>
        </thead>
        <tbody>
          {(data||[]).map((r:any)=>(
            <tr key={r.id} className="border-b last:border-0">
              <td className="p-2">{new Date(r.spent_at).toLocaleDateString()}</td>
              <td className="p-2">{r.category}</td>
              <td className="p-2">{r.memo}</td>
              <td className="p-2">₩{Number(r.amount||0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
