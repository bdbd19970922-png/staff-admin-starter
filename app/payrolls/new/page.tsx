'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import EmployeePicker, { EmployeeValue } from '@/components/EmployeePicker';

type Entry = {
  id: number;
  employee_id: string | null;
  employee_name: string | null;
  employee_phone: string | null;
  job_type: string | null;
  pay_date: string;         // 'YYYY-MM-DD'
  status: 'planned' | 'paid';
  memo: string | null;

  revenue_amount: number;   // 시공비(매출)
  labor_cost: number;       // 인건비
  material_cost: number;    // 자재비
  other_deduction: number;  // 기타공제
};

export default function NewPayrollPage() {
  const r = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
      setIsAdmin(Boolean(data?.is_admin));
    })();
  }, []);

  const [emp, setEmp] = useState<EmployeeValue>({ mode: 'profile', employeeId: '' });

  const [jobType, setJobType] = useState('');
  const [payDate, setPayDate] = useState(''); // YYYY-MM-DD
  const [status, setStatus] = useState<Entry['status']>('planned');
  const [memo, setMemo] = useState('');

  const [revenue, setRevenue] = useState(0);   // 매출(시공비)
  const [labor, setLabor] = useState(0);
  const [material, setMaterial] = useState(0);
  const [other, setOther] = useState(0);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const ownerProfit = revenue - labor - material - other;

  function getTodayLocalYYYYMMDD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const isToday = payDate && payDate === getTodayLocalYYYYMMDD();

  async function onCreate() {
    try {
      setMsg(null);
      setLoading(true);

      const payload: any = {
        job_type: jobType.trim() || null,
        pay_date: payDate || (null as any),
        status,
        memo: memo.trim() || null,

        revenue_amount: Number(revenue || 0),
        labor_cost: Number(labor || 0),
        material_cost: Number(material || 0),
        other_deduction: Number(other || 0),

        employee_id: null,
        employee_name: null,
        employee_phone: null,
      };

      if (emp.mode === 'profile') {
        if (!emp.employeeId) { setMsg('직원을 선택하세요.'); setLoading(false); return; }
        const { data: prof, error: pErr } = await supabase
          .from('profiles').select('name, phone').eq('id', emp.employeeId).maybeSingle();
        if (pErr) throw pErr;

        payload.employee_id = emp.employeeId;
        payload.employee_name = prof?.name ?? null;
        payload.employee_phone = prof?.phone ?? null;
      } else {
        if (!emp.name) { setMsg('직접입력: 이름을 입력하세요.'); setLoading(false); return; }
        payload.employee_name = emp.name.trim();
        payload.employee_phone = emp.phone?.trim() || null;
      }

      const { error } = await supabase.from('payroll_entries').insert(payload);
      if (error) throw error;

      alert('등록되었습니다.');
      r.push('/payrolls');
    } catch (e: any) {
      setMsg(e?.message || '등록 중 오류');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 상단 제목: 스카이 -> 인디고 그라데이션 */}
      <h1 className="text-2xl font-extrabold">
        <span className="title-gradient">새 급여 등록</span>
      </h1>

      {/* 카드 컨테이너: 파랑 톤 보더/링/섀도우 */}
      <div className="card max-w-3xl p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* 직원 선택 */}
          <EmployeePicker label="직원" value={emp} onChange={setEmp} />

          {/* 시공 타입 */}
          <div>
            <label className="mb-1 block text-sm text-gray-600">시공 타입</label>
            <input
              className="input"
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              placeholder="예: 타입A"
            />
          </div>

          {/* 매출/인건비/자재비/기타공제 */}
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

          {/* 지급일 + 오늘 배지 */}
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

          {/* 상태 */}
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

          {/* 메모 */}
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

        {/* 관리자에게만 대표 순수익 미리보기 */}
        {isAdmin && (
          <div className="mt-3 text-sm">
            대표 순수익(미리보기): <b>₩{Math.round(ownerProfit).toLocaleString()}</b>
          </div>
        )}

        {/* 오류 메시지 */}
        {msg ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {msg}
          </div>
        ) : null}

        {/* 액션 버튼들 */}
        <div className="mt-4 flex gap-2">
          <button onClick={onCreate} disabled={loading} className="btn btn-primary">
            등록
          </button>
          <button onClick={() => history.back()} className="btn">
            뒤로
          </button>
        </div>
      </div>
    </div>
  );
}
