// FILE: /app/schedules/[id]/edit/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type ScheduleRow = {
  id: number;
  title: string;
  location: string | null;
  start_ts: string;  // ISO
  end_ts: string;    // ISO
  daily_wage: number | null;
  status: 'scheduled' | 'in_progress' | 'done' | 'cancelled';
  employee_id?: string | null;
  employee_name?: string | null;
  employee_phone?: string | null;
  created_by?: string | null; // RLS용
};

const STATUS_LABEL: Record<ScheduleRow['status'], string> = {
  scheduled: '예정',
  in_progress: '진행중',
  done: '완료',
  cancelled: '취소',
};

function isoToLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}
function localInputToIso(localValue: string) {
  if (!localValue) return new Date().toISOString();
  const d = new Date(localValue);
  const off = d.getTimezoneOffset();
  const utc = new Date(d.getTime() - off * 60_000);
  return utc.toISOString();
}

export default function ScheduleEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const idRaw = (params?.id ?? '').toString();
  const id = Number(idRaw);
  const isIdValid = Number.isFinite(id) && id > 0;

  const [row, setRow] = useState<ScheduleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!isIdValid) {
      setErr('잘못된 ID입니다.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const { data, error } = await supabase
          .from('schedules')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('일정을 찾을 수 없습니다.');
        setRow(data as ScheduleRow);
      } catch (e: any) {
        setErr(e?.message || '불러오기 오류');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isIdValid]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!row || !isIdValid) return;
    try {
      setSaving(true);
      setErr(null);

      const payload = {
        title: String(row.title ?? '').trim(),
        location: row.location ? String(row.location).trim() : null,
        start_ts: localInputToIso(isoToLocalInput(row.start_ts)),
        end_ts: localInputToIso(isoToLocalInput(row.end_ts)),
        daily_wage: Number.isFinite(Number(row.daily_wage)) ? Number(row.daily_wage) : 0,
        status: row.status,
      };

      const { error } = await supabase
        .from('schedules')
        .update(payload)
        .eq('id', id);

      if (error) throw error;
      router.push('/schedules');
    } catch (e: any) {
      setErr(e?.message || '저장 중 오류');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!isIdValid) return;
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      setRemoving(true);
      const { error } = await supabase
        .from('schedules')
        .delete()
        .eq('id', id);
      if (error) throw error;
      router.push('/schedules');
    } catch (e: any) {
      alert(e?.message || '삭제 중 오류');
      setRemoving(false);
    }
  }

  /* ------- 화면 ------- */
  if (loading) {
    return (
      <div className="card">
        <div className="h-5 w-36 bg-slate-200 animate-pulse rounded mb-4" />
        <div className="h-10 bg-slate-100 animate-pulse rounded" />
      </div>
    );
  }
  if (err) return <div className="card border-rose-200 bg-rose-50 text-rose-700">{err}</div>;
  if (!row) return <div className="card">데이터 없음</div>;

  return (
    <div className="space-y-6">
      {/* 헤더: 파스텔 블루 톤 */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-sky-700 via-sky-600 to-indigo-600 bg-clip-text text-transparent">
              일정 수정
            </span>{' '}
            <span className="text-slate-600">#{row.id}</span>
          </h1>
          <p className="text-slate-600 text-sm mt-1">
            시작/종료 시간, 상태, 일당을 수정한 뒤 저장하세요.
          </p>
        </div>
        <button onClick={() => router.back()} className="btn">뒤로</button>
      </div>

      {/* 정보 배너 (은은한 파랑) */}
      <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-sky-50/50 px-4 py-3 text-sm text-sky-900">
        담당자: <b>{row.employee_name || '미지정'}</b>
        {row.employee_phone ? <span className="opacity-80"> · {row.employee_phone}</span> : null}
      </div>

      {/* 폼 카드 */}
      <form className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white p-6 shadow-[0_6px_16px_rgba(2,132,199,0.08)] max-w-3xl" onSubmit={onSave}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm text-slate-600">제목</label>
            <input
              className="input"
              value={row.title ?? ''}
              onChange={(e)=>setRow({ ...(row as ScheduleRow), title: e.target.value })}
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm text-slate-600">장소</label>
            <input
              className="input"
              value={row.location ?? ''}
              onChange={(e)=>setRow({ ...(row as ScheduleRow), location: e.target.value || null })}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-600">시작</label>
            <input
              type="datetime-local"
              className="input"
              value={isoToLocalInput(row.start_ts)}
              onChange={(e)=>setRow({ ...(row as ScheduleRow), start_ts: localInputToIso(e.target.value) })}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-600">종료</label>
            <input
              type="datetime-local"
              className="input"
              value={isoToLocalInput(row.end_ts)}
              onChange={(e)=>setRow({ ...(row as ScheduleRow), end_ts: localInputToIso(e.target.value) })}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-600">일당(₩)</label>
            <input
              type="number"
              className="input"
              value={Number(row.daily_wage ?? 0)}
              onChange={(e)=>setRow({ ...(row as ScheduleRow), daily_wage: Number(e.target.value) })}
              min={0}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-600">상태</label>
            <select
              className="select"
              value={row.status}
              onChange={(e)=>setRow({ ...(row as ScheduleRow), status: e.target.value as ScheduleRow['status'] })}
            >
              <option value="scheduled">{STATUS_LABEL.scheduled}</option>
              <option value="in_progress">{STATUS_LABEL.in_progress}</option>
              <option value="done">{STATUS_LABEL.done}</option>
              <option value="cancelled">{STATUS_LABEL.cancelled}</option>
            </select>
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {err}
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={saving} className="btn-primary px-5">
            {saving ? '저장 중…' : '저장'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={removing}
            className="btn border-rose-200 text-rose-700 hover:bg-rose-50"
          >
            {removing ? '삭제 중…' : '삭제'}
          </button>
        </div>
      </form>
    </div>
  );
}
