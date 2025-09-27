// FILE: app/payrolls/page.tsx
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
  pay_month: string | null;     // 'YYYY-MM' 또는 'YYYY-MM-part-...'
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

/* ================== 유틸 ================== */
const toNum = (v: any) => Number(v ?? 0) || 0;
const fmtKRW = (n: any) => {
  const x = toNum(n);
  try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(x); }
  catch { return `${Math.round(x).toLocaleString()}원`; }
};
const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const toISODateMid = (ymd: string) => {
  try {
    const [y, m, d] = ymd.split('-').map(Number);
    const local = new Date(y, (m ?? 1) - 1, d ?? 1, 9, 0, 0); // KST 09:00 가정
    return local.toISOString();
  } catch { return new Date().toISOString(); }
};
const formatMaybeDate = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso); return isNaN(+d) ? '-' : format(d, 'yyyy-MM-dd');
};
const formatMaybeDateTime = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso); return isNaN(+d) ? '-' : format(d, 'yyyy-MM-dd HH:mm');
};
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

/* [sched:1,2,3] 메모 파싱/포맷 */
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
// KST 기준 [from, to) 월 범위
function getMonthRangeKST(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const fromKst = new Date(Date.UTC(y, (m ?? 1) - 1, 1, -9, 0, 0)); // 이번달 1일 00:00 KST
  const toKst   = new Date(Date.UTC(y, (m ?? 1), 1, -9, 0, 0));     // 다음달 1일 00:00 KST
  return { from: fromKst.toISOString(), to: toKst.toISOString() };
}

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

      const adminIds = (process.env.NEXT_PUBLIC_ADMIN_IDS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      let envAdmin = (!!uid && adminIds.includes(uid)) || (!!email && adminEmails.includes(email));

      if (uid) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('is_admin,is_manager')
          .eq('id', uid)
          .maybeSingle();
        setIsManager(!!prof?.is_manager);
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
  async function reloadRows() {
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
  }

  useEffect(() => { reloadRows(); }, [month, canViewAll, userId]);

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

  /* ===== 직원 타임라인 모달 ===== */
  const [tl, setTl] = useState<{
    open: boolean;
    employee_id: string | null;
    employee_name: string;
    loading: boolean;
    list: Array<SchedRow & { checked: boolean; paidDone?: boolean }>;
    error: string | null;
    payDate: string;
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

  // ▼▼▼ 여기부터 전체 교체 ▼▼▼
// === 최종안: ID/이름/전체 월까지 한 번에 커버 (신규가입자 포함) ===
const openTimeline = async (employee_id: string | null, employee_name: string, silent?: boolean) => {
  if (!silent) setTl(s => ({ ...s, open: true }));
  setTl(s => ({ ...s, employee_id, employee_name, loading: true, list: [], error: null }));

  // 1) KST 월 경계 (해당 월 00:00 ~ 다음 달 00:00)
  const [yy, mm] = (month || '').split('-').map(Number);
  const FROM = new Date(Date.UTC(yy, (mm ?? 1) - 1, 1, -9, 0, 0)).toISOString();
  const TO   = new Date(Date.UTC(yy, (mm ?? 1),   1, -9, 0, 0)).toISOString();

  // 2) 공통 쿼리 빌더 (PostgREST or 필터 활용)
  function buildQuery(table: 'schedules_secure' | 'schedules', mode: 'id_name_or' | 'name_only' | 'all') {
    let q = supabase
      .from(table)
      .select('id,title,start_ts,end_ts,site_address,daily_wage,off_day,employee_id,employee_name')
      .gte('start_ts', FROM).lt('start_ts', TO)
      .order('start_ts', { ascending: true });

    const nm = (employee_name || '').trim();
    if (mode === 'id_name_or') {
      // ✅ 신규 가입자/키 불일치 방어:
      //  - employee_id 일치
      //  - 또는 employee_id가 NULL인 스케줄에서 employee_name (부분 일치) 매칭
      const parts: string[] = [];
      if (employee_id) parts.push(`employee_id.eq.${employee_id}`);
      if (nm) parts.push(`and(employee_id.is.null,employee_name.ilike.*${nm}*)`);
      if (parts.length) q = q.or(parts.join(','));
      return q;
    }
    if (mode === 'name_only') {
      if (nm) q = q.ilike('employee_name', `%${nm}%`);
      return q;
    }
    // mode === 'all' : 월 전체 (최후 폴백)
    return q;
  }

  try {
    // 3) 6단 폴백: secure(id|name or) → secure(name_only) → secure(all) → schedules(동일 순서)
    const attempts: Array<['schedules_secure'|'schedules','id_name_or'|'name_only'|'all']> = [
      ['schedules_secure','id_name_or'],
      ['schedules_secure','name_only'],
      ['schedules_secure','all'],
      ['schedules','id_name_or'],
      ['schedules','name_only'],
      ['schedules','all'],
    ];

    let data: any[] = [];
    let used: {table:'schedules_secure'|'schedules', mode:'id_name_or'|'name_only'|'all'} | null = null;

    for (const [table, mode] of attempts) {
      const r = await buildQuery(table, mode);
      const { data: rows, error } = await r;
      if (!error && rows && rows.length) { data = rows; used = { table, mode }; break; }
    }

    if (!data.length) {
      setTl(s => ({ ...s, loading: false, list: [], error: '표시할 일정이 없습니다.' }));
      return;
    }

    // 4) 이미 지급된 스케줄 ID 마킹 (월 기준; 직원 매칭 실패 시에도 정상 동작)
    let payQ = supabase.from('payrolls')
      .select('memo,paid,pay_month,employee_id,employee_name')
      .eq('paid', true);
    if (month) payQ = payQ.or(`pay_month.eq.${month},pay_month.ilike.*${month}*`);
    // 직원 매칭이 됐으면 그 범위로 좁히기 (불필요한 over-marking 방지)
    if (used?.mode !== 'all') {
      if (employee_id)      payQ = payQ.eq('employee_id', employee_id);
      else if (employee_name) payQ = payQ.ilike('employee_name', `%${employee_name}%`);
    }
    const { data: paidRows } = await payQ;
    const alreadyPaidIds = Array.from(new Set((paidRows ?? []).flatMap(r => {
      const m = String(r.memo ?? '').match(/\[sched:([0-9,\s]+)\]/);
      return m ? m[1].split(',').map(s => Number(s.trim())).filter(Number.isFinite) : [];
    })));

    // 5) 완료 플래그 조회 → 자동체크
    const ids = data.map((x:any) => Number(x.id)).filter(Number.isFinite);
    let completedMap = new Map<number, boolean>();
    if (ids.length) {
      const { data: flags } = await supabase.from('schedules').select('id,completed').in('id', ids);
      completedMap = new Map((flags ?? []).map((f:any)=>[Number(f.id), !!f.completed]));
    }

    const list = data.map((x:any) => {
      const id = Number(x.id);
      const paidDone = alreadyPaidIds.includes(id);
      const completed = completedMap.get(id) ?? false;
      return {
        id,
        title: x.title ?? null,
        start_ts: x.start_ts,
        end_ts: x.end_ts,
        site_address: x.site_address ?? null,
        daily_wage: Number(x.daily_wage ?? 0),
        off_day: !!x.off_day,
        employee_id: x.employee_id ?? null,
        employee_name: x.employee_name ?? null,
        checked: completed && !paidDone && !x.off_day,
        paidDone,
      };
    });

    // 6) 폴백 모드 안내(필요 시만)
    const msg =
      used?.mode === 'all'
        ? `※ 직원 매칭이 불명확해 ${month}월 전체 일정을 표시합니다.`
        : used?.mode === 'name_only'
        ? `※ ID가 없어 이름으로 매칭했습니다. 직원 프로필/급여의 ID를 확인하세요.`
        : null;

    setTl(s => ({ ...s, list, loading: false, error: msg || null }));
  } catch (e:any) {
    setTl(s => ({ ...s, loading: false, error: e?.message || '불러오기 실패' }));
  }
};

// ▲▲▲ 여기까지 전체 교체 ▲▲▲


  const closeTimeline = () => setTl(s => ({ ...s, open: false, list: [] }));

  const tlToggle = (id: number, v: boolean) =>
    setTl(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, checked: v } : x)) }));

  const tlAll = (v: boolean) =>
    setTl(s => ({
      ...s,
      list: s.list.map(x => ({
        ...x,
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

  // ✅ 선택 지급(부분지급 + 차감 + 중복방지)
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

    // 선택 스케줄 ID/금액 맵
    const selectedIds = tlSelected.map(x => x.id);
    const wageMap = new Map<number, number>(tlSelected.map(x => [x.id, Number(x.daily_wage ?? 0)]));
    const sumByIds = (ids:number[]) => ids.reduce((s,id)=>s+(wageMap.get(id) ?? 0), 0);

    setTl(s => ({ ...s, saving: true }));
    try {
      // 1) 같은 직원/월 전체 급여(미지급/지급완료) 조회
      let baseQ = supabase
        .from('payrolls')
        .select('id,paid,total_pay,memo,period_start,period_end,pay_month,employee_id,employee_name');

      if (pay_month_base) baseQ = baseQ.or(`pay_month.eq.${pay_month_base},pay_month.ilike.*${pay_month_base}*`);
      if (employee_id) baseQ = baseQ.eq('employee_id', employee_id);
      else baseQ = baseQ.ilike('employee_name', employee_name ?? '');

      const { data: sameMonthRows, error: queryErr } = await baseQ;
      if (queryErr) throw queryErr;

      const paidRows = (sameMonthRows ?? []).filter(r => r.paid);
      const unpaidRow = (sameMonthRows ?? []).find(r => !r.paid) as any | undefined;

      // 2) 이미 지급된 ID 제외
      const alreadyPaidIds = Array.from(new Set(paidRows.flatMap(r => parseSchedIdsFromMemo(r.memo))));
      const payIdsFiltered = selectedIds.filter(id => !alreadyPaidIds.includes(id));
      if (payIdsFiltered.length === 0) {
        alert('선택한 항목이 이미 모두 지급 처리됐습니다.');
        setTl(s => ({ ...s, saving:false }));
        return;
      }

      // 3) 미지급 차감: memo 태그가 없더라도 정확히 계산
      if (unpaidRow) {
        const unpaidIdsTagged = parseSchedIdsFromMemo(unpaidRow.memo); // 없을 수 있음
        // 태그가 있으면 태그 기반, 없으면 “이번 지급 대상”으로만 차감(이미지급분은 제외됨)
        const willDeductIds = unpaidRow.memo
          ? payIdsFiltered.filter(id => unpaidIdsTagged.includes(id))
          : payIdsFiltered;

        const deductAmount = sumByIds(willDeductIds);
        const remainIds = unpaidRow.memo
          ? unpaidIdsTagged.filter(id => !willDeductIds.includes(id))
          : [];

        const newUnpaidTotal = Math.max(0, Number(unpaidRow.total_pay ?? 0) - deductAmount);

        if (remainIds.length === 0 || newUnpaidTotal <= 0) {
          const { error: delErr } = await supabase.from('payrolls').delete().eq('id', unpaidRow.id);
          if (delErr) throw delErr;
        } else {
          const baseMemo = unpaidRow.memo ? unpaidRow.memo.replace(/\[sched:[^\]]*\]/, '').trim() : '';
          const newMemo = `${baseMemo ? baseMemo + '\n' : ''}${formatSchedIdsTag(remainIds)}`;
          const { error: updErr } = await supabase
            .from('payrolls')
            .update({ total_pay:newUnpaidTotal, amount:newUnpaidTotal, memo:newMemo })
            .eq('id', unpaidRow.id);
          if (updErr) throw updErr;
        }
      }

      
      // 4) 지급완료 레코드 생성 (pay_month는 'YYYY-MM' 그대로 사용; 부분지급은 기존 paid 레코드에 누적)
      const payAmount = sumByIds(payIdsFiltered);
      if (payAmount <= 0) { alert('지급 금액이 0원입니다.'); setTl(s => ({ ...s, saving:false })); return; }
      const memoTag = formatSchedIdsTag(payIdsFiltered);

      // 기존 paid 레코드가 있으면 누적 업데이트, 없으면 신규 insert
      let paidBaseQ = supabase
        .from('payrolls')
        .select('id,memo,total_pay,amount,paid_at')
        .eq('paid', true)
        .eq('pay_month', pay_month_base)
        .limit(1);

      if (employee_id) paidBaseQ = paidBaseQ.eq('employee_id', employee_id);
      else paidBaseQ = paidBaseQ.is('employee_id', null).ilike('employee_name', employee_name ?? '');

      const { data: existPaidRows, error: existPaidErr } = await paidBaseQ;
      if (existPaidErr) throw existPaidErr;

      if (existPaidRows && existPaidRows.length > 0) {
        const cur = existPaidRows[0] as any;
        const baseMemo = (cur.memo ?? '').replace(/\[sched:[^\]]*\]/g, '').trim();
        const newMemo  = `${baseMemo ? baseMemo + '\n' : ''}${memoTag}`;
        const { error: updPaidErr } = await supabase
          .from('payrolls')
          .update({
            total_pay: Number(cur.total_pay ?? 0) + payAmount,
            amount:    Number(cur.amount ?? 0)    + payAmount,
            memo: newMemo,
            paid_at, // 최근 지급일로 갱신
          })
          .eq('id', cur.id);
        if (updPaidErr) throw updPaidErr;
      } else {
        const { error: insErr } = await supabase.from('payrolls').insert({
          employee_id,
          employee_name,
          pay_month: pay_month_base,        // ★ 'YYYY-MM' 그대로
          period_start: period_start_sel,
          period_end: period_end_sel,
          total_pay: payAmount,
          amount: payAmount,
          paid: true,
          paid_at,
          memo: `[선택지급] ${employee_name ?? ''} ${pay_month_base} / ${payIdsFiltered.length}건\n${memoTag}`,
        });
        if (insErr) throw insErr;
      }


      // 5) 성공 후 급여 리스트 갱신 + 타임라인 즉시 새로고침(=지급된 건은 곧바로 비활성 표시)
      await reloadRows();
      await openTimeline(tl.employee_id, tl.employee_name, true);
    } catch (e: any) {
      setMsg(`선택 지급 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setTl(s => ({ ...s, saving: false }));
    }
  };

  /* ===== 실시간 동기화 ===== */
  const [tlStateKey, setTlStateKey] = useState(0); // 타임라인 강제 리프레시 트리거
  useEffect(() => {
    const ch1 = supabase
      .channel('payrolls-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payrolls' }, () => {
        reloadRows();
        setTlStateKey(k => k + 1);
      })
      .subscribe();
    const ch2 = supabase
      .channel('schedules-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => {
        setTlStateKey(k => k + 1);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 실시간 변경 시 열린 타임라인 갱신
  useEffect(() => {
    if (tl.open) openTimeline(tl.employee_id, tl.employee_name, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tlStateKey]);

  /* ====== UI ====== */
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

      {/* 컨트롤바 */}
      <div className="card border-sky-100 ring-1 ring-sky-100/70 shadow-[0_6px_16px_rgba(2,132,199,0.08)]">
        {/* 📱 모바일 */}
        <div className="sm:hidden">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">월 선택</label>
              <input type="month" className="input h-8 px-2 text-[13px] w-full" value={month} onChange={e => setMonth(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">보기</label>
              <select className="select h-8 px-2 text-[13px] w-full" value={mode} onChange={e => setMode(e.target.value as any)}>
                <option value="employee">직원별 집계</option>
                <option value="list">목록</option>
              </select>
            </div>
          </div>

          <div className="mt-2">
            <label className="block text-[11px] text-slate-600 mb-1">
              직원 필터
              {(profilesLoading || profilesErr) && (
                <span className="ml-1 text-[10px] text-slate-500 align-middle">
                  {profilesLoading ? '불러오는 중…' : `오류: ${profilesErr}`}
                </span>
              )}
            </label>
            <select className="select h-8 px-2 text-[13px] w-full" value={empFilter} onChange={e => setEmpFilter(e.target.value)}>
              {empOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>

          <div className="mt-2 text-[11px] text-slate-600 text-right">
            선택 지급은 <b>관리자 전용</b>입니다.
          </div>
        </div>

        {/* 🖥️ 데스크탑/태블릿 */}
        <div className="hidden sm:flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-slate-600 mb-1">월 선택</label>
            <input type="month" className="input w-[160px]" value={month} onChange={e => setMonth(e.target.value)} />
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
          <>
            {/* 📱 모바일 카드 */}
            <div className="sm:hidden">
              <MobileEmployeeCards
                groups={toEmployeeGroups(filtered)}
                onDetail={(g) => openTimeline(g.employee_id, g.employee_name)}
              />
            </div>
            {/* 🖥️ 데스크탑 테이블 */}
            <div className="hidden sm:block">
              <EmployeeTable
                groups={toEmployeeGroups(filtered)}
                onDetail={(g) => openTimeline(g.employee_id, g.employee_name)}
              />
            </div>
          </>
        ) : (
          <>
            {/* 📱 모바일 카드 */}
            <div className="sm:hidden">
              <MobileListCards
                rows={filtered}
                isAdmin={isAdmin}
                edit={edit}
                setRowMemo={setRowMemo}
                setRowPaidDate={setRowPaidDate}
                saveMemo={saveMemo}
                openPaidModal={openPaidModal}
                onDelete={deleteRow}
              />
            </div>
            {/* 🖥️ 데스크탑 테이블 */}
            <div className="hidden sm:block">
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
            </div>
          </>
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
                className="input w-[170px] py-1"
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
                  <input type="checkbox" className="checkbox mr-1" checked={tl.list.every(x => x.checked || x.off_day || x.paidDone)} onChange={e => tlAll(e.target.checked)} />
                  전체선택
                </label>
                <label className="text-sm">
                  지급일:{' '}
                  <input type="date" className="input w-[150px] py-1" value={tl.payDate} onChange={e => setTl(s => ({ ...s, payDate: e.target.value }))} />
                </label>
              </div>
            </div>

            {/* 📱 모바일: 카드 리스트 */}
            <div className="sm:hidden">
              <div className="max-h-[calc(100vh-220px)] overflow-auto pr-1">
                {tl.loading ? (
                  <div className="p-4 text-sm text-slate-600">불러오는 중…</div>
                ) : tl.error ? (
                  <div className="p-4 text-sm text-rose-700">{tl.error}</div>
                ) : tl.list.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">해당 월의 작업이 없습니다.</div>
                ) : (
                  <div className="space-y-2">
                    {tl.list.map(x => (
                      <div key={x.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                        <div className="flex items-start justify-between gap-3">
                          <label className="mt-[2px]">
                            <input
                              type="checkbox"
                              className="checkbox"
                              checked={!!x.checked}
                              onChange={e => tlToggle(x.id, e.target.checked)}
                              disabled={!!x.off_day || !!x.paidDone}
                              title={x.off_day ? '휴무는 선택 불가' : (x.paidDone ? '이미 지급됨' : '선택')}
                            />
                          </label>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-[13px] font-semibold">
                                {format(new Date(x.start_ts), 'yyyy-MM-dd')}
                                <span className="ml-2 text-[12px] text-slate-500">
                                  {format(new Date(x.start_ts), 'HH:mm')}~{format(new Date(x.end_ts), 'HH:mm')}
                                </span>
                              </div>
                              {x.off_day && (
                                <span className="inline-flex items-center rounded-full border border-slate-300 text-slate-700 bg-slate-50 px-2 py-[1px] text-[11px]">휴무</span>
                              )}
                              {x.paidDone && (
                                <span className="inline-flex items-center rounded-full border border-emerald-200 text-emerald-700 bg-emerald-50 px-2 py-[1px] text-[11px]">지급됨</span>
                              )}
                            </div>
                            <div className="mt-1 text-[13px] text-slate-800 whitespace-pre-line">{x.title ?? '-'}</div>
                            <div className="mt-1 text-[12px] text-slate-500 truncate">{x.site_address ?? '-'}</div>
                          </div>
                          <div className="text-right text-[13px] font-semibold shrink-0">{fmtKRW(x.daily_wage)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 하단 고정 바 */}
              <div className="sticky bottom-0 left-0 right-0 mt-3">
                <div className="rounded-2xl border border-sky-200 bg-sky-50/70 px-3 py-2 flex items-center justify-between">
                  <div className="text-[13px]">선택 합계 <b className="ml-1">{fmtKRW(tlSum)}</b></div>
                  <div className="flex items-center gap-2">
                    <button className="btn text-[13px] py-1" onClick={closeTimeline}>닫기</button>
                    <button
                      className={`btn text-[13px] py-1 ${isAdmin && tlSelected.length > 0 ? 'bg-slate-900 text-white hover:bg-slate-800' : 'opacity-50 cursor-not-allowed'}`}
                      onClick={createPayrollForSelected}
                      disabled={!isAdmin || tl.saving || tlSelected.length === 0}
                      title={isAdmin ? '' : '관리자 전용'}
                    >
                      선택 지급
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 🖥️ 데스크탑/태블릿 */}
            <div className="hidden sm:block">
              <div className="overflow-auto max-h-[70vh]">
                {tl.loading ? (
                  <div className="p-4 text-sm text-slate-600">불러오는 중…</div>
                ) : tl.error ? (
                  <div className="p-4 text-sm text-rose-700">{tl.error}</div>
                ) : tl.list.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">해당 월의 작업이 없습니다.</div>
                ) : (
                  <table className="min-w-[820px] w-full text-sm">
                    <thead className="bg-sky-50/60 border-b border-sky-100 sticky top-0 z-10">
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
                              title={x.off_day ? '휴무는 선택할 수 없습니다' : (x.paidDone ? '이미 지급된 항목입니다' : '선택')}
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
                    <tfoot className="bg-sky-50/40 border-t border-sky-100 sticky bottom-0">
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
              <div className="flex justify-end gap-2 mt-3">
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
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============ 목록 테이블(행별 편집, 데스크탑) ============ */
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
      <table className="min-w-[920px] w-full text-[13px] table-fixed">
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

/* ============ 직원별 집계 테이블(상세보기 추가, 데스크탑) ============ */
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
      <table className="min-w/[600px] w-full text-sm">
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

/* ===== 📱 모바일 카드 컴포넌트 ===== */
function MobileEmployeeCards({
  groups, onDetail,
}: {
  groups: Array<{ employee_id: string | null; employee_name: string; count: number; total: number; paid: number; unpaid: number }>;
  onDetail: (g: { employee_id: string | null; employee_name: string }) => void;
}) {
  return (
    <div className="space-y-2 p-2">
      {groups.map((g, i) => (
        <div key={`${g.employee_name}-${i}`} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold">{g.employee_name || '(미지정)'}</div>
            <button className="text-[12px] px-2 py-1 rounded-lg border hover:bg-slate-50" onClick={() => onDetail(g)}>상세보기</button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-y-1 text-[12px] text-slate-700">
            <div>건수</div><div className="col-span-2 text-right">{g.count}</div>
            <div>총액</div><div className="col-span-2 text-right font-semibold">{fmtKRW(g.total)}</div>
            <div>지급액</div><div className="col-span-2 text-right">{fmtKRW(g.paid)}</div>
            <div>미지급</div><div className="col-span-2 text-right">{fmtKRW(g.unpaid)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MobileListCards({
  rows, isAdmin, edit, setRowMemo, setRowPaidDate, saveMemo, openPaidModal, onDelete,
}: {
  rows: PayrollRow[];
  isAdmin: boolean;
  edit: Record<string | number, { memo: string; paidDate: string; saving?: boolean }>;
  setRowMemo: (id: string | number, memo: string) => void;
  setRowPaidDate: (id: string | number, paidDate: string) => void;
  saveMemo: (row: PayrollRow) => Promise<void>;
  openPaidModal: (row: PayrollRow) => void;
  onDelete: (row: PayrollRow) => Promise<void>;
}) {
  return (
    <div className="space-y-2 p-2">
      {rows.map(r => {
        const st = edit[r.id] ?? { memo: r.memo ?? '', paidDate: '' };
        const saving = !!st.saving;
        return (
          <div key={String(r.id)} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <div className="flex items-center justify-between">
              <div className="text-[14px] font-semibold">{r.employee_name || (r.employee_id ? `ID:${r.employee_id}` : '-')}</div>
              <div className="text-[12px]">{r.paid ? '지급완료' : '미지급'}</div>
            </div>
            <div className="mt-1 text-[12px] text-slate-700 space-y-1">
              <div className="flex justify-between"><span>월</span><span>{r.pay_month ?? '-'}</span></div>
              <div className="flex justify-between"><span>기간</span><span>{formatMaybeDate(r.period_start)} ~ {formatMaybeDate(r.period_end)}</span></div>
              <div className="flex justify-between"><span>지급일</span><span>{formatMaybeDateTime(r.paid_at)}</span></div>
              <div className="flex justify-between font-semibold"><span>금액</span><span>{fmtKRW(r.total_pay ?? r.amount)}</span></div>
            </div>

            {/* 메모/액션 */}
            <div className="mt-2 space-y-2">
              <textarea
                className="w-full rounded-xl border px-2 py-1 text-[12px]"
                rows={2}
                disabled={!isAdmin}
                value={st.memo}
                onChange={e => setRowMemo(r.id, e.target.value)}
                placeholder="메모"
              />
              {isAdmin && (
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="date"
                    className="input w-[140px] py-1 text-[12px]"
                    value={st.paidDate}
                    onChange={e => setRowPaidDate(r.id, e.target.value)}
                    title="지급일"
                  />
                  <div className="flex items-center gap-2">
                    <button className="btn text-[12px] py-1" disabled={saving} onClick={() => saveMemo(r)}>메모 저장</button>
                    <button className="btn text-[12px] py-1 bg-slate-900 text-white hover:bg-slate-800" disabled={saving} onClick={() => openPaidModal(r)}>지급완료</button>
                    <button className="btn text-[12px] py-1 border-rose-300 text-rose-700 hover:bg-rose-50" disabled={saving} onClick={() => onDelete(r)}>삭제</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ===== 공통 모달 컴포넌트 ===== */
function Modal({
  title, children, onClose,
}: {
  title?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-screen h-screen rounded-none p-3 sm:w-[92vw] sm:max-w-[980px] sm:rounded-2xl sm:p-4 sm:h-auto sm:max-h-[90vh] bg-white shadow-2xl border border-slate-200 overflow-auto">
        <div className="sticky top-0 bg-white pb-2 z-10 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h2 className="text;base font-semibold text-slate-900 truncate">{title ?? 'Modal'}</h2>
            <button className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

/* ============ 공통 소품/유틸 ============ */
function Th(props: React.ThHTMLAttributes<HTMLTableHeaderCellElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <th {...rest} className={`px-1 py-1 text-left text-[13px] font-semibold text-sky-900 ${className}`}>
      {children}
    </th>
  );
}
function Td(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <td {...rest} className={`px-1 py-1 align-top ${className}`}>
      {children}
    </td>
  );
}
