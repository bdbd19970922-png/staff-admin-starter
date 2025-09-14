'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Employee = { id: string; name: string | null; full_name?: string | null; phone: string | null };

export type EmployeeValue =
  | { mode: 'profile'; employeeId: string }
  | { mode: 'manual'; name: string; phone: string };

export default function EmployeePicker({
  label = '직원',
  value,
  onChange,
}: {
  label?: string;
  value: EmployeeValue;
  onChange: (v: EmployeeValue) => void;
}) {
  const [list, setList] = useState<Employee[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 목록 불러오기
  async function fetchProfiles() {
    setErr(null);
    setLoading(true);

    // name, full_name 둘 다 요청 → 어떤 스키마든 안전하게 매핑
    const { data, error } = await supabase
      .from('profiles')
      .select('id,name,full_name,phone,created_at')   // created_at 없으면 아래 order 줄 삭제
      .order('created_at', { ascending: false });

    if (error) {
      console.error('profiles load error', error);
      setErr(error.message);
      setList([]);
      setLoading(false);
      return;
    }

    const rows = ((data as any[]) ?? []).map(d => ({
      id: d.id,
      name: d.name ?? d.full_name ?? null, // name 없으면 full_name 사용
      full_name: d.full_name ?? null,
      phone: d.phone ?? null,
    }));

    setList(rows);
    setLoading(false);
  }

  // 최초 로드 + 실시간(가입/수정/삭제) 반영
  useEffect(() => {
    fetchProfiles();

    // Postgres Changes 실시간 구독
    const channel = supabase
      .channel('profiles-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => fetchProfiles()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 드롭다운 라벨: UUID 노출 금지 (이름/번호만)
  const labelOf = (e: Employee) =>
    `${e.name ?? '(이름없음)'}${e.phone ? ` (${e.phone})` : ''}`;

  return (
    <div>
      <label className="mb-1 block text-sm text-gray-600">{label}</label>

      <div className="mb-2 flex gap-3 text-sm">
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            checked={value.mode === 'profile'}
            onChange={() =>
              onChange({
                mode: 'profile',
                employeeId: value.mode === 'profile' ? value.employeeId : '',
              })
            }
          />
          프로필 선택
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            checked={value.mode === 'manual'}
            onChange={() => onChange({ mode: 'manual', name: '', phone: '' })}
          />
          직접입력
        </label>
      </div>

      {value.mode === 'profile' ? (
        <div>
          <select
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={value.employeeId}
            onChange={(e) =>
              onChange({ mode: 'profile', employeeId: e.target.value })
            }
            disabled={loading}
          >
            <option value="">{loading ? '불러오는 중…' : '-- 선택 --'}</option>
            {list.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {labelOf(emp)}
              </option>
            ))}
          </select>

          {err ? (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {err}
            </div>
          ) : null}

          {!err && !loading ? (
            <p className="mt-1 text-xs text-gray-500">
              ※ 회원 가입/수정 시 목록이 자동으로 갱신됩니다.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="이름"
            value={value.name}
            onChange={(e) =>
              onChange({ mode: 'manual', name: e.target.value, phone: value.phone })
            }
          />
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="전화번호"
            value={value.phone}
            onChange={(e) =>
              onChange({ mode: 'manual', name: value.name, phone: e.target.value })
            }
          />
        </div>
      )}
    </div>
  );
}
