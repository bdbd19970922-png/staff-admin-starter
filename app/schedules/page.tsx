// FILE: /app/schedules/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import EmployeePicker, { EmployeeValue } from '@/components/EmployeePicker';

/* ====== 타입/라벨 정의 ====== */
type Row = {
  id: number;
  title: string;
  location: string;
  start_ts: string;
  end_ts: string;
  daily_wage: number;
  status: 'scheduled' | 'in_progress' | 'done' | 'cancelled';
  employee_id?: string | null;
  employee_name?: string | null;  // 직접입력 이름
  employee_phone?: string | null; // 직접입력 전화
};

const STATUS_LABEL: Record<Row['status'], string> = {
  scheduled: '예정',
  in_progress: '진행중',
  done: '완료',
  cancelled: '취소',
};

/* ===============================
   부모(래퍼): 세션 체크만 담당
   =============================== */
export default function SchedulesPage() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthed(!!data.session?.user);
      setIsReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAuthed(!!session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="space-y-4">
      {!isReady ? (
        <div className="card text-sm">로딩 중…</div>
      ) : isAuthed ? (
        <SchedulesInner />
      ) : (
        <LoggedOutScreen />
      )}
    </div>
  );
}

function LoggedOutScreen() {
  return (
    <div className="card">
      <h1 className="text-xl font-extrabold tracking-tight mb-1">로그인이 필요합니다</h1>
      <p className="text-slate-600">오른쪽 위 버튼으로 로그인해 주세요.</p>
    </div>
  );
}

/* =====================================
   자식: 스케줄 CRUD + 목록 표시
   ===================================== */
function SchedulesInner() {
  const [emp, setEmp] = useState<EmployeeValue>({ mode: 'profile', employeeId: '' });
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [f, setF] = useState({
    title: '',
    location: '',
    start_ts: '',
    end_ts: '',
    daily_wage: 0,
    status: 'scheduled' as Row['status'],
  });

  function toISO(local: string) {
    if (!local) return new Date().toISOString();
    return new Date(local).toISOString();
  }

  async function loadRows() {
    setLoading(true);
    setMsg(null);

    try {
      // 현재 로그인한 사용자
      const { data: { user } } = await supabase.auth.getUser();

      // 기본 쿼리
      let query = supabase
        .from('schedules')
        .select('id,title,location,start_ts,end_ts,daily_wage,status,employee_id,employee_name,employee_phone')
        .order('start_ts', { ascending: false })
        .limit(100);

      if (user) {
        // 관리자 여부 체크
        const { data: prof } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .maybeSingle();

        const isAdmin = Boolean(prof?.is_admin);
        if (!isAdmin) {
          // 일반 직원이면 본인 employee_id만 조회
          query = query.eq('employee_id', user.id);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      setRows((data as Row[]) ?? []);
    } catch (e: any) {
      setMsg(e?.message || '데이터 로딩 중 오류가 발생했습니다.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
  }, []);

  async function onCreate() {
    setMsg(null);

    try {
      const payload: any = {
        title: f.title.trim(),
        location: f.location.trim(),
        start_ts: toISO(f.start_ts),
        end_ts: toISO(f.end_ts),
        daily_wage: Number(f.daily_wage || 0),
        status: f.status,
        employee_id: null,
        employee_name: null,
        employee_phone: null,
      };

      if (emp.mode === 'profile') {
        if (!emp.employeeId) {
          setMsg('직원을 선택해주세요.');
          return;
        }
        const { data: prof, error: pErr } = await supabase
          .from('profiles')
          .select('name, phone')
          .eq('id', emp.employeeId)
          .maybeSingle();
        if (pErr) throw pErr;

        payload.employee_id = emp.employeeId;
        payload.employee_name = prof?.name ?? null;
        payload.employee_phone = prof?.phone ?? null;
      } else {
        if (!emp.name) {
          setMsg('직접입력: 이름을 입력해주세요.');
          return;
        }
        payload.employee_name = emp.name.trim();
        payload.employee_phone = emp.phone?.trim() || null;
      }

      const { error } = await supabase.from('schedules').insert(payload);
      if (error) throw error;

      setFormOpen(false);
      setF({ title: '', location: '', start_ts: '', end_ts: '', daily_wage: 0, status: 'scheduled' });
      setEmp({ mode: 'profile', employeeId: '' });
      await loadRows();
    } catch (e: any) {
      setMsg(e?.message || '등록 중 오류가 발생했습니다.');
    }
  }

  async function onDelete(id: number) {
    if (!confirm('정말 삭제할까요?')) return;
    const { error } = await supabase.from('schedules').delete().eq('id', id);
    if (error) {
      setMsg(error.message);
      return;
    }
    loadRows();
  }

  const totalWage = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.daily_wage) || 0), 0),
    [rows]
  );

  const fmtLocal = (v?: string) => (v ? new Date(v).toLocaleString() : '-');

  return (
    <div className="space-y-6">
      {/* 타이틀 */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">스케줄</h1>
          <p className="text-slate-600 text-sm mt-1">작업 일정을 생성하고 상태를 관리하세요.</p>
        </div>

        {/* 상단 액션 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="btn-primary"
          >
            {formOpen ? '등록 폼 닫기' : '+ 새 일정'}
          </button>
        </div>
      </div>

      {/* 인라인 등록 폼 */}
      {formOpen && (
        <section className="card max-w-3xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-slate-600">제목</label>
              <input
                className="input"
                value={f.title}
                onChange={(e) => setF({ ...f, title: e.target.value })}
                placeholder="작업 제목"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-slate-600">장소</label>
              <input
                className="input"
                value={f.location}
                onChange={(e) => setF({ ...f, location: e.target.value })}
                placeholder="유성구 봉명동..."
              />
            </div>

            {/* 직원 선택/직접입력 */}
            <div className="md:col-span-2">
              <EmployeePicker label="담당 직원" value={emp} onChange={setEmp} />
            </div>

            <div>
              <label className="mb-1 block text-sm text-slate-600">시작</label>
              <input
                type="datetime-local"
                className="input"
                value={f.start_ts}
                onChange={(e) => setF({ ...f, start_ts: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-slate-600">종료</label>
              <input
                type="datetime-local"
                className="input"
                value={f.end_ts}
                onChange={(e) => setF({ ...f, end_ts: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-slate-600">일당(₩)</label>
              <input
                type="number"
                className="input"
                value={f.daily_wage}
                onChange={(e) => setF({ ...f, daily_wage: Number(e.target.value || 0) })}
                min={0}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-slate-600">상태</label>
              <select
                className="select"
                value={f.status}
                onChange={(e) => setF({ ...f, status: e.target.value as Row['status'] })}
              >
                <option value="scheduled">{STATUS_LABEL.scheduled} (예정)</option>
                <option value="in_progress">{STATUS_LABEL.in_progress} (작업 중)</option>
                <option value="done">{STATUS_LABEL.done} (완료)</option>
                <option value="cancelled">{STATUS_LABEL.cancelled} (취소)</option>
              </select>
            </div>
          </div>

          {msg ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {msg}
            </div>
          ) : null}

          <div className="mt-5 flex gap-2">
            <button onClick={onCreate} className="btn-primary px-5">
              등록
            </button>
            <button onClick={() => setFormOpen(false)} className="btn">
              취소
            </button>
          </div>
        </section>
      )}

      {/* 메시지 (폼 닫힌 상태) */}
      {msg && !formOpen ? (
        <div className="card border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {msg}
        </div>
      ) : null}

      {/* 목록 */}
      <section className="card">
        {loading ? (
          <div className="text-sm text-slate-600">불러오는 중…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[220px]" />
                <col className="w-[220px]" />
                <col className="w-[240px]" />
                <col className="w-[170px]" />
                <col className="w-[170px]" />
                <col className="w-[140px]" />
                <col className="w-[120px]" />
                <col className="w-[140px]" />
              </colgroup>
              <thead>
                <tr className="border-b bg-sky-50/50">
                  <th className="p-2 text-left">제목</th>
                  <th className="p-2 text-left">장소</th>
                  <th className="p-2 text-left">담당</th>
                  <th className="p-2 text-left">시작</th>
                  <th className="p-2 text-left">종료</th>
                  <th className="p-2 text-right">일당</th>
                  <th className="p-2 text-left">상태</th>
                  <th className="p-2 text-left">액션</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2 truncate">{r.title}</td>
                    <td className="p-2 truncate">{r.location}</td>
                    <td className="p-2">
                      {r.employee_name
                        ? `${r.employee_name}${r.employee_phone ? ` (${r.employee_phone})` : ''}`
                        : '-'}
                    </td>
                    <td className="p-2 whitespace-nowrap">{fmtLocal(r.start_ts)}</td>
                    <td className="p-2 whitespace-nowrap">{fmtLocal(r.end_ts)}</td>
                    <td className="p-2 text-right whitespace-nowrap">₩{Number(r.daily_wage || 0).toLocaleString()}</td>
                    <td className="p-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="p-2">
                      <div className="flex gap-2">
                        <Link className="btn" href={`/schedules/${r.id}/edit`}>수정</Link>
                        <button className="btn" onClick={() => onDelete(r.id)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="p-2 text-sm text-slate-500" colSpan={8}>
                      데이터가 없습니다. “+ 새 일정”으로 하나 추가해보세요.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t bg-slate-50">
                  <td className="p-2 font-semibold" colSpan={5}>합계</td>
                  <td className="p-2 font-extrabold text-right whitespace-nowrap">₩{totalWage.toLocaleString()}</td>
                  <td className="p-2" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------- 보조 컴포넌트 ------- */
function StatusBadge({ status }: { status: Row['status'] }) {
  const map: Record<Row['status'], { label: string; cls: string }> = {
    scheduled: { label: STATUS_LABEL.scheduled, cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    in_progress: { label: STATUS_LABEL.in_progress, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    done: { label: STATUS_LABEL.done, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    cancelled: { label: STATUS_LABEL.cancelled, cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  };
  const it = map[status];
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${it.cls}`}>
      {it.label}
    </span>
  );
}
