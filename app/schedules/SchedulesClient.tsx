// C:\Users\user\Desktop\staff-admin-starter\app\schedules\SchedulesClient.tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SchedulesClient({ rows }: { rows: any[] }) {
  const r = useRouter();

  async function onDelete(id: number) {
    if (!confirm('정말 삭제할까요?')) return;
    const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || '삭제 실패');
      return;
    }
    r.refresh();
  }

  return (
    <>
      <div className="mb-3">
        <Link
          href="/schedules/new"
          className="inline-block rounded-md border bg-black px-3 py-2 text-sm font-semibold text-white"
        >
          + 새 일정
        </Link>
      </div>

      <table className="w-full rounded-xl border bg-white text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">제목</th>
            <th className="p-2">장소</th>
            <th className="p-2">시작</th>
            <th className="p-2">종료</th>
            <th className="p-2">일당</th>
            <th className="p-2">상태</th>
            <th className="p-2 w-32">액션</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="p-2">{r.title}</td>
              <td className="p-2">{r.location}</td>
              <td className="p-2">{new Date(r.start_ts).toLocaleString()}</td>
              <td className="p-2">{new Date(r.end_ts).toLocaleString()}</td>
              <td className="p-2">₩{Number(r.daily_wage || 0).toLocaleString()}</td>
              <td className="p-2">{r.status}</td>
              <td className="p-2">
                <div className="flex gap-2">
                  <Link
                    className="rounded-md border px-2 py-1"
                    href={`/schedules/${r.id}/edit`}
                  >
                    수정
                  </Link>
                  <button
                    className="rounded-md border px-2 py-1"
                    onClick={() => onDelete(r.id)}
                  >
                    삭제
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
