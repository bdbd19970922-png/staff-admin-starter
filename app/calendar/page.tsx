// FILE: /app/calendar/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

import {
  addDays, addMonths, endOfMonth, endOfWeek, format as fmt,
  isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths,
  parseISO,
} from 'date-fns';

/* ================== 타입 ================== */
type Row = {
  id: number;
  title: string | null;
  start_ts: string | null;
  end_ts: string | null;

  // 단일(옛 컬럼)
  employee_id?: string | null;
  employee_name?: string | null;

  // 다중(신규 컬럼: 선택 사항)
  employee_names?: string[] | null;

  // 휴무(신규 컬럼: 선택 사항)
  off_day?: boolean | null;

  customer_name?: string | null;
  customer_phone?: string | null;
  site_address?: string | null;
  revenue?: number | null;
  material_cost?: number | null;
  daily_wage?: number | null;
  extra_cost?: number | null;

  // (선택) DB 뷰에서 내려올 수 있음 — 안 쓰더라도 받아두면 타입 에러 방지
  net_profit_visible?: number | null;
};

type DayCellItem = {
  id: number;
  title: string;
  emp?: string;     // 렌더링용 직원 문자열 (A, B)
  netText?: string; // 관리자용
  isOff?: boolean;  // 휴무
  isTeam?: boolean; // 공동작업(여러 명)
};

type DayCell = { date: Date; items: DayCellItem[] };

type EmpOption = { key: string; label: string };
type ProfileName = { id: string; full_name: string | null };

/* ================== 페이지 컴포넌트 ================== */
export default function Page() {
  const [baseDate, setBaseDate] = useState(new Date());
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string|null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedEmp, setSelectedEmp] = useState<string>('all');

  // 빠른 추가 모달
  const [showAdd, setShowAdd] = useState<{open:boolean; date: Date | null}>({open:false, date:null});
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // 특정 날짜 상세 모달
  const [showDay, setShowDay] = useState<{open:boolean; date: Date | null}>({open:false, date:null});

  // 상세 보기/수정 모달
  const [viewId, setViewId] = useState<number | null>(null);

  // 관리자/재무컬럼 유무
  const [isAdmin, setIsAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [hasFinanceCols, setHasFinanceCols] = useState<boolean | null>(null); // null=미확인

  // “여러 직원”/“휴무” 사용 가능 여부(컬럼 존재 탐지)
  const [supportsMultiEmp, setSupportsMultiEmp] = useState<boolean>(false);
  const [supportsOff, setSupportsOff] = useState<boolean>(false);

  // 입력 폼 상태 (종료시간 제거)
  const [form, setForm] = useState<{
    title: string;
    empNames: string[];   // ✅ 여러 명
    customerName: string;
    customerPhone: string;
    siteAddress: string;
    start: string;
    total: number;
    revenue: number;
    material: number;
    wage: number;
    extra: number;
    offDay: boolean;      // ✅ 휴무
  }>({
    title: '',
    empNames: [],
    customerName: '', customerPhone: '', siteAddress: '',
    start: '',
    total: 0, revenue: 0, material: 0, wage: 0, extra: 0,
    offDay: false,
  });

  // 직원 마스터 목록(회원가입 시 프로필에서 자동 등록된 이름)
  const [empMasterNames, setEmpMasterNames] = useState<string[]>([]);
  // 검색어(추가/수정 모달용)
  const [empSearch, setEmpSearch] = useState<string>('');
  const [empEditSearch, setEmpEditSearch] = useState<string>('');
  const [myName, setMyName] = useState<string>('');
  /* ====== 관리자 판별 + 내 이름 로드 ====== */
useEffect(() => {
  (async () => {
    const adminIds = (process.env.NEXT_PUBLIC_ADMIN_IDS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? '';
    const email = (session?.user?.email ?? '').toLowerCase();

    // 1) 환경변수 관리자
    let elevated =
      (!!uid && adminIds.includes(uid)) ||
      (!!email && adminEmails.includes(email));

    // 2) 프로필 기반 관리자/매니저 & 내 이름
    if (uid) {
      const { data: me } = await supabase
        .from('profiles')
        .select('full_name, is_admin, is_manager')
        .eq('id', uid)
        .maybeSingle();

       if (me?.is_admin) setIsAdmin(true);
       if (me?.is_manager) setIsManager(true); // ← 매니저 플래그 반영

      // 🔑 내 이름을 반드시 저장 (프런트 필터용)
      const fallback = (session?.user?.email?.split('@')[0] ?? '').trim();
      setMyName(((me?.full_name ?? '') || fallback).trim());
    } else {
      setMyName((session?.user?.email?.split('@')[0] ?? '').trim());
    }

    setIsAdmin(!!elevated); // 매니저도 관리자처럼 취급
  })();
}, []);


  /* ====== 달력 범위 ====== */
  const monthStart = startOfMonth(baseDate);
  const monthEnd   = endOfMonth(baseDate);
  const gridStart  = startOfWeek(monthStart);
  const gridEnd    = endOfWeek(monthEnd);

    /* ====== 데이터 로드 (권한/내이름 기반 서버측 필터 적용) ====== */
  const load = async () => {
    setLoading(true);
    setMsg(null);

    try {
      // 직원/일반 모드에서 내 이름 필요
      const me = (myName ?? '').trim();

      // 직원 모드인데 아직 내 이름을 못 가져온 상태면 불러오지 않음
      if (!isAdmin && !me) {
        setRows([]);
        setLoading(false);
        return;
      }

     const sel1 =
  'id,title,start_ts,end_ts,employee_id,employee_name,employee_names,off_day,customer_name,customer_phone,site_address,revenue,daily_wage,extra_cost,material_cost_visible,net_profit_visible';

// 기본 쿼리: 뷰에서 읽기
let query = supabase
  .from('schedules_secure')
  .select(sel1)
  .order('start_ts', { ascending: true });

// ✅ 직원(비관리자, 즉 관리자·매니저가 아닌 경우)만 내 일정 필터링
if (!(isAdmin || isManager)) {
  const esc = me.replace(/([{}%,])/g, ''); // 간단 이스케이프
  query = query.or(`employee_names.cs.{${esc}},employee_name.ilike.%${esc}%`);
}

let { data, error } = await query.returns<Row[]>();

if (error) {
  // 2차: 안전 컬럼만
  setHasFinanceCols(false);
  setSupportsMultiEmp(false);
  setSupportsOff(false);

  const sel2 =
    'id,title,start_ts,end_ts,employee_id,employee_name,customer_name,customer_phone,site_address';

  let q2 = supabase
    .from('schedules_secure')
    .select(sel2)
    .order('start_ts', { ascending: true });

  if (!(isAdmin || isManager)) {
    const esc = me.replace(/([{}%,])/g, '');
    q2 = q2.or(`employee_names.cs.{${esc}},employee_name.ilike.%${esc}%`);
  }

  const fallback = await q2.returns<Row[]>();
  data = fallback.data ?? [];
  error = fallback.error;
} else {
  // 정상 로드 성공 시 처리
        // ✅ 컬럼 지원 여부 판별
        setHasFinanceCols(true);
        const hasMulti = !!(data && (Array.isArray(data[0]?.employee_names) || data.some(r => Array.isArray(r.employee_names))));
        const hasOff   = !!(data && (typeof data[0]?.off_day === 'boolean' || data.some(r => typeof r.off_day === 'boolean')));
        setSupportsMultiEmp(hasMulti);
        setSupportsOff(hasOff);
      }

      if (error) {
        setMsg(`불러오기 오류: ${error.message}`);
        setRows([]);
      } else {
        setRows(data ?? []);
      }

      // 2) 직원 마스터 로드
      await loadProfiles();
    } catch (e: any) {
      setMsg(`불러오기 오류: ${e?.message ?? String(e)}`);
      setRows([]);
      setHasFinanceCols(false);
      setSupportsMultiEmp(false);
      setSupportsOff(false);
    } finally {
      setLoading(false);
    }
  };


  const loadProfiles = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .order('full_name', { ascending: true })
        .returns<ProfileName[]>();

    }
    catch (e) {
      // noop
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .order('full_name', { ascending: true })
        .returns<ProfileName[]>();

      if (!error && data) {
        const names = data
          .map(p => (p.full_name ?? '').trim())
          .filter(Boolean);
        setEmpMasterNames(names);
      } else if (error) {
        console.warn('profiles read error:', error.message);
      }
    } catch (e) {
      console.warn('profiles load failed:', e);
    }
  };

    // 권한/내이름 준비 후 로드
  useEffect(() => { 
    load(); 
  }, [isAdmin, myName]);


  // Realtime - schedules (원본 테이블에서 변경 발생 시 새로 불러오기)
  useEffect(() => {
    const channel = supabase
      .channel('calendar-schedules')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Realtime - profiles (직원 가입/이름변경 시 즉시 드롭다운 갱신)
  useEffect(() => {
    const channel = supabase
      .channel('profiles-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        loadProfiles();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  /* ====== 상단 직원 필터 옵션 (✅ 이름만) ====== */
  const empNameListFromRows = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];

    const pushName = (nm: string | null | undefined) => {
      const raw = (nm ?? '').trim();
      if (!raw) return;
      const k = raw.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(raw); }
    };

    for (const r of rows) {
      // 새 컬럼이 있으면 거기서 모두 수집
      if (Array.isArray(r.employee_names) && r.employee_names.length > 0) {
        r.employee_names.forEach(n => pushName(n));
      } else {
        // 폴백: 쉼표로 분리
        const csv = (r.employee_name ?? '').split(',').map(s => s.trim()).filter(Boolean);
        if (csv.length) csv.forEach(n => pushName(n));
      }
    }
    return out.sort((a,b)=>a.localeCompare(b,'ko'));
  }, [rows]);

  const empNameList = useMemo(() => {
    return (empMasterNames.length > 0 ? uniqueNames([...empMasterNames, ...empNameListFromRows]) : empNameListFromRows);
  }, [empMasterNames, empNameListFromRows]);

  const empOptions: EmpOption[] = useMemo(() => {
    const list = empNameList.map(name => ({
      key: `name::${name.toLowerCase()}`,
      label: name,
    }));
    return [{ key: 'all', label: '전체 직원' }, ...list];
  }, [empNameList]);

  /* ====== 상단 직원 필터 적용 ====== */
  const filteredRows = useMemo(() => {
    if (selectedEmp === 'all') return rows;
    if (selectedEmp.startsWith('name::')) {
      const norm = selectedEmp.slice('name::'.length);
      return rows.filter(r => {
        const names = effectiveNames(r);
        return names.some(nm => nm.toLowerCase() === norm);
      });
    }
    return rows;
  }, [rows, selectedEmp]);

  /* ====== 달력 6주(42칸) 셀 데이터 ====== */
  const days: DayCell[] = useMemo(() => {
    const out: DayCell[] = [];
    let cur = new Date(gridStart);
    while (cur <= gridEnd) {
      const items: DayCellItem[] = filteredRows
        .filter(r => {
          const s = safeParse(r.start_ts);
          const e = r.end_ts ? safeParse(r.end_ts) : s; // 종료 없으면 시작과 동일
          if (!s || !e) return false;
          return isWithin(s, e, cur);
        })
        .map(r => {
          const net = calcNet(r);
          const names = effectiveNames(r);
          const empStr = names.join(', ');
          const isOff = effectiveOff(r);
          const isTeam = names.length >= 2;

          return {
            id: r.id,
            title: r.title ?? (isOff ? '휴무' : '(제목없음)'),
            emp: empStr || undefined,
            isOff,
            isTeam,
            // ✅ 관리자에게만 순익 힌트 표시 (뷰가 값 마스킹하므로 여기선 단순 존재 체크)
            netText: isAdmin && net != null ? `순익 ${formatKRW(net)}` : undefined,
          };
        });
      out.push({ date: cur, items });
      cur = addDays(cur, 1);
    }
    return out;
  }, [gridStart, gridEnd, filteredRows, isAdmin]);

  /* ====== 날짜 핸들러 ====== */
  const openAddForDate = (d: Date) => {
    const start = toLocal(new Date(new Date(d).setHours(9,0,0,0)));
    setForm({
      title: '',
      empNames: [],
      customerName: '', customerPhone: '', siteAddress: '',
      start,
      total: 0, revenue: 0, material: 0, wage: 0, extra: 0,
      offDay: false,
    });
    setEmpSearch('');
    setDetailsOpen(false);
    setShowAdd({ open: true, date: d });
  };

  const openDayDetail = (d: Date) => setShowDay({ open: true, date: d });
  const closeDayDetail = () => setShowDay({ open: false, date: null });

  // 일정 클릭 → 상세/수정 모달
  const openViewById = (id: number) => setViewId(id);
  const closeView = () => setViewId(null);

  /* ====== 신규 저장 ====== */
  const saveNew = async () => {
    if (!showAdd.date) return;
    setSaving(true);
    setMsg(null);

    const startISO = fromLocal(form.start);
    const endISO   = startISO; // 종료시간 없음

    // “여러 직원” 저장 로직: 신컬럼 우선, 없으면 employee_name에 CSV로 저장
    const empNames = (form.empNames ?? []).map(s => s.trim()).filter(Boolean);
    const legacyEmpName = empNames.join(', '); // 폴백용 CSV

    const fullPayload: Record<string, any> = {
      title: (form.title.trim() || (form.offDay ? '휴무' : '(제목없음)')),
      start_ts: startISO,
      end_ts: endISO,
      customer_name: form.customerName.trim() || null,
      customer_phone: form.customerPhone.trim() || null,
      site_address: form.siteAddress.trim() || null,
      revenue: num(form.total),        // 총작업비 = 총매출
      material_cost: num(form.material),
      daily_wage: num(form.wage),
      extra_cost: num(form.extra),
    };

    // 직원
    if (supportsMultiEmp) {
      fullPayload.employee_names = empNames.length ? empNames : null;
      fullPayload.employee_name = empNames.length === 1 ? empNames[0] : (empNames.length ? legacyEmpName : null);
    } else {
      // 폴백: employee_name CSV
      fullPayload.employee_name = empNames.length ? legacyEmpName : null;
    }

    // 휴무
    if (supportsOff) fullPayload.off_day = !!form.offDay;
    else {
      // 폴백: 제목이 '휴무'로 시작하면 휴무 취급
      if (form.offDay && !String(fullPayload.title).startsWith('휴무')) {
        fullPayload.title = `휴무 - ${fullPayload.title}`;
      }
    }

    // 1차: 전체 컬럼 시도 (쓰기이므로 원본 테이블)
    let { error } = await supabase.from('schedules').insert(fullPayload);
    if (error) {
      // 2차: 안전 최소 컬럼
      const safeKeys = ['title','start_ts','end_ts','employee_name','customer_name','customer_phone','site_address'];
      const safePayload: Record<string, any> = {};
      for (const k of safeKeys) safePayload[k] = fullPayload[k];
      const retry = await supabase.from('schedules').insert(safePayload);
      if (retry.error) setMsg(`등록 오류: ${retry.error.message}`);
    }

    setSaving(false);
    setShowAdd({ open:false, date:null });
  };

  /* ====== 선택된 일정(상세) ====== */
  const selectedRow = useMemo(() => {
    if (viewId == null) return null;
    const r = rows.find(x => x.id === viewId) || null;
    return r;
  }, [viewId, rows]);

  /* ====== 특정 날짜의 아이템 리스트(모달용) ====== */
  const dayItems = useMemo(() => {
    if (!showDay.open || !showDay.date) return [];
    const date = showDay.date;
    return rows.filter(r => {
      const s = safeParse(r.start_ts);
      const e = r.end_ts ? safeParse(r.end_ts) : s;
      if (!s || !e) return false;
      return isWithin(s, e, date);
    }).sort((a,b) => (a.start_ts ?? '').localeCompare(b.start_ts ?? ''));
  }, [showDay, rows]);

  /* ====== 직원 검색 필터링(추가/수정) ====== */
  const filteredEmpForAdd = useMemo(() => {
    const q = (empSearch ?? '').trim().toLowerCase();
    if (!q) return empNameList;
    return empNameList.filter(nm => nm.toLowerCase().includes(q));
  }, [empSearch, empNameList]);

  return (
    <div className="space-y-6">
      {/* 상단 바: 월 이동 + 직원 필터 + 새로고침 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-sky-700 via-sky-600 to-indigo-600 bg-clip-text text-transparent">
              캘린더
            </span>{' '}
            <span className="text-slate-600">({fmt(baseDate, 'yyyy년 M월')})</span>
          </h1>
          <p className="text-slate-600 text-sm mt-1">
            월간 작업 일정을 확인하고 빠르게 추가·수정하세요.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <button className="btn" onClick={() => setBaseDate(subMonths(baseDate, 1))}>◀ 이전달</button>
            <button className="btn" onClick={() => setBaseDate(addMonths(baseDate, 1))}>다음달 ▶</button>
            <button className="btn" onClick={() => setBaseDate(new Date())}>오늘</button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">직원</label>
            <select className="select" value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}>
              {empOptions.map(o => (<option key={o.key} value={o.key}>{o.label}</option>))}
            </select>
            <button className="btn" onClick={load}>새로고침</button>
          </div>
        </div>
      </div>

      {msg && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{msg}</div>}

      {/* 달력 카드 */}
      <section className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white shadow-[0_6px_16px_rgba(2,132,199,0.08)] overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-600">불러오는 중…</div>
        ) : (
          <MonthGrid
            days={days}
            baseDate={baseDate}
            onAdd={openAddForDate}
            onView={openViewById}
            onDayClick={openDayDetail}
            isAdmin={isAdmin}
            hasFinanceCols={hasFinanceCols}
          />
        )}
      </section>

      {/* ▶ 빠른 추가 모달 */}
      {showAdd.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white w-[min(760px,94vw)] p-5 shadow-2xl">
            <div className="text-lg font-bold mb-2 text-sky-800">일정 추가</div>

            <Field label="작업내용">
              <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="예) 욕실 타일 보수 / 휴무 체크 시 자동 '휴무' 표기" />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <Field label="직원 이름 (여러 명 선택)">
                {/* 🔎 검색 + 멀티셀렉트 */}
                <div className="space-y-2">
                  <input
                    className="input"
                    placeholder="직원이름 검색"
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                  />
                  <select
                    className="select"
                    multiple
                    size={6}
                    value={form.empNames}
                    onChange={(e) => {
                      const opts = Array.from(e.target.selectedOptions).map(o => o.value);
                      setForm(f => ({ ...f, empNames: opts }));
                    }}
                  >
                    {filteredEmpForAdd.map((name) => (<option key={name} value={name}>{name}</option>))}
                  </select>
                  <div className="text-[11px] text-slate-500">※ Ctrl(또는 Cmd) 키로 다중 선택</div>
                </div>
              </Field>

              <Field label="고객이름">
                <input className="input" value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} placeholder="예) 박OO" />
              </Field>
              <Field label="고객 번호">
                <input className="input" value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))} placeholder="010-1234-5678" />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <Field label="현장주소">
                <input className="input" value={form.siteAddress} onChange={e => setForm(f => ({ ...f, siteAddress: e.target.value }))} placeholder="서울시 ..." />
              </Field>
              <Field label="예약시간(시작)">
                <input type="datetime-local" className="input" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} />
              </Field>
              <Field label="휴무">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.offDay}
                    onChange={e => setForm(f => ({ ...f, offDay: e.target.checked }))}
                  />
                  <span className="text-slate-700">해당 일정은 직원 휴무</span>
                </label>
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end mt-3">
              <Field label="총작업비">
                <input className="input" inputMode="numeric" value={form.total}
                  onChange={e => { const v = int(e.target.value); setForm(f => ({ ...f, total: v, revenue: v })); }}
                  placeholder="예) 500000" />
              </Field>
              <div className="md:col-span-2">
                <button type="button" className="btn mr-2" onClick={() => setDetailsOpen(o => !o)}>
                  {detailsOpen ? '상세 숨기기' : '상세 입력(총매출/자재비/인건비/기타)'}
                </button>
                <span className="text-xs text-slate-600">* 총작업비는 총매출(revenue)로 저장됩니다.</span>
              </div>
            </div>

            {detailsOpen && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                <Field label="총매출">
                  <input className="input" inputMode="numeric" value={form.revenue}
                    onChange={e => { const v = int(e.target.value); setForm(f => ({ ...f, revenue: v, total: v })); }} />
                </Field>
                <Field label="자재비">
                  <input className="input" inputMode="numeric" value={form.material}
                    onChange={e => setForm(f => ({ ...f, material: int(e.target.value) }))} />
                </Field>
                <Field label="인건비">
                  <input className="input" inputMode="numeric" value={form.wage}
                    onChange={e => setForm(f => ({ ...f, wage: int(e.target.value) }))} />
                </Field>
                <Field label="기타비용">
                  <input className="input" inputMode="numeric" value={form.extra}
                    onChange={e => setForm(f => ({ ...f, extra: int(e.target.value) }))} />
                </Field>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-4">
              <button type="button" className="btn" onClick={() => setShowAdd({open:false, date:null})}>닫기</button>
              <button type="button" className="btn-primary disabled:opacity-50" disabled={saving} onClick={saveNew}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ▶ 특정 날짜 전체 보기 모달 */}
      {showDay.open && showDay.date && (
        <DayDetailModal
          date={showDay.date}
          items={dayItems}
          onClose={closeDayDetail}
          onAdd={() => { openAddForDate(showDay.date!); }}
          onView={(id) => openViewById(id)}
          isAdmin={isAdmin}
        />
      )}

      {/* ▶ 상세/수정 모달 */}
      {viewId !== null && selectedRow && (
        <DetailModal
          row={selectedRow}
          allRows={rows}
          onClose={closeView}
          isAdmin={isAdmin}
          hasFinanceCols={hasFinanceCols}
          empNameList={empNameList}
          empEditSearch={empEditSearch}
          setEmpEditSearch={setEmpEditSearch}
          supportsMultiEmp={supportsMultiEmp}
          supportsOff={supportsOff}
        />
      )}
    </div>
  );
}

/* ---------- 상세/수정 모달 컴포넌트 ---------- */
function DetailModal({
  row, allRows, onClose, isAdmin, hasFinanceCols, empNameList, empEditSearch, setEmpEditSearch,
  supportsMultiEmp, supportsOff
}: {
  row: Row;
  allRows: Row[];
  onClose: () => void;
  isAdmin: boolean;
  hasFinanceCols: boolean | null;
  empNameList: string[];
  empEditSearch: string;
  setEmpEditSearch: (v: string) => void;
  supportsMultiEmp: boolean;
  supportsOff: boolean;
}) {
  const start = row.start_ts ? parseISO(row.start_ts) : null;
  const net   = calcNet(row);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false); // ✅ 삭제 진행상태

  const initialNames = effectiveNames(row);

  // 편집폼 상태
  const [edit, setEdit] = useState<{
    title: string;
    empNames: string[];   // ✅ 여러 명
    customerName: string;
    customerPhone: string;
    siteAddress: string;
    startLocal: string;
    revenue?: number;
    material_cost?: number;
    daily_wage?: number;
    extra_cost?: number;
    offDay: boolean;      // ✅ 휴무
  }>(() => ({
    title: row.title ?? '',
    empNames: initialNames,
    customerName: row.customer_name ?? '',
    customerPhone: row.customer_phone ?? '',
    siteAddress: row.site_address ?? '',
    startLocal: start ? toLocal(start) : toLocal(new Date()),
    revenue: num(row.revenue),
    material_cost: num(row.material_cost),
    daily_wage: num(row.daily_wage),
    extra_cost: num(row.extra_cost),
    offDay: effectiveOff(row),
  }));

  // 직원 검색 필터(수정 모드)
  const filteredEmpForEdit = useMemo(() => {
    const q = (empEditSearch ?? '').trim().toLowerCase();
    if (!q) return empNameList;
    return empNameList.filter(nm => nm.toLowerCase().includes(q));
  }, [empEditSearch, empNameList]);

  const onSave = async () => {
    setSaving(true);
    setErr(null);

    const startISO = fromLocal(edit.startLocal);
    const endISO = startISO; // 종료 없음

    const empNames = (edit.empNames ?? []).map(s => s.trim()).filter(Boolean);
    const legacyEmpName = empNames.join(', ');

    // 전체 업데이트 페이로드
    const fullPayload: Record<string, any> = {
      title: edit.title.trim() || (edit.offDay ? '휴무' : '(제목없음)'),
      start_ts: startISO,
      end_ts: endISO,
      customer_name: edit.customerName.trim() || null,
      customer_phone: edit.customerPhone.trim() || null,
      site_address: edit.siteAddress.trim() || null,
    };

    if (isAdmin) {
      fullPayload.revenue = num(edit.revenue);
      fullPayload.material_cost = num(edit.material_cost);
      fullPayload.daily_wage = num(edit.daily_wage);
      fullPayload.extra_cost = num(edit.extra_cost);
    }

    // 직원
    if (supportsMultiEmp) {
      fullPayload.employee_names = empNames.length ? empNames : null;
      fullPayload.employee_name = empNames.length === 1 ? empNames[0] : (empNames.length ? legacyEmpName : null);
    } else {
      fullPayload.employee_name = empNames.length ? legacyEmpName : null;
    }

    // 휴무
    if (supportsOff) fullPayload.off_day = !!edit.offDay;
    else {
      if (edit.offDay && !String(fullPayload.title).startsWith('휴무')) {
        fullPayload.title = `휴무 - ${fullPayload.title}`;
      }
    }

    // 1차: 모든 컬럼으로 업데이트 (쓰기이므로 원본 테이블)
    let { error } = await supabase.from('schedules').update(fullPayload).eq('id', row.id);

    if (error) {
      // 2차: 안전 최소 컬럼으로 재시도
      const safeKeys = ['title','start_ts','end_ts','employee_name','customer_name','customer_phone','site_address'];
      const safePayload: Record<string, any> = {};
      for (const k of safeKeys) safePayload[k] = fullPayload[k];
      const retry = await supabase.from('schedules').update(safePayload).eq('id', row.id);
      if (retry.error) {
        setErr(`저장 오류: ${retry.error.message}`);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setEditing(false);
    // Realtime 구독으로 목록/상세가 자동 갱신됨
  };

  // ✅ 삭제 핸들러
  const onDelete = async () => {
    setErr(null);
    const ok = typeof window !== 'undefined'
      ? window.confirm('정말로 이 일정을 삭제할까요? 이 작업은 되돌릴 수 없습니다.')
      : true;
    if (!ok) return;

    setDeleting(true);
    const { error } = await supabase.from('schedules').delete().eq('id', row.id);
    if (error) {
      setErr(`삭제 오류: ${error.message}`);
      setDeleting(false);
      return;
    }
    setDeleting(false);
    onClose(); // 성공 시 모달 닫기 (리얼타임으로 목록 갱신)
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white w-[min(860px,94vw)] p-5 shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-bold text-sky-800">🗂️ 일정 {editing ? '수정' : '상세'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">✕</button>
        </div>

        {err && <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2">{err}</div>}

        {!editing ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Info label="작업내용" value={row.title || (effectiveOff(row) ? '휴무' : '(제목없음)')} />
              <Info label="직원" value={effectiveNames(row).join(', ') || '-'} />
              <Info label="예약시간" value={start ? fmt(start, 'yyyy-MM-dd HH:mm') : '-'} />
              <Info label="현장주소" value={row.site_address || '-'} />
              <Info label="고객이름" value={row.customer_name || '-'} />
              <Info label="고객 번호" value={row.customer_phone || '-'} />
              <Info label="휴무" value={effectiveOff(row) ? '예' : '아니오'} />
            </div>

            {/* 관리자만 재무정보 */}
            {isAdmin && (
              <div className="mt-4 border-t pt-3">
                <div className="text-sm font-semibold mb-2">💰 금액 정보</div>
                {hasFinanceCols === false ? (
                  <div className="text-sm text-slate-500">테이블에 금액 컬럼이 없어 금액 정보를 표시할 수 없습니다.</div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <Info label="총매출"  value={moneyOrDash(row.revenue)} />
                    <Info label="자재비"  value={moneyOrDash(row.material_cost)} />
                    <Info label="인건비"  value={moneyOrDash(row.daily_wage)} />
                    <Info label="기타비용" value={moneyOrDash(row.extra_cost)} />
                    <Info label="순수익"  value={net == null ? '-' : formatKRW(net)} highlight />
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              {/* ✅ 삭제 버튼 추가 */}
              <button
                onClick={onDelete}
                disabled={deleting}
                className="btn border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                title="이 일정을 삭제합니다"
              >
                {deleting ? '삭제 중…' : '삭제하기'}
              </button>
              <button onClick={() => setEditing(true)} className="btn-primary">수정하기</button>
              <button onClick={onClose} className="btn">닫기</button>
            </div>
          </>
        ) : (
          <>
            {/* 편집 폼 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditField label="작업내용">
                <input className="input" value={edit.title} onChange={e => setEdit(s => ({ ...s, title: e.target.value }))} />
              </EditField>

              <EditField label="직원 이름 (여러 명 선택)">
                <div className="space-y-2">
                  <input
                    className="input"
                    placeholder="직원이름 검색"
                    value={empEditSearch}
                    onChange={(e)=>setEmpEditSearch(e.target.value)}
                  />
                  <select
                    className="select"
                    multiple
                    size={6}
                    value={edit.empNames}
                    onChange={(e) => {
                      const opts = Array.from(e.target.selectedOptions).map(o => o.value);
                      setEdit(s => ({ ...s, empNames: opts }));
                    }}
                  >
                    {/* 현재 값이 목록에 없어도 보존하지 않아도 됨(모두 마스터 목록 기반 선택) */}
                    {filteredEmpForEdit.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <div className="text-[11px] text-slate-500">※ Ctrl(또는 Cmd) 키로 다중 선택</div>
                </div>
              </EditField>

              <EditField label="예약시간">
                <input type="datetime-local" className="input" value={edit.startLocal} onChange={e => setEdit(s => ({ ...s, startLocal: e.target.value }))} />
              </EditField>
              <EditField label="현장주소">
                <input className="input" value={edit.siteAddress} onChange={e => setEdit(s => ({ ...s, siteAddress: e.target.value }))} />
              </EditField>
              <EditField label="고객이름">
                <input className="input" value={edit.customerName} onChange={e => setEdit(s => ({ ...s, customerName: e.target.value }))} />
              </EditField>
              <EditField label="고객 번호">
                <input className="input" value={edit.customerPhone} onChange={e => setEdit(s => ({ ...s, customerPhone: e.target.value }))} />
              </EditField>

              <EditField label="휴무">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={edit.offDay}
                    onChange={e => setEdit(s => ({ ...s, offDay: e.target.checked }))}
                  />
                  <span className="text-slate-700">해당 일정은 직원 휴무</span>
                </label>
              </EditField>
            </div>

            {isAdmin && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                <EditField label="총매출">
                  <input className="input" inputMode="numeric" value={edit.revenue ?? 0} onChange={e => setEdit(s => ({ ...s, revenue: int(e.target.value) }))} />
                </EditField>
                <EditField label="자재비">
                  <input className="input" inputMode="numeric" value={edit.material_cost ?? 0} onChange={e => setEdit(s => ({ ...s, material_cost: int(e.target.value) }))} />
                </EditField>
                <EditField label="인건비">
                  <input className="input" inputMode="numeric" value={edit.daily_wage ?? 0} onChange={e => setEdit(s => ({ ...s, daily_wage: int(e.target.value) }))} />
                </EditField>
                <EditField label="기타비용">
                  <input className="input" inputMode="numeric" value={edit.extra_cost ?? 0} onChange={e => setEdit(s => ({ ...s, extra_cost: int(e.target.value) }))} />
                </EditField>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onSave}
                disabled={saving}
                className="btn-primary disabled:opacity-50"
              >
                저장
              </button>
              <button
                onClick={() => { // 취소 → 원래 값으로 복구
                  const names = effectiveNames(row);
                  setEdit({
                    title: row.title ?? '',
                    empNames: names,
                    customerName: row.customer_name ?? '',
                    customerPhone: row.customer_phone ?? '',
                    siteAddress: row.site_address ?? '',
                    startLocal: start ? toLocal(start) : toLocal(new Date()),
                    revenue: num(row.revenue),
                    material_cost: num(row.material_cost),
                    daily_wage: num(row.daily_wage),
                    extra_cost: num(row.extra_cost),
                    offDay: effectiveOff(row),
                  });
                  setEmpEditSearch('');
                  setEditing(false);
                }}
                className="btn"
              >
                취소
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- 특정 날짜 전체 보기 모달 ---------- */
function DayDetailModal({
  date, items, onClose, onAdd, onView, isAdmin
}: {
  date: Date;
  items: Row[];
  onClose: () => void;
  onAdd: () => void;
  onView: (id:number) => void;
  isAdmin: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white w-[min(860px,94vw)] p-5 shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-bold text-sky-800">📅 {fmt(date, 'yyyy-MM-dd')} 일정({items.length}건)</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">✕</button>
        </div>

        <div className="flex justify-between mb-2">
          <div className="text-sm text-slate-600">해당 날짜의 모든 일정을 한눈에 확인하고 클릭해 상세로 들어갈 수 있어요.</div>
          <button className="btn" onClick={onAdd}>+ 이 날짜에 추가</button>
        </div>

        <div className="overflow-auto rounded-xl border border-slate-200 divide-y">
          {items.length === 0 && (
            <div className="p-4 text-sm text-slate-500">등록된 일정이 없습니다.</div>
          )}
          {items.map((r) => {
            const start = r.start_ts ? parseISO(r.start_ts) : null;
            const net = calcNet(r);
            const names = effectiveNames(r);
            const isOff = effectiveOff(r);
            const isTeam = names.length >= 2;
            return (
              <button
                key={r.id}
                onClick={() => onView(r.id)}
                className={`w-full text-left p-3 hover:bg-slate-50 relative ${
                  isOff ? 'border border-rose-400 rounded-lg' : ''
                }`}
                title="클릭하여 상세 보기"
              >
                {/* 팀 표시용 파란 바 */}
                {isTeam && <span className="absolute left-0 top-0 h-full w-1 bg-sky-500 rounded-l-md" />}

                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-800 truncate">
                    {r.title ?? (isOff ? '휴무' : '(제목없음)')}
                  </div>
                  <div className="text-xs text-slate-500">{start ? fmt(start,'HH:mm') : '-'}</div>
                </div>
                <div className="mt-1 text-xs text-slate-600 flex gap-2 flex-wrap">
                  {names.length > 0 && <span>👤 {names.join(', ')}</span>}
                  {r.site_address && <span>📍 {r.site_address}</span>}
                  {r.customer_name && <span>🙍 {r.customer_name}</span>}
                  {isAdmin && net != null && <span className="font-semibold text-amber-700">💰 순익 {formatKRW(net)}</span>}
                  {isOff && <span className="text-rose-600 font-semibold">⛔ 휴무</span>}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex justify-end">
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 공통 소형 컴포넌트 ---------- */
function Info({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'bg-yellow-50 border-yellow-200' : 'bg-slate-50 border-slate-200'}`}>
      <div className="text-[12px] text-slate-500 mb-1">{label}</div>
      <div className="text-sm font-medium break-words">{value}</div>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm text-slate-600 mb-1">{label}</div>
      {children}
    </label>
  );
}

/* ---------- 서브 컴포넌트 ---------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm text-slate-600 mb-1">{label}</div>
      {children}
    </label>
  );
}

/* ---------- 달력 그리드 ---------- */
function MonthGrid({
  days, baseDate, onAdd, onView, onDayClick, isAdmin, hasFinanceCols,
}: {
  days: DayCell[]; baseDate: Date;
  onAdd: (d: Date) => void;
  onView: (id: number) => void;
  onDayClick: (d: Date) => void;
  isAdmin: boolean;
  hasFinanceCols: boolean | null;
}) {
  const weekDays = ['일','월','화','수','목','금','토'];

  return (
    <div>
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 bg-sky-50/60 border-b border-sky-100">
        {weekDays.map(w => (
          <div key={w} className="p-2 text-center text-sm font-semibold text-sky-900">{w}</div>
        ))}
      </div>

      {/* 날짜 셀 */}
      <div className="grid grid-cols-7">
        {days.map(({ date, items }, idx) => {
          const outMonth = !isSameMonth(date, baseDate);
          const today = isSameDay(date, new Date());
          return (
            <div key={idx} className="h-44 border-b border-r border-sky-100 p-1 align-top">
              <div className="flex items-center justify-between mb-1">
                {/* 📌 날짜 숫자 클릭 → 그 날짜 전체 보기 */}
                <button
                  className={`text-xs rounded px-1 ${outMonth ? 'text-slate-400' : 'text-slate-800 hover:bg-slate-100'}`}
                  onClick={() => onDayClick(new Date(date))}
                  title="이 날짜 일정 전체 보기"
                >
                  {fmt(date, 'd')}
                </button>
                <div className="flex items-center gap-1">
                  {today && <span className="text-[10px] px-1 rounded border border-sky-200 bg-sky-50 text-sky-800">오늘</span>}
                  <button
                    type="button"
                    className="text-[10px] px-1 rounded border border-slate-200 hover:bg-slate-50"
                    onClick={() => onAdd(new Date(date))}
                    title="이 날짜에 일정 추가"
                  >
                    + 추가
                  </button>
                </div>
              </div>

              <div className="space-y-1 overflow-y-auto h=[136px] md:h-[136px] pr-1">
                {items.length === 0 ? (
                  <div className="text-xs text-slate-400">일정 없음</div>
                ) : (
                  items.slice(0, 5).map(r => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onView(r.id)}
                      className={`w-full text-left text-xs rounded px-1 py-[2px] hover:bg-slate-50 border ${
                        r.isOff ? 'border-rose-400' : 'border-slate-200'
                      } relative`}
                      title={r.emp ? `${r.title}\n(${r.emp})` : r.title}
                    >
                      {/* 공동작업 파란 바 */}
                      {r.isTeam && <span className="absolute left-0 top-0 h-full w-0.5 bg-sky-500 rounded-l" />}

                      <div className="truncate font-medium text-slate-800">{r.title}</div>
                      {r.emp && <div className="truncate text-[10px] text-slate-600">{r.emp}</div>}
                      {r.isOff && <div className="mt-0.5 text-[10px] text-rose-600 font-semibold">⛔ 휴무</div>}
                      {isAdmin && (
                        <div className="mt-0.5 text-[10px] text-slate-700">
                          {r.netText ?? (hasFinanceCols === false ? <span className="text-slate-400">순익 -</span> : null)}
                        </div>
                      )}
                    </button>
                  ))
                )}
                {items.length > 5 && <div className="text-[10px] text-slate-600">+{items.length - 5} 더보기… (날짜 클릭)</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- 계산/유틸 ---------- */
function calcNet(r: Row): number | null {
  const rev = n(r.revenue), mat = n(r.material_cost), wage = n(r.daily_wage), ext = n(r.extra_cost);
  if (rev == null || mat == null || wage == null || ext == null) return null;
  return rev - mat - wage + (ext / 2);
}
function n(v: number | null | undefined) {
  if (typeof v !== 'number') return null;
  if (!Number.isFinite(v)) return null;
  return v;
}
function num(v: number | null | undefined) { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; }
function int(v: string) { const x = Number((v ?? '').toString().replaceAll(',', '')); return Number.isFinite(x) ? x : 0; }

function safeParse(iso: unknown): Date | null {
  if (!iso || typeof iso !== 'string') return null;
  const d = new Date(iso);
  return isNaN(+d) ? null : d;
}
function isWithin(start: Date, end: Date, target: Date) {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(),  end.getMonth(),  end.getDate());
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return s <= t && t <= e;
}
function toLocal(d: Date) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 16);
}
function fromLocal(local: string) {
  const d = new Date(local);
  return d.toISOString();
}
function formatKRW(n: number) {
  try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n); }
  catch { return `${n.toLocaleString()}원`; }
}
function moneyOrDash(v?: number | null) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
  return formatKRW(v);
}
function uniqueNames(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const nm of arr) {
    const k = nm.trim().toLowerCase();
    if (!k) continue;
    if (!seen.has(k)) { seen.add(k); out.push(nm.trim()); }
  }
  return out.sort((a,b)=>a.localeCompare(b,'ko'));
}
/** 여러 직원 이름을 “항상 배열”로 만들어줌 (employee_names → 있으면 사용, 없으면 employee_name CSV 분해) */
function effectiveNames(r: Row): string[] {
  if (Array.isArray(r.employee_names) && r.employee_names.length) {
    return r.employee_names.map(s => (s ?? '').trim()).filter(Boolean);
  }
  const csv = (r.employee_name ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return csv;
}
/** 휴무 여부 계산: off_day 컬럼이 있으면 우선, 없으면 title이 ‘휴무’/’[휴무]’로 시작하면 true */
function effectiveOff(r: Row): boolean {
  if (typeof r.off_day === 'boolean') return r.off_day;
  const t = (r.title ?? '').trim();
  if (!t) return false;
  return t === '휴무' || t.startsWith('휴무 ') || t.startsWith('휴무-') || t.startsWith('[휴무]');
}
