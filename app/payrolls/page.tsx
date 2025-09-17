// FILE: /app/payrolls/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { supabase } from '@/lib/supabaseClient';
import { format } from 'date-fns';

/* ================== 타입 ================== */
type PayrollRow = {
  id: string | number;
  employee_id: string | null;
  employee_name: string | null;
  pay_month: string | null;     // 'YYYY-MM' 또는 'YYYY-MM-DD~YYYY-MM-DD'
  period_start: string | null;  // date
  period_end: string | null;    // date
  amount: number | null;
  total_pay: number | null;
  paid: boolean | null;
  paid_at: string | null;       // timestamptz
  memo: string | null;
};

type ProfileRow = {
  id: string;
  name: string | null;
  full_name?: string | null;
  phone: string | null;
};

/* ============ 페이지 컴포넌트 ============ */
export default function Page() {
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 관리자인지 판별
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    (async () => {
      const adminIds = (process.env.NEXT_PUBLIC_ADMIN_IDS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? '';
      const email = (session?.user?.email ?? '').toLowerCase();
      setIsAdmin((!!uid && adminIds.includes(uid)) || (!!email && adminEmails.includes(email)));
    })();
  }, []);

  /* ===== 필터: 월 / 직원 ===== */
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [empFilter, setEmpFilter] = useState<string>('all'); // 'all' | name(lower)
  const [mode, setMode] = useState<'list' | 'employee'>('list'); // 표 vs 직원별 집계

  /* ===== 행별 편집 상태(메모/지급일) ===== */
  type EditState = { memo: string; paidDate: string; saving?: boolean };
  const [edit, setEdit] = useState<Record<string | number, EditState>>({});

  /* ===== 데이터 로드 (급여 rows) ===== */
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      // 선택 월에 해당하는 레코드만 서버에서 1차 필터
      const orCond = `pay_month.eq.${month},pay_month.ilike.*${month}*`;
      const { data, error } = await supabase
        .from('payrolls')
        .select('id,employee_id,employee_name,pay_month,period_start,period_end,amount,total_pay,paid,paid_at,memo')
        .or(orCond)
        .order('employee_name', { ascending: true })
        .order('pay_month', { ascending: false });

      if (error) {
        setMsg(`불러오기 오류: ${error.message}`);
        setRows([]);
      } else {
        setRows((data as PayrollRow[]) ?? []);
      }
      setLoading(false);
    })();
  }, [month]);

  /* ===== 프로필 목록 (실시간) ===== */
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [profilesErr, setProfilesErr] = useState<string | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(true);

  async function fetchProfiles() {
    setProfilesErr(null);
    setProfilesLoading(true);

    // name, full_name 둘 다 요청 → 어떤 스키마든 안전
    const { data, error } = await supabase
      .from('profiles')
      .select('id,name,full_name,phone,created_at') // created_at 없으면 order 줄 제거
      .order('created_at', { ascending: false });

    if (error) {
      setProfilesErr(error.message);
      setProfiles([]);
      setProfilesLoading(false);
      return;
    }

    setProfiles(((data ?? []) as any[]).map(d => ({
      id: d.id,
      name: d.name ?? d.full_name ?? null,
      full_name: d.full_name ?? null,
      phone: d.phone ?? null,
    })));
    setProfilesLoading(false);
  }

  // 최초 + 실시간 구독
  useEffect(() => {
    fetchProfiles();

    const channel = supabase
      .channel('profiles-realtime-for-payrolls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        fetchProfiles();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  /* ===== 직원 드롭다운 옵션 (급여 rows + profiles 합집합) ===== */
  const empOptions = useMemo(() => {
    const nameSet = new Set<string>();

    // 1) 급여 rows에서 이름 수집
    for (const r of rows) {
      const name = (r.employee_name ?? '').trim();
      if (name) nameSet.add(name);
    }

    // 2) profiles에서 이름 수집 (name 없으면 full_name 사용했음)
    for (const p of profiles) {
      const nm = (p.name ?? '').trim();
      if (nm) nameSet.add(nm);
    }

    const nameOps = Array.from(nameSet)
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .map(n => ({ key: n.toLowerCase(), label: n }));

    return [{ key: 'all', label: '전체' }, ...nameOps];
  }, [rows, profiles]);

  /* ===== 클라이언트 필터 적용 ===== */
  const filtered = useMemo(() => {
    if (empFilter === 'all') return rows;
    return rows.filter(r => (r.employee_name ?? '').trim().toLowerCase() === empFilter);
  }, [rows, empFilter]);

  /* ===== 직원별 집계 ===== */
  const grouped = useMemo(() => {
    const map = new Map<string, {
      employee_id: string | null;
      employee_name: string;
      count: number;
      total: number;
      paid: number;
      unpaid: number;
    }>();
    for (const r of filtered) {
      const name = (r.employee_name ?? '(미지정)').trim() || '(미지정)';
      if (!map.has(name)) {
        map.set(name, {
          employee_id: r.employee_id ?? null,
          employee_name: name,
          count: 0, total: 0, paid: 0, unpaid: 0,
        });
      }
      const g = map.get(name)!;
      const pay = number(r.total_pay ?? r.amount);
      g.count += 1;
      g.total += pay;
      if (r.paid) g.paid += pay;
      else g.unpaid += pay;
    }
    return Array.from(map.values()).sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'ko'));
  }, [filtered]);

  /* ===== (기존) 지급완료 가능 조건 문구는 유지하되, 실제 동작은 모달에서 날짜 선택 ===== */
  const today = new Date();
  const todayDay = today.getDate();
  const allowedDay = [10, 20, 30].includes(todayDay);
  const canMarkPaid = (_rowId: string | number) => {
    // 버튼 활성화는 모달을 띄우므로 항상 true 로 둔다 (UI 문구만 유지)
    return true;
  };

  /* ===== 액션: 메모/지급일 변경/저장/지급완료/삭제 ===== */
  const setRowMemo = (id: string | number, memo: string) =>
    setEdit(s => ({ ...s, [id]: { ...(s[id] ?? { memo: '', paidDate: '' }), memo } }));

  const setRowPaidDate = (id: string | number, paidDate: string) =>
    setEdit(s => ({ ...s, [id]: { ...(s[id] ?? { memo: '', paidDate: '' }), paidDate } }));

  const saveMemo = async (row: PayrollRow) => {
    const st = edit[row.id] ?? { memo: row.memo ?? '', paidDate: '' };
    setEdit(s => ({ ...s, [row.id]: { ...st, saving: true } }));
    try {
      const { error } = await supabase.from('payrolls').update({ memo: st.memo ?? null }).eq('id', row.id);
      if (error) throw error;
      setRows(list => list.map(r => (r.id === row.id ? { ...r, memo: st.memo ?? null } : r)));
    } catch (e: any) {
      setMsg(`저장 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setEdit(s => ({ ...s, [row.id]: { ...st, saving: false } }));
    }
  };

  // 기존 markPaid를 날짜 인자를 받도록 확장
  const markPaid = async (row: PayrollRow, pickedDate?: string) => {
    const st = edit[row.id] ?? { memo: row.memo ?? '', paidDate: '' };
    const useDate = pickedDate || st.paidDate || '';
    if (!useDate) {
      alert('지급일을 선택해주세요.');
      return;
    }
    const paid_at = toISODateMid(useDate);
    setEdit(s => ({ ...s, [row.id]: { ...st, saving: true } }));
    try {
      const { error } = await supabase
        .from('payrolls')
        .update({
          memo: st.memo ?? row.memo ?? null,
          paid: true,
          paid_at,
        })
        .eq('id', row.id);
      if (error) throw error;
      setRows(list => list.map(r => (r.id === row.id ? { ...r, memo: st.memo ?? row.memo ?? null, paid: true, paid_at } : r)));
    } catch (e: any) {
      setMsg(`지급완료 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setEdit(s => ({ ...s, [row.id]: { ...st, saving: false } }));
    }
  };

  const deleteRow = async (row: PayrollRow) => {
    // 지급완료 건은 이중 확인
    const baseMsg = `정말 삭제하시겠습니까?\n직원: ${row.employee_name || row.employee_id || '-'}\n월: ${row.pay_month ?? '-'}\n금액: ${fmtKRW(row.total_pay ?? row.amount)}`;
    if (!confirm(baseMsg)) return;
    if (row.paid) {
      const warn = `⚠️ 이 항목은 '지급완료' 상태입니다.\n삭제하면 되돌릴 수 없습니다.\n정말 삭제하시겠습니까?`;
      if (!confirm(warn)) return;
    }
    try {
      const { error } = await supabase.from('payrolls').delete().eq('id', row.id);
      if (error) throw error;
      setRows(list => list.filter(r => r.id !== row.id));
    } catch (e: any) {
      setMsg(`삭제 실패: ${e?.message ?? '알 수 없는 오류'}`);
    }
  };

  /* ===== 지급완료 모달 상태 ===== */
  const [paidModal, setPaidModal] = useState<{
    open: boolean;
    row: PayrollRow | null;
    date: string; // YYYY-MM-DD
  }>({ open: false, row: null, date: '' });

  const openPaidModal = (row: PayrollRow) => {
    const st = edit[row.id];
    const todayStr = toYMD(new Date());
    setPaidModal({
      open: true,
      row,
      date: (st?.paidDate && /^\d{4}-\d{2}-\d{2}$/.test(st.paidDate)) ? st.paidDate : todayStr,
    });
  };
  const closePaidModal = () => setPaidModal({ open: false, row: null, date: '' });

  const confirmPaidModal = async () => {
    if (!paidModal.row) return;
    if (!paidModal.date) {
      alert('지급일을 선택해주세요.');
      return;
    }
    await markPaid(paidModal.row, paidModal.date);
    closePaidModal();
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-sky-700 via-sky-600 to-indigo-600 bg-clip-text text-transparent">
              급여
            </span>
          </h1>
          <p className="text-slate-600 text-sm mt-1">월/직원 기준으로 급여를 관리하고 지급 상태를 업데이트하세요.</p>
        </div>
      </div>

      {/* 컨트롤바 (파스텔 블루 카드) */}
      <div className="card border-sky-100 ring-1 ring-sky-100/70 shadow-[0_6px_16px_rgba(2,132,199,0.08)]">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-slate-600 mb-1">월 선택</label>
            <input
              type="month"
              className="input w-[160px]"
              value={month}
              onChange={e => setMonth(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">
              직원 필터
              {(profilesLoading || profilesErr) && (
                <span className="ml-2 text-[11px] text-slate-500">
                  {profilesLoading ? ' (불러오는 중…)' : ` (오류: ${profilesErr})`}
                </span>
              )}
            </label>
            <select className="select w-[200px]" value={empFilter} onChange={e => setEmpFilter(e.target.value)}>
              {empOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">보기</label>
            <select className="select w-[160px]" value={mode} onChange={e => setMode(e.target.value as any)}>
              <option value="list">목록</option>
              <option value="employee">직원별 집계</option>
            </select>
          </div>

          <div className="ml-auto text-xs text-slate-600">
            지급일 미선택 시 <b>10·20·30일</b>에만 지급완료 가능
          </div>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {msg}
        </div>
      )}

      {/* 표 영역 */}
      <section className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white shadow-[0_6px_16px_rgba(2,132,199,0.08)] overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-600">불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-slate-500">표시할 급여 데이터가 없습니다.</div>
        ) : mode === 'employee' ? (
          <EmployeeTable groups={grouped} />
        ) : (
          <ListTable
            rows={filtered}
            edit={edit}
            isAdmin={isAdmin}
            setRowMemo={setRowMemo}
            setRowPaidDate={setRowPaidDate}
            saveMemo={saveMemo}
            // 버튼 클릭 시 모달 열기
            openPaidModal={openPaidModal}
            canMarkPaid={canMarkPaid}
            onDelete={deleteRow}
          />
        )}
      </section>

      {/* ===== 지급완료 모달 ===== */}
      {paidModal.open && (
        <Modal onClose={closePaidModal} title="지급완료">
          <div className="space-y-3">
            <div className="text-sm text-slate-700">
              지급일을 선택해 주세요. (언제든 선택 가능)
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600 w-20">지급일</label>
              <input
                type="date"
                className="input w-[170px]"
                value={paidModal.date}
                onChange={e => setPaidModal(s => ({ ...s, date: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn" onClick={closePaidModal}>취소</button>
              <button
                className="btn bg-slate-900 text-white hover:bg-slate-800"
                onClick={confirmPaidModal}
              >
                지급완료
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============ 목록 테이블(행별 편집) ============ */
function ListTable({
  rows, edit, isAdmin, setRowMemo, setRowPaidDate, saveMemo, openPaidModal, canMarkPaid, onDelete,
}: {
  rows: PayrollRow[];
  edit: Record<string | number, { memo: string; paidDate: string; saving?: boolean }>;
  isAdmin: boolean;
  setRowMemo: (id: string | number, memo: string) => void;
  setRowPaidDate: (id: string | number, paidDate: string) => void;
  saveMemo: (row: PayrollRow) => Promise<void>;
  openPaidModal: (row: PayrollRow) => void;
  canMarkPaid: (rowId: string | number) => boolean;
  onDelete: (row: PayrollRow) => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1080px] w-full text-sm">
        <thead className="bg-sky-50/60 border-b border-sky-100">
          <tr>
            <Th>직원</Th>
            <Th>월</Th>
            <Th>기간</Th>
            <Th className="text-right">금액</Th>
            <Th>지급</Th>
            <Th>지급일</Th>
            <Th>메모</Th>
            {isAdmin && <Th>액션</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = edit[r.id] ?? { memo: r.memo ?? '', paidDate: '' };
            const saving = !!st.saving;
            return (
              <tr key={String(r.id)} className="border-b border-slate-100 hover:bg-slate-50/60 align-top">
                <Td>{r.employee_name || (r.employee_id ? `ID:${r.employee_id}` : '-')}</Td>
                <Td>{r.pay_month ?? '-'}</Td>
                <Td>{formatMaybeDate(r.period_start)} ~ {formatMaybeDate(r.period_end)}</Td>
                <Td className="text-right font-semibold">{fmtKRW(r.total_pay ?? r.amount)}</Td>
                <Td>{r.paid ? '지급완료' : '미지급'}</Td>
                <Td>{formatMaybeDateTime(r.paid_at)}</Td>
                <Td className="min-w-[220px]">
                  <textarea
                    className="w-full rounded-xl border px-2 py-1 text-sm"
                    rows={2}
                    disabled={!isAdmin}
                    value={st.memo}
                    onChange={e => setRowMemo(r.id, e.target.value)}
                    placeholder="메모를 입력하세요"
                  />
                </Td>
                {isAdmin && (
                  <Td className="min-w-[360px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        className="input w-[150px] py-1"
                        value={st.paidDate}
                        onChange={e => setRowPaidDate(r.id, e.target.value)}
                        title="지급일"
                      />
                      <button
                        className="btn"
                        disabled={saving}
                        onClick={() => saveMemo(r)}
                        title="메모 저장"
                      >
                        메모 저장
                      </button>
                      <button
                        className={`btn ${canMarkPaid(r.id) ? 'bg-slate-900 text-white hover:bg-slate-800' : 'opacity-50'}`}
                        disabled={saving || !canMarkPaid(r.id)}
                        onClick={() => openPaidModal(r)}
                        title="지급완료(모달에서 날짜 선택)"
                      >
                        지급완료
                      </button>
                      <button
                        className="btn border-rose-300 text-rose-700 hover:bg-rose-50"
                        disabled={saving}
                        onClick={() => onDelete(r)}
                        title="이 급여 항목 삭제"
                      >
                        삭제
                      </button>
                    </div>
                  </Td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-sky-50/40 border-t border-sky-100">
          <tr>
            <Td className="font-semibold">합계</Td>
            <Td colSpan={2} />
            <Td className="font-extrabold text-right">{fmtKRW(sum(rows.map(r => number(r.total_pay ?? r.amount))))}</Td>
            <Td colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ============ 직원별 집계 테이블 ============ */
function EmployeeTable({
  groups,
}: {
  groups: Array<{ employee_id: string | null; employee_name: string; count: number; total: number; paid: number; unpaid: number }>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[760px] w-full text-sm">
        <thead className="bg-sky-50/60 border-b border-sky-100">
          <tr>
            <Th>직원</Th>
            <Th className="text-right">건수</Th>
            <Th className="text-right">총액</Th>
            <Th className="text-right">지급액</Th>
            <Th className="text-right">미지급액</Th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={`${g.employee_name}-${i}`} className="border-b border-slate-100 hover:bg-slate-50/60">
              <Td>{g.employee_name || (g.employee_id ? `ID:${g.employee_id}` : '(미지정)')}</Td>
              <Td className="text-right">{g.count}</Td>
              <Td className="text-right font-semibold">{fmtKRW(g.total)}</Td>
              <Td className="text-right">{fmtKRW(g.paid)}</Td>
              <Td className="text-right">{fmtKRW(g.unpaid)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-sky-50/40 border-t border-sky-100">
          <tr>
            <Td className="font-semibold">합계</Td>
            <Td className="font-semibold text-right">{sum(groups.map(g => g.count))}</Td>
            <Td className="font-semibold text-right">{fmtKRW(sum(groups.map(g => g.total)))}</Td>
            <Td className="font-semibold text-right">{fmtKRW(sum(groups.map(g => g.paid)))}</Td>
            <Td className="font-semibold text-right">{fmtKRW(sum(groups.map(g => g.unpaid)))}</Td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ===== 공통 모달 컴포넌트 (가벼운 구현) ===== */
function Modal({
  title, children, onClose,
}: {
  title?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-[90vw] max-w-[480px] rounded-2xl bg-white shadow-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-slate-900">{title ?? 'Modal'}</h2>
          <button className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

/* ============ 공통 소품/유틸 ============ */
// ⬇️ 표준 HTML 속성(colSpan 등) 전부 지원
function Th(props: React.ThHTMLAttributes<HTMLTableHeaderCellElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <th
      {...rest}
      className={`px-2 py-2 text-left text-[13px] font-semibold text-sky-900 ${className}`}
    >
      {children}
    </th>
  );
}
function Td(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <td
      {...rest}
      className={`px-2 py-2 align-top ${className}`}
    >
      {children}
    </td>
  );
}

function fmtKRW(v?: number | null) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
  try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(v); }
  catch { return `${Math.round(v).toLocaleString()}원`; }
}
function formatMaybeDate(iso?: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(+d)) return '-';
  return format(d, 'yyyy-MM-dd');
}
function formatMaybeDateTime(iso?: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(+d)) return '-';
  return format(d, 'yyyy-MM-dd HH:mm');
}
function number(n: any): number { const x = Number(n ?? 0); return Number.isFinite(x) ? x : 0; }
function sum(list: number[]) { return list.reduce((a, b) => a + b, 0); }
function toISODateMid(dateStr: string) {
  // 'YYYY-MM-DD' -> 해당일 09:00(KST 가정) ISO
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const local = new Date(y, (m ?? 1) - 1, d ?? 1, 9, 0, 0); // 오전 9시
    return local.toISOString();
  } catch { return new Date().toISOString(); }
}
function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
