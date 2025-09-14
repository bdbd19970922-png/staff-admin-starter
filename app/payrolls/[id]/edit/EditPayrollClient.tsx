'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import EmployeePicker, { EmployeeValue } from '@/components/EmployeePicker';

type Entry = {
  id: number;
  employee_id: string | null;
  employee_name: string | null;
  employee_phone: string | null;
  job_type: string | null;
  pay_date: string | null;
  status: 'planned' | 'paid';
  memo: string | null;

  revenue_amount: number;
  labor_cost: number;
  material_cost: number;
  other_deduction: number;
};

export default function EditPayrollClient({ id }: { id: string }) {
  const router = useRouter();

  const idStr = useMemo(() => String(id ?? '').trim(), [id]);
  const eid = /^\d+$/.test(idStr) ? idStr : null;

  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
      setIsAdmin(Boolean(data?.is_admin));
    })();
  }, []);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [emp, setEmp] = useState<EmployeeValue>({ mode: 'profile', employeeId: '' });

  const [jobType, setJobType] = useState('');
  const [payDate, setPayDate] = useState('');
  const [status, setStatus] = useState<Entry['status']>('planned');
  const [memo, setMemo] = useState('');

  const [revenue, setRevenue] = useState(0);
  const [labor, setLabor] = useState(0);
  const [material, setMaterial] = useState(0);
  const [other, setOther] = useState(0);

  const ownerProfit = revenue - labor - material - other;

  useEffect(() => {
    if (eid === null) { setMsg('잘못된 경로(ID)입니다.'); setLoading(false); return; }
    (async () => {
      try {
        setLoading(true);
        setMsg(null);

        const { data, error } = await supabase
          .from('payroll_entries')
          .select('*')
          .eq('id', eid)
          .maybeSingle<any>();
        if (error) throw error;
        if (!data) throw new Error('데이터를 찾을 수 없습니다.');

        if (data.employee_id) setEmp({ mode: 'profile', employeeId: data.employee_id });
        else setEmp({ mode: 'manual', name: data.employee_name || '', phone: data.employee_phone || '' });

        setJobType(data.job_type || '');
        setPayDate(data.pay_date || '');
        setStatus(data.status || 'planned');
        setMemo(data.memo || '');

        setRevenue(Number(data.revenue_amount || 0));
        setLabor(Number(data.labor_cost || 0));
        setMaterial(Number(data.material_cost || 0));
        setOther(Number(data.other_deduction || 0));
      } catch (e: any) {
        setMsg(e.message || '불러오기 오류');
      } finally {
        setLoading(false);
      }
    })();
  }, [eid]);

  function getTodayLocalYYYYMMDD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const isToday = payDate && payDate === getTodayLocalYYYYMMDD();

  async function onSave() {
    try {
      if (eid === null) { setMsg('잘못된 경로(ID)입니다.'); return; }
      setMsg(null);
      setLoading(true);

      const payload: any = {
        job_type: (jobType || '').trim() || null,
        pay_date: payDate || null,
        status,
        memo: memo?.trim() || null,

        revenue_amount: Number(revenue || 0),
        labor_cost: Number(labor || 0),
        material_cost: Number(material || 0),
        other_deduction: Number(other || 0),

        employee_id: null,
        employee_name: null,
        employee_phone: null,
      };

      if (emp.mode === 'profile') {
        if (!emp.employeeId) throw new Error('직원을 선택하세요.');
        const { data: prof, error: pErr } = await supabase
          .from('profiles').select('name, phone').eq('id', emp.employeeId).maybeSingle();
        if (pErr) throw pErr;

        payload.employee_id = emp.employeeId;
        payload.employee_name = prof?.name ?? null;
        payload.employee_phone = prof?.phone ?? null;
      } else {
        if (!emp.name) throw new Error('직접입력: 이름을 입력하세요.');
        payload.employee_name = emp.name.trim();
        payload.employee_phone = emp.phone?.trim() || null;
      }

      const { error } = await supabase.from('payroll_entries').update(payload).eq('id', eid);
      if (error) throw error;

      alert('저장되었습니다.');
      router.push('/payrolls');
    } catch (e: any) {
      setMsg(e.message || '저장 중 오류');
    } finally {
      setLoading(false);
    }
  }

  async function onDelete() {
    try {
      if (eid === null) { setMsg('잘못된 경로(ID)입니다.'); return; }
      if (!confirm('정말 삭제할까요?')) return;
      setLoading(true);
      const { error } = await supabase.from('payroll_entries').delete().eq('id', eid);
      if (error) throw error;
      router.push('/payrolls');
    } catch (e: any) {
      setMsg(e.message || '삭제 중 오류');
    } finally {
      setLoading(false);
    }
  }

  if (loading && eid !== null) {
    return <div className="card p-4 text-sm">불러오는 중…</div>;
  }
  const invalid = eid === null;

  return (
    <div className="space-y-4">
      {/* 상단 제목: 스카이 -> 인디고 그라데이션 */}
      <h1 className="text-2xl font-extrabold">
        <span className="title-gradient">급여 수정</span>
      </h1>

      <div className="card max-w-3xl p-4">
        {invalid ? (
          <div className="text-sm text-red-600">잘못된 경로(ID)입니다. 목록에서 다시 진입해주세요.</div>
        ) : (
          <>
            {msg ? (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                {msg}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <EmployeePicker label="직원" value={emp} onChange={setEmp} />

              <div>
                <label className="mb-1 block text-sm text-gray-600">시공 타입</label>
                <input
                  className="input"
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-600">시공비(매출)</label>
                <input
                  type="number"
                  className="input"
                  value={revenue}
                  onChange={(e) => setRevenue(Number(e.target.value || 0))}
                  min={0}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-600">인건비</label>
                <input
                  type="number"
                  className="input"
                  value={labor}
                  onChange={(e) => setLabor(Number(e.target.value || 0))}
                  min={0}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-600">자재비</label>
                <input
                  type="number"
                  className="input"
                  value={material}
                  onChange={(e) => setMaterial(Number(e.target.value || 0))}
                  min={0}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-600">기타공제</label>
                <input
                  type="number"
                  className="input"
                  value={other}
                  onChange={(e) => setOther(Number(e.target.value || 0))}
                  min={0}
                />
              </div>

              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="block text-sm text-gray-600">지급일</span>
                  {isToday ? <span className="badge-today">오늘</span> : null}
                </div>
                <input
                  type="date"
                  className="input"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-600">상태</label>
                <select
                  className="select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Entry['status'])}
                >
                  <option value="planned">지급예정</option>
                  <option value="paid">지급완료</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm text-gray-600">메모</label>
                <input
                  className="input"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="비고"
                />
              </div>
            </div>

            {isAdmin && (
              <div className="mt-3 text-sm">
                대표 순수익: <b>₩{Math.round(ownerProfit).toLocaleString()}</b>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={onSave}
                disabled={invalid || loading}
                className="btn btn-primary"
              >
                저장
              </button>
              <button
                onClick={onDelete}
                disabled={invalid || loading}
                className="btn"
              >
                삭제
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
