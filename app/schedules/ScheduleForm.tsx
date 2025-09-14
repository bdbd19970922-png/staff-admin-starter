// C:\Users\user\Desktop\staff-admin-starter\app\schedules\ScheduleForm.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type FormMode = 'create' | 'edit';
type Schedule = {
  id?: number;
  title: string;
  location: string;
  start_ts: string;
  end_ts: string;
  daily_wage: number;
  status: string;
};

export default function ScheduleForm({
  mode,
  initial,
}: {
  mode: FormMode;
  initial?: Schedule;
}) {
  const r = useRouter();
  const [f, setF] = useState<Schedule>({
    title: initial?.title || '',
    location: initial?.location || '',
    start_ts: initial?.start_ts ? toLocal(initial.start_ts) : '',
    end_ts: initial?.end_ts ? toLocal(initial.end_ts) : '',
    daily_wage: initial?.daily_wage || 0,
    status: initial?.status || 'scheduled',
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toLocal(iso: string) {
    // ISO → <input type="datetime-local"> 값으로
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const MM = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
  }

  async function onSubmit() {
    setMsg(null);
    setLoading(true);
    try {
      const payload = {
        title: f.title.trim(),
        location: f.location.trim(),
        start_ts: new Date(f.start_ts).toISOString(),
        end_ts: new Date(f.end_ts).toISOString(),
        daily_wage: Number(f.daily_wage),
        status: f.status,
      };
      const res = await fetch(
        mode === 'create'
          ? '/api/schedules'
          : `/api/schedules/${initial?.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'failed');
      r.push('/schedules');
      r.refresh();
    } catch (e: any) {
      setMsg(e.message || '에러가 발생했어요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl rounded-xl border bg-white p-4">
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="mb-1 block text-sm text-gray-600">제목</label>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder="작업 제목"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">장소</label>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={f.location}
            onChange={(e) => setF({ ...f, location: e.target.value })}
            placeholder="유성구 봉명동..."
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">시작</label>
          <input
            type="datetime-local"
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={f.start_ts}
            onChange={(e) => setF({ ...f, start_ts: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">종료</label>
          <input
            type="datetime-local"
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={f.end_ts}
            onChange={(e) => setF({ ...f, end_ts: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">일당(₩)</label>
          <input
            type="number"
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={f.daily_wage}
            onChange={(e) => setF({ ...f, daily_wage: Number(e.target.value || 0) })}
            min={0}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">상태</label>
          <select
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value })}
          >
            <option value="scheduled">scheduled</option>
            <option value="in_progress">in_progress</option>
            <option value="done">done</option>
            <option value="cancelled">cancelled</option>
          </select>
        </div>
      </div>

      {msg ? <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{msg}</div> : null}

      <div className="mt-4 flex gap-2">
        <button
          onClick={onSubmit}
          disabled={loading}
          className="rounded-md border bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? '처리 중...' : (mode === 'create' ? '등록' : '수정')}
        </button>
      </div>
    </div>
  );
}
