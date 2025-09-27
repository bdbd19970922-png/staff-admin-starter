'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import EmployeePicker, { EmployeeValue } from '@/components/EmployeePicker';
import { useQueryClient } from '@tanstack/react-query';

type Entry = {
  id: number;
  employee_id: string | null;
  employee_name: string | null;
  employee_phone: string | null;
  job_type: string | null;
  pay_date: string | null;
  status: 'planned' | 'paid';
  memo: string | null;
  revenue_amount: number | null;
  labor_cost: number | null;
  material_cost: number | null;
  other_deduction: number | null;
};

export default function EditPayrollClient({ id }: { id: string | null }) {
  const router = useRouter();
  const eid = id ? Number(id) : null;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [emp, setEmp] = useState<EmployeeValue>({ mode: 'manual', name: '', phone: '' });
  const [jobType, setJobType] = useState('');
  const [payDate, setPayDate] = useState('');
  const [status, setStatus] = useState<'planned' | 'paid'>('planned');
  const [memo, setMemo] = useState('');

  const [revenue, setRevenue] = useState(0);
  const [labor, setLabor] = useState(0);
  const [material, setMaterial] = useState(0);
  const [other, setOther] = useState(0);

  const ownerProfit = revenue - labor - material - other;

  const queryClient = useQueryClient();

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
        setMsg(e.message || '불러오는 중 오류');
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
      // ✅ 저장 직후: 관련 캐시 무효화 + 즉시 재조회 (새로고침 없이 즉시 반영)
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const k = Array.isArray(q.queryKey) ? q.queryKey.join(':') : String(q.queryKey ?? '');
          return k.includes('payroll') || k.includes('timeline') || k.includes('schedule');
        }
      });
      await queryClient.refetchQueries({
        predicate: (q) => {
          const k = Array.isArray(q.queryKey) ? q.queryKey.join(':') : String(q.queryKey ?? '');
          return k.includes('payroll') || k.includes('timeline') || k.includes('schedule');
        }
      });

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

      // ✅ 삭제 직후: 관련 캐시 무효화 + 즉시 재조회
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const k = Array.isArray(q.queryKey) ? q.queryKey.join(':') : String(q.queryKey ?? '');
          return k.includes('payroll') || k.includes('timeline') || k.includes('schedule');
        }
      });
      await queryClient.refetchQueries({
        predicate: (q) => {
          const k = Array.isArray(q.queryKey) ? q.queryKey.join(':') : String(q.queryKey ?? '');
          return k.includes('payroll') || k.includes('timeline') || k.includes('schedule');
        }
      });

      router.push('/payrolls');
    } catch (e: any) {
      setMsg(e.message || '삭제 중 오류');
    } finally {
      setLoading(false);
    }
  }

  // ✅ 실시간 갱신: 다른 탭/기기에서 변경돼도 자동으로 최신화
  useEffect(() => {
    const ch = supabase
      .channel('payrolls-and-schedules-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payrolls' }, () => {
        queryClient.invalidateQueries({
          predicate: (q) => {
            const k = Array.isArray(q.queryKey) ? q.queryKey.join(':') : String(q.queryKey ?? '');
            return k.includes('payroll') || k.includes('timeline');
          }
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'schedules' }, () => {
        queryClient.invalidateQueries({
          predicate: (q) => {
            const k = Array.isArray(q.queryKey) ? q.queryKey.join(':') : String(q.queryKey ?? '');
            return k.includes('schedule') || k.includes('timeline');
          }
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

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

      {msg && <div className="alert error">{msg}</div>}

      <div className="card p-4 space-y-4">
        {invalid ? (
          <div className="text-sm text-gray-600">잘못된 경로(ID)</div>
        ) : (
          <>
            {/* 직원 선택 */}
            <div>
              <label className="mb-1 block text-sm text-gray-600">직원</label>
              <EmployeePicker value={emp} onChange={setEmp} />
            </div>

            {/* 직종 */}
            <div>
              <label className="mb-1 block text-sm text-gray-600">직종</label>
              <input
                className="input"
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                placeholder="예: 용접"
              />
            </div>

            {/* 지급일 */}
            <div>
              <label className="mb-1 block text-sm text-gray-600">지급일</label>
              <input
                type="date"
                className="input"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
              {isToday && <div className="mt-1 text-xs text-green-600">* 오늘 날짜입니다</div>}
            </div>

            {/* 상태 */}
            <div>
              <label className="mb-1 block text-sm text-gray-600">상태</label>
              <select
                className="input"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
              >
                <option value="planned">미지급(예정)</option>
                <option value="paid">지급완료</option>
              </select>
            </div>

            {/* 메모 */}
            <div>
              <label className="mb-1 block text-sm text-gray-600">메모</label>
              <textarea
                className="input"
                rows={4}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="선택지급 시 [sched:1,2] 형태로 자동 병합됩니다"
              />
            </div>

            {/* 금액들 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="mb-1 block text-sm text-gray-600">매출</label>
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
            </div>

            {/* 소유자 이익 */}
            <div className="text-sm text-gray-700">
              소유자 이익(예상): <b>{ownerProfit.toLocaleString()}</b> 원
            </div>

            {/* 액션 */}
            <div className="flex gap-2">
              <button
                onClick={onSave}
                disabled={invalid || loading}
                className="btn primary"
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
