'use client';

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { supabase } from '@/lib/supabaseClient';
import { format, startOfMonth, endOfMonth } from 'date-fns';

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

/* 타임라인용 스케줄(보안뷰) */
type SchedRow = {
  id: number;
  title: string | null;
  start_ts: string;
  end_ts: string;
  site_address: string | null;
  daily_wage: number | null;
  off_day: boolean | null;
  employee_id: string | null;
  employee_name: string | null;
};

/* ============ 페이지 컴포넌트 ============ */
export default function Page() {
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 현재 로그인 사용자 id/email (재사용)
  const [userId, setUserId] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');

  // 관리자/매니저 판별
  const [isAdmin, setIsAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const canViewAll = isAdmin || isManager; // 관리자 or 매니저면 전사 열람

  // 관리자: 환경변수 + 프로필(is_admin) 둘 다 인정
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? '';
      const email = (session?.user?.email ?? '').toLowerCase();
      setUserId(uid);
      setUserEmail(email);

      // 1) env 기반 관리자
      const adminIds = (process.env.NEXT_PUBLIC_ADMIN_IDS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      let envAdmin = (!!uid && adminIds.includes(uid)) || (!!email && adminEmails.includes(email));

      // 2) 프로필에서 관리자/매니저 플래그 조회
      if (uid) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('is_admin,is_manager')
          .eq('id', uid)
          .maybeSingle();
        setIsManager(!!prof?.is_manager);
        // envAdmin OR DB is_admin
        setIsAdmin(envAdmin || !!prof?.is_admin);
      } else {
        setIsManager(false);
        setIsAdmin(envAdmin);
      }
    })();
  }, []);

  /* ===== 필터: 월 / 직원 ===== */
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [empFilter, setEmpFilter] = useState<string>('all'); // 'all' | name(lower)
  const [mode, setMode] = useState<'list' | 'employee'>('employee'); // 기본: 직원별 집계

  /* ===== 행별 편집 상태(메모/지급일) ===== */
  type EditState = { memo: string; paidDate: string; saving?: boolean };
  const [edit, setEdit] = useState<Record<string | number, EditState>>({});

  /* ===== 데이터 로드 (급여 rows) ===== */
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const orCond = month ? `pay_month.eq.${month},pay_month.ilike.*${month}*` : undefined;

      let q = supabase
        .from('payrolls_secure') // ✅ 읽기는 보안뷰
        .select('id,employee_id,employee_name,pay_month,period_start,period_end,amount,total_pay,paid,paid_at,memo')
        .order('employee_name', { ascending: true })
        .order('pay_month', { ascending: false });

      if (orCond) q = q.or(orCond);

      // ✅ 직원만 자기 것 필터 (관리자/매니저는 전사)
      if (!canViewAll && userId) {
        q = q.eq('employee_id', userId);
      }

      const { data, error } = await q;

      if (error) {
        setMsg(`불러오기 오류: ${error.message}`);
        setRows([]);
      } else {
        setRows((data as PayrollRow[]) ?? []);
      }
      setLoading(false);
    })();
  }, [month, canViewAll, userId]);

  /* ===== 프로필 목록 (실시간) ===== */
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [profilesErr, setProfilesErr] = useState<string | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(true);

  async function fetchProfiles() {
    setProfilesErr(null);
    setProfilesLoading(true);

    const { data, error } = await supabase
      .from('profiles')
      .select('id,name,full_name,phone,created_at')
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
    return () => { supabase.removeChannel(channel); };
  }, []);

  /* ===== 직원 드롭다운 옵션 (급여 rows + profiles 합집합) ===== */
  const empOptions = useMemo(() => {
    const nameSet = new Set<string>();
    for (const r of rows) {
      const name = (r.employee_name ?? '').trim();
      if (name) nameSet.add(name);
    }
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
      const pay = toNum(r.total_pay ?? r.amount);
      g.count += 1;
      g.total += pay;
      if (r.paid) g.paid += pay;
      else g.unpaid += pay;
    }
    return Array.from(map.values()).sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'ko'));
  }, [filtered]);

  /* ===== 행 편집(메모/지급일) 관련 ===== */
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

  // 기존 단건 지급완료: 지급일 인자로 확장
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

  /* ===== 지급완료 모달(단건) ===== */
  const [paidModal, setPaidModal] = useState<{ open: boolean; row: PayrollRow | null; date: string; }>({ open: false, row: null, date: '' });
  const openPaidModal = (row: PayrollRow) => {
    const st = edit[row.id];
    const todayStr = toYMD(new Date());
    setPaidModal({ open: true, row, date: (st?.paidDate && /^\d{4}-\d{2}-\d{2}$/.test(st.paidDate)) ? st.paidDate : todayStr });
  };
  const closePaidModal = () => setPaidModal({ open: false, row: null, date: '' });
  const confirmPaidModal = async () => {
    if (!paidModal.row) return;
    if (!paidModal.date) { alert('지급일을 선택해주세요.'); return; }
    await markPaid(paidModal.row, paidModal.date);
    closePaidModal();
  };

  /* ===== (신규) 직원 타임라인 모달 ===== */
  const [tl, setTl] = useState<{
    open: boolean;
    employee_id: string | null;
    employee_name: string;
    loading: boolean;
    list: Array<SchedRow & { checked: boolean; paidDone?: boolean }>;
    error: string | null;
    payDate: string; // 선택 지급일
    saving: boolean;
  }>({
    open: false,
    employee_id: null,
    employee_name: '',
    loading: false,
    list: [],
    error: null,
    payDate: toYMD(new Date()),
    saving: false,
  });

  const openTimeline = async (employee_id: string | null, employee_name: string) => {
    setTl(s => ({ ...s, open: true, employee_id, employee_name, loading: true, list: [], error: null }));
    try {
      const [y, m] = month.split('-').map(Number);
      const from = startOfMonth(new Date(y, (m ?? 1) - 1, 1)).toISOString();
      const to = endOfMonth(new Date(y, (m ?? 1) - 1, 1)).toISOString();

      let q = supabase
        .from('schedules_secure')
        .select('id,title,start_ts,end_ts,site_address,daily_wage,off_day,employee_id,employee_name')
        .gte('start_ts', from)
        .lte('start_ts', to)
        .order('start_ts', { ascending: true });

      if (employee_id) q = q.eq('employee_id', employee_id);
      else if (employee_name) q = q.ilike('employee_name', `%${employee_name}%`);

      const { data, error } = await q;
      if (error) throw error;

      // ✅ 같은 직원 + 같은 월의 "지급완료" 급여들에서 이미 반영된 스케줄ID 수집
      let payQ = supabase
        .from('payrolls')
        .select('memo,paid,employee_id,employee_name,pay_month')
        .eq('paid', true);

      // ←← 여기 핵심: 월 필터는 eq + ilike OR로 묶어서 "YYYY-MM" + "YYYY-MM-part-..." 모두 포함
      if (month) {
        payQ = payQ.or(`pay_month.eq.${month},pay_month.ilike.*${month}*`);
      }

      if (employee_id) payQ = payQ.eq('employee_id', employee_id);
      else if (employee_name) payQ = payQ.ilike('employee_name', `%${employee_name}%`);

      const { data: paidRows } = await payQ;
      const alreadyPaidIds = Array.from(new Set((paidRows ?? []).flatMap(r => parseSchedIdsFromMemo(r.memo))));

      // 리스트에 paidDone 플래그 부여
      const list = (data as SchedRow[]).map(x => ({
        ...x,
        checked: false,
        paidDone: alreadyPaidIds.includes(x.id),
      }));

      setTl(s => ({ ...s, list, loading: false, error: null }));
    } catch (e: any) {
      setTl(s => ({ ...s, loading: false, error: e?.message || '불러오기 실패' }));
    }
  };
  const closeTimeline = () => setTl(s => ({ ...s, open: false, list: [] }));

  const tlToggle = (id: number, v: boolean) =>
    setTl(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, checked: v } : x)) }));

  const tlAll = (v: boolean) =>
    setTl(s => ({
      ...s,
      list: s.list.map(x => ({
        ...x,
        // 이미 지급되었거나(off_day, paidDone) 항목은 강제로 체크 해제
        checked: v && !x.off_day && !x.paidDone ? true : false,
      })),
    }));

  const tlSelected = useMemo(() => tl.list.filter(x => x.checked), [tl.list]);
  const tlSum = useMemo(() => tlSelected.reduce((a, b) => a + toNum(b.daily_wage), 0), [tlSelected]);
  const tlSpan = useMemo(() => {
    if (tlSelected.length === 0) return { start: null as string | null, end: null as string | null };
    const ds = tlSelected.map(x => x.start_ts).sort();
    return { start: ds[0]!, end: ds[ds.length - 1]! };
  }, [tlSelected]);

  // 메모에서 [sched:1,2,3] 형태로 스케줄ID 목록을 파싱/포맷하는 유틸
  function parseSchedIdsFromMemo(memo?: string | null): number[] {
    if (!memo) return [];
    const m = memo.match(/\[sched:([0-9,\s]+)\]/);
    if (!m) return [];
    return m[1].split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n));
  }
  function formatSchedIdsTag(ids: number[]) {
    const uniq = Array.from(new Set(ids)).sort((a,b) => a-b);
    return `[sched:${uniq.join(',')}]`;
  }

  // 선택 지급(부분지급 + 차감 + 중복방지)
  const createPayrollForSelected = async () => {
    if (!isAdmin) { alert('지급 처리 권한이 없습니다. (관리자 전용)'); return; }
    if (tlSelected.length === 0) { alert('지급할 스케줄을 한 개 이상 선택해주세요.'); return; }
    if (!tl.payDate) { alert('지급일을 선택해주세요.'); return; }

    const employee_id = tl.employee_id;
    const employee_name = tl.employee_name;
    const pay_month_base = month; // 'YYYY-MM'
    const period_start_sel = tlSpan.start ? toYMD(new Date(tlSpan.start)) : null;
    const period_end_sel   = tlSpan.end ? toYMD(new Date(tlSpan.end)) : null;
    const paid_at = toISODateMid(tl.payDate);

    // 이번에 선택한 스케줄 ID/금액 맵
    const selectedIds = tlSelected.map(x => x.id);
    const wageById = new Map<number, number>(tlSelected.map(x => [x.id, Number(x.daily_wage ?? 0)]));

    // 합계 도우미
    const sumByIds = (ids: number[]) => ids.reduce((s, id) => s + (wageById.get(id) ?? 0), 0);

    setTl(s => ({ ...s, saving: true }));
    try {
      // 1) 같은 직원 + 같은 pay_month 전체 조회 (미지급/지급완료 모두)
      let baseQ = supabase
        .from('payrolls')
        .select('id,paid,total_pay,memo,period_start,period_end,pay_month,employee_id,employee_name');

      if (pay_month_base) {
        baseQ = baseQ.or(`pay_month.eq.${pay_month_base},pay_month.ilike.*${pay_month_base}*`);
      }

      if (employee_id) baseQ = baseQ.eq('employee_id', employee_id);
      else baseQ = baseQ.ilike('employee_name', employee_name ?? '');

      const { data: sameMonthRows, error: queryErr } = await baseQ;
      if (queryErr) throw queryErr;

      const paidRows = (sameMonthRows ?? []).filter(r => r.paid);
      const unpaidRow = (sameMonthRows ?? []).find(r => !r.paid) as any | undefined;

      // 2) 이미 지급된 스케줄은 제외(중복지급 방지)
      const alreadyPaidIds = Array.from(new Set(
        paidRows.flatMap(r => parseSchedIdsFromMemo(r.memo))
      ));
      const payIdsFiltered = selectedIds.filter(id => !alreadyPaidIds.includes(id));
      if (payIdsFiltered.length === 0) {
        alert('선택한 항목이 이미 모두 지급 처리되어 있습니다. (중복 지급 방지)');
        setTl(s => ({ ...s, saving: false }));
        return;
      }

      // 3) 미지급 건이 있으면: 그 미지급 건에서 "선택분만 차감"
      if (unpaidRow) {
        const unpaidIds = parseSchedIdsFromMemo(unpaidRow.memo);
        const willDeductIds = payIdsFiltered.filter(id => unpaidIds.includes(id));
        const deductAmount = sumByIds(willDeductIds);

        const remainIds = unpaidIds.filter(id => !willDeductIds.includes(id));
        const newUnpaidTotal = Math.max(0, Number(unpaidRow.total_pay ?? 0) - deductAmount);

        if (remainIds.length === 0 || newUnpaidTotal <= 0) {
          // 남은 미지급이 없으면 "미지급 건 삭제"
          const { error: delErr } = await supabase.from('payrolls').delete().eq('id', unpaidRow.id);
          if (delErr) throw delErr;
        } else {
          // 남으면 금액/메모만 갱신 (paid=false 유지)
          const baseMemo = unpaidRow.memo ? unpaidRow.memo.replace(/\[sched:[^\]]*\]/, '').trim() : '';
          const newMemo = `${baseMemo ? baseMemo + '\n' : ''}${formatSchedIdsTag(remainIds)}`;
          const { error: updErr } = await supabase
            .from('payrolls')
            .update({
              total_pay: newUnpaidTotal,
              amount: newUnpaidTotal,
              memo: newMemo,
            })
            .eq('id', unpaidRow.id);
          if (updErr) throw updErr;
        }
      }

      // 4) 지급완료 건은 "새 레코드"로 생성 (유니크 제약 회피 위해 pay_month suffix)
      const payAmount = sumByIds(payIdsFiltered);
      if (payAmount <= 0) {
        alert('지급 금액이 0원입니다. 선택 항목의 일당을 확인해 주세요.');
        setTl(s => ({ ...s, saving: false }));
        return;
      }
      const suffix = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, ''); // MMDDHHmm
      const pay_month_alt = `${pay_month_base}-part-${suffix}`;
      const memoTag = formatSchedIdsTag(payIdsFiltered);

      const { error: insErr } = await supabase.from('payrolls').insert({
        employee_id,
        employee_name,
        pay_month: pay_month_alt,
        period_start: period_start_sel,
        period_end: period_end_sel,
        total_pay: payAmount,
        amount: payAmount,
        paid: true,
        paid_at,
        memo: `[선택지급] ${employee_name ?? ''} ${pay_month_base} / ${payIdsFiltered.length}건\n${memoTag}`,
      });
      if (insErr) throw insErr;

      // 5) 성공 후 급여 리스트 갱신 + 타임라인 즉시 새로고침(=지급된 건은 곧바로 비활성 표시)
      await reloadRows();
      await openTimeline(tl.employee_id, tl.employee_name); // 모달 유지 + 갱신
    } catch (e: any) {
      setMsg(`선택 지급 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setTl(s => ({ ...s, saving: false }));
    }
  };

  async function reloadRows() {
    setLoading(true);
    const orCond = month ? `pay_month.eq.${month},pay_month.ilike.*${month}*` : undefined;
    let q = supabase
      .from('payrolls_secure')
      .select('id,employee_id,employee_name,pay_month,period_start,period_end,amount,total_pay,paid,paid_at,memo')
      .order('employee_name', { ascending: true })
      .order('pay_month', { ascending: false });
    if (orCond) q = q.or(orCond);
    if (!canViewAll && userId) q = q.eq('employee_id', userId);
    const { data } = await q;
    setRows((data as PayrollRow[]) ?? []);
    setLoading(false);
  }

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
              <option value="employee">직원별 집계</option>
              <option value="list">목록</option>
            </select>
          </div>

          <div className="ml-auto text-xs text-slate-600">
            선택 지급은 <b>관리자 전용</b>입니다.
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
          <EmployeeTable
            groups={toEmployeeGroups(filtered)}
            onDetail={(g) => openTimeline(g.employee_id, g.employee_name)}
          />
        ) : (
          <ListTable
            rows={filtered}
            edit={edit}
            isAdmin={isAdmin}
            setRowMemo={setRowMemo}
            setRowPaidDate={setRowPaidDate}
            saveMemo={saveMemo}
            openPaidModal={openPaidModal}
            canMarkPaid={() => true}
            onDelete={deleteRow}
          />
        )}
      </section>

      {/* ===== 지급완료 모달(단건) ===== */}
      {paidModal.open && (
        <Modal onClose={closePaidModal} title="지급완료">
          <div className="space-y-3">
            <div className="text-sm text-slate-700">지급일을 선택해 주세요.</div>
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
              <button className="btn bg-slate-900 text-white hover:bg-slate-800" onClick={confirmPaidModal}>지급완료</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ===== (신규) 직원 타임라인 모달 ===== */}
      {tl.open && (
        <Modal onClose={closeTimeline} title={`${tl.employee_name || '(미지정)'} — ${month} 타임라인`}>
          <div className="space-y-3">
            {/* 상단 컨트롤 */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600">체크한 항목만 선택 지급됩니다.</div>
              <div className="flex items-center gap-2">
                <label className="text-sm">
                  <input type="checkbox" className="checkbox mr-1" checked={tl.list.every(x => x.checked)} onChange={e => tlAll(e.target.checked)} />
                  전체선택
                </label>
                <label className="text-sm">
                  지급일:{' '}
                  <input type="date" className="input w-[150px] py-1" value={tl.payDate} onChange={e => setTl(s => ({ ...s, payDate: e.target.value }))} />
                </label>
              </div>
            </div>

            {/* 타임라인 표 (세로 스크롤) */}
            <div className="overflow-auto max-h-[70vh]">
              {tl.loading ? (
                <div className="p-4 text-sm text-slate-600">불러오는 중…</div>
              ) : tl.error ? (
                <div className="p-4 text-sm text-rose-700">{tl.error}</div>
              ) : tl.list.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">해당 월의 작업이 없습니다.</div>
              ) : (
                <table className="min-w-[820px] w-full text-sm">
                  <thead className="bg-sky-50/60 border-b border-sky-100">
                    <tr>
                      <Th className="w-[48px]">선택</Th>
                      <Th className="w-[150px]">날짜/시간</Th>
                      <Th>작업</Th>
                      <Th className="w-[240px]">주소</Th>
                      <Th className="text-right w-[120px]">일당</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {tl.list.map(x => (
                      <tr key={x.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <Td>
                          <input
                            type="checkbox"
                            className="checkbox"
                            checked={x.checked}
                            onChange={e => tlToggle(x.id, e.target.checked)}
                            disabled={!!x.off_day || !!x.paidDone}
                            title={
                              x.off_day
                                ? '휴무는 선택할 수 없습니다'
                                : (x.paidDone ? '이미 지급된 항목입니다' : '선택')
                            }
                          />
                        </Td>
                        <Td>
                          <div>{format(new Date(x.start_ts), 'yyyy-MM-dd')}</div>
                          <div className="text-[11px] text-slate-500">
                            {format(new Date(x.start_ts), 'HH:mm')} ~ {format(new Date(x.end_ts), 'HH:mm')}
                          </div>
                        </Td>
                        <Td className="whitespace-pre-line">
                          {x.title ?? '-'}
                          {x.paidDone && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-[2px] text-[11px]">
                              지급됨
                            </span>
                          )}
                        </Td>
                        <Td className="truncate">{x.site_address ?? '-'}</Td>
                        <Td className="text-right font-semibold">{fmtKRW(x.daily_wage)}</Td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-sky-50/40 border-t border-sky-100">
                    <tr>
                      <Td className="font-semibold">선택 합계</Td>
                      <Td colSpan={3} />
                      <Td className="text-right font-extrabold">{fmtKRW(tlSum)}</Td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* 액션 */}
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={closeTimeline}>닫기</button>
              <button
                className={`btn ${isAdmin ? 'bg-slate-900 text-white hover:bg-slate-800' : 'opacity-50 cursor-not-allowed'}`}
                onClick={createPayrollForSelected}
                disabled={!isAdmin || tl.saving || tlSelected.length === 0}
                title={isAdmin ? '' : '관리자 전용'}
              >
                선택 지급
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
                      <button className="btn" disabled={saving} onClick={() => saveMemo(r)} title="메모 저장">메모 저장</button>
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
            <Td className="font-extrabold text-right">{fmtKRW(sum(rows.map(r => toNum(r.total_pay ?? r.amount))) )}</Td>
            <Td colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ============ 직원별 집계 테이블(상세보기 추가) ============ */

function toEmployeeGroups(filtered: PayrollRow[]) {
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
    const pay = toNum(r.total_pay ?? r.amount);
    g.count += 1;
    g.total += pay;
    if (r.paid) g.paid += pay; else g.unpaid += pay;
  }
  return Array.from(map.values()).sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'ko'));
}

function EmployeeTable({
  groups, onDetail,
}: {
  groups: Array<{ employee_id: string | null; employee_name: string; count: number; total: number; paid: number; unpaid: number }>;
  onDetail: (g: { employee_id: string | null; employee_name: string }) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[860px] w-full text-sm">
        <thead className="bg-sky-50/60 border-b border-sky-100">
          <tr>
            <Th>직원</Th>
            <Th className="text-right">건수</Th>
            <Th className="text-right">총액</Th>
            <Th className="text-right">지급액</Th>
            <Th className="text-right">미지급액</Th>
            <Th className="w-[140px]">상세</Th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={`${g.employee_name}-${i}`} className="border-b border-slate-100 hover:bg-slate-50/60">
              <Td>{g.employee_name || '(미지정)'}</Td>
              <Td className="text-right">{g.count}</Td>
              <Td className="text-right font-semibold">{fmtKRW(g.total)}</Td>
              <Td className="text-right">{fmtKRW(g.paid)}</Td>
              <Td className="text-right">{fmtKRW(g.unpaid)}</Td>
              <Td>
                <button className="btn" onClick={() => onDetail(g)}>상세보기</button>
              </Td>
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
            <Td />
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
      <div className="relative w-[92vw] max-w-[980px] rounded-2xl bg-white shadow-2xl border border-slate-200 p-4">
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
function toNum(n: any): number { const x = Number(n ?? 0); return Number.isFinite(x) ? x : 0; }
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
