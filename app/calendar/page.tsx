// FILE: app/calendar/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  addDays, addMonths, endOfMonth, endOfWeek, format as fmt,
  isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths,
  parseISO,
} from 'date-fns';

/* ✅ 자재 선택 UI 임포트 */
import MaterialsPicker, { MatLine, MaterialPub, Location } from '@/components/MaterialsPicker';

/* ---------- 세션 준비 대기(Realtime 누락 방지) ---------- */
async function waitForAuthReady(maxTries = 6, delayMs = 300) {
  for (let i = 0; i < maxTries; i++) {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) return data.session;
    await new Promise(r => setTimeout(r, delayMs));
  }
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

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
  emp?: string;
  netText?: string;
  isOff?: boolean;
  isTeam?: boolean;
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

  // 권한 상태
  const [isAdmin, setIsAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const isElevated = isAdmin || isManager;

  // 금액 컬럼 존재 여부
  const [hasFinanceCols, setHasFinanceCols] = useState<boolean | null>(null);

  // “여러 직원”/“휴무” 사용 가능 여부
  const [supportsMultiEmp, setSupportsMultiEmp] = useState<boolean>(false);
  const [supportsOff, setSupportsOff] = useState<boolean>(false);

  // 입력 폼 상태
  const [form, setForm] = useState<{
    title: string;
    empNames: string[];
    customerName: string;
    customerPhone: string;
    siteAddress: string;
    start: string;
    total: number;
    revenue: number;
    material: number;
    wage: number;
    extra: number;
    offDay: boolean;
  }>({
    title: '',
    empNames: [],
    customerName: '', customerPhone: '', siteAddress: '',
    start: '',
    total: 0, revenue: 0, material: 0, wage: 0, extra: 0,
    offDay: false,
  });

  // 직원 마스터 목록
  const [empMasterNames, setEmpMasterNames] = useState<string[]>([]);
  // 직원 프로필: id ↔ name 매핑
  const [empProfiles, setEmpProfiles] = useState<ProfileName[]>([]);
  const nameToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of empProfiles) {
      const k = (p.full_name ?? '').trim().toLowerCase();
      if (k) m.set(k, p.id);
    }
    return m;
  }, [empProfiles]);
  function findProfileIdByName(name: string | null | undefined) {
    const k = (name ?? '').trim().toLowerCase();
    if (!k) return null;
    return nameToId.get(k) ?? null;
  }

  // 검색어
  const [empSearch, setEmpSearch] = useState<string>('');
  const [empEditSearch, setEmpEditSearch] = useState<string>('');
  const [myName, setMyName] = useState<string>('');

  /* ✅ 자재/지역 상태 (추가·수정 공용 사용) */
  const [materials, setMaterials] = useState<MaterialPub[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [matLines, setMatLines] = useState<MatLine[]>([]); // 추가 모달용

  /* ====== 관리자/매니저 판별 + 내 이름 로드 ====== */
  useEffect(() => {
    (async () => {
      const adminIds = (process.env.NEXT_PUBLIC_ADMIN_IDS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? '';
      const email = (session?.user?.email ?? '').toLowerCase();

      const envAdmin =
        (!!uid && adminIds.includes(uid)) ||
        (!!email && adminEmails.includes(email));

      if (uid) {
        const { data: me } = await supabase
          .from('profiles')
          .select('full_name, is_admin, is_manager')
          .eq('id', uid)
          .maybeSingle();

        setIsAdmin(!!me?.is_admin || envAdmin);
        setIsManager(!!me?.is_manager);

        const fallback = (session?.user?.email?.split('@')[0] ?? '').trim();
        setMyName(((me?.full_name ?? '') || fallback).trim());
      } else {
        setIsAdmin(envAdmin);
        setIsManager(false);
        setMyName((session?.user?.email?.split('@')[0] ?? '').trim());
      }
    })();
  }, []);

  /* ✅ 자재/지역 1회 로드 */
  useEffect(() => {
    (async () => {
      try {
        const { data: mats } = await supabase
          .from('materials_public')
          .select('id,name,vendor,unit_price_visible')
          .order('name', { ascending: true })
          .returns<MaterialPub[]>();
        if (mats) setMaterials(mats);

        const { data: locs } = await supabase
          .from('material_locations')
          .select('id,name')
          .order('name', { ascending: true })
          .returns<Location[]>();
        if (locs) setLocations(locs);
      } catch {}
    })();
  }, []);

  /* ====== 달력 범위 ====== */
  const monthStart = startOfMonth(baseDate);
  const monthEnd   = endOfMonth(baseDate);
  const gridStart  = startOfWeek(monthStart);
  const gridEnd    = endOfWeek(monthEnd);

  /* ====== 데이터 로드 ====== */
  const load = async () => {
    setLoading(true);
    setMsg(null);

    try {
      const me = (myName ?? '').trim();
      if (!isElevated && !me) {
        setRows([]);
        setLoading(false);
        return;
      }

      const sel1 =
        'id,title,start_ts,end_ts,employee_id,employee_name,employee_names,off_day,customer_name,customer_phone,site_address,revenue,material_cost,daily_wage,extra_cost,net_profit_visible';

      let query = supabase
        .from('schedules_secure')
        .select(sel1)
        .order('start_ts', { ascending: true });

      if (!isElevated) {
        const esc = me.replace(/([{}%,])/g, '');
        query = query.or(`employee_names.cs.{${esc}},employee_name.ilike.%${esc}%`);
      }

      let { data, error } = await query.returns<Row[]>();

      if (error) {
        setHasFinanceCols(false);
        setSupportsMultiEmp(false);
        setSupportsOff(false);

        const sel2 =
          'id,title,start_ts,end_ts,employee_id,employee_name,customer_name,customer_phone,site_address';

        let q2 = supabase
          .from('schedules_secure')
          .select(sel2)
          .order('start_ts', { ascending: true });

        if (!isElevated) {
          const esc = me.replace(/([{}%,])/g, '');
          q2 = q2.or(`employee_names.cs.{${esc}},employee_name.ilike.%${esc}%`);
        }

        const fallback = await q2.returns<Row[]>();
        data = fallback.data ?? [];
        error = fallback.error;
      } else {
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
        .order('full_name', { ascending: true });

      if (!error && data) {
        setEmpProfiles(data as ProfileName[]);
        const names = (data as any[]).map(p => (p.full_name ?? '').trim()).filter(Boolean);
        setEmpMasterNames(names);
      } else if (error) {
        console.warn('profiles read error:', error.message);
      }
    } catch (e) {
      console.warn('profiles load failed:', e);
    }
  };

  useEffect(() => { load(); }, [isElevated, myName]);

  // ✅ Realtime - schedules (세션 준비 후 구독)
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const sess = await waitForAuthReady();
      const subscribe = () => {
        ch = supabase
          .channel('calendar-schedules')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, (payload) => {
            console.log('[realtime] schedules change', payload);
            load();
          })
          .subscribe();
      };
      if (sess) {
        subscribe();
      } else {
        const sub = supabase.auth.onAuthStateChange((_e, s) => {
          if (s) {
            subscribe();
            sub.data.subscription.unsubscribe();
          }
        });
      }
    })();
    return () => { if (ch) supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime - profiles
  useEffect(() => {
    const channel = supabase
      .channel('profiles-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        loadProfiles();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  /* ====== 상단 직원 필터 옵션 ====== */
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
      if (Array.isArray(r.employee_names) && r.employee_names.length > 0) {
        r.employee_names.forEach(n => pushName(n));
      } else {
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
    return isElevated ? [{ key: 'all', label: '전체 직원' }, ...list] : list;
  }, [empNameList, isElevated]);

  /* ====== 상단 직원 필터 적용 ====== */
  const filteredRows = useMemo(() => {
    const effective = !isElevated && selectedEmp === 'all' ? rows : (
      selectedEmp.startsWith('name::')
        ? rows.filter(r => {
            const norm = selectedEmp.slice('name::'.length);
            return effectiveNames(r).some(nm => nm.toLowerCase() === norm);
          })
        : rows
    );
    return effective;
  }, [rows, selectedEmp, isElevated]);

  /* ====== 달력 6주(42칸) 셀 데이터 ====== */
  const days: DayCell[] = useMemo(() => {
    const out: DayCell[] = [];
    let cur = new Date(gridStart);
    while (cur <= gridEnd) {
      const items: DayCellItem[] = filteredRows
        .filter(r => {
          const s = safeParse(r.start_ts);
          const e = r.end_ts ? safeParse(r.end_ts) : s;
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
            netText:
              isAdmin && net != null ? `순익 ${formatKRW(net)}`
              : (isManager && net != null ? '순익 ***' : undefined),
          };
        });
      out.push({ date: cur, items });
      cur = addDays(cur, 1);
    }
    return out;
  }, [gridStart, gridEnd, filteredRows, isAdmin, isManager]);

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
    setMatLines([]); // 자재 선택 초기화
    setShowAdd({ open: true, date: d });
  };

  const openDayDetail = (d: Date) => setShowDay({ open: true, date: d });
  const closeDayDetail = () => setShowDay({ open: false, date: null });

  const openViewById = (id: number) => setViewId(id);
  const closeView = () => setViewId(null);

  /* ✅ 스케줄 생성 후 자재 반영(추가 모달) */
  async function afterScheduleCreated(newScheduleId: string, startDateISO?: string) {
    const validLines = matLines
      .filter((ln) => ln.material_id && ln.location_id && ln.qty !== '' && Number(ln.qty) > 0)
      .map((ln) => ({ material_id: ln.material_id, location_id: ln.location_id, qty: Number(ln.qty) }));

    if (validLines.length === 0) return;

    const ids = validLines.map(v => v.material_id);
    const { data: prices, error: pErr } = await supabase
      .from('materials')
      .select('id,unit_price')
      .in('id', ids);
    if (pErr) throw pErr;

    const priceMap = new Map<string, number>();
    (prices || []).forEach((r: any) => priceMap.set(r.id, Number(r.unit_price)));

    let totalCost = 0;
    for (const v of validLines) totalCost += Number(priceMap.get(v.material_id) || 0) * Number(v.qty);

    const used_date = startDateISO || new Date().toISOString().slice(0, 10);
    const usagesPayload = validLines.map((v) => ({
      material_id: v.material_id,
      location_id: v.location_id,
      qty: Number(v.qty),
      used_date,
      schedule_id: newScheduleId,
    }));
    const { error: uErr } = await supabase.from('material_usages').insert(usagesPayload);
    if (uErr) throw uErr;

    await supabase.from('schedules').update({ material_cost: totalCost }).eq('id', newScheduleId);

    setMatLines([]);
  }

  /* ====== 신규 저장 ====== */
  const saveNew = async () => {
    if (!showAdd.date) return;
    setSaving(true);
    setMsg(null);

    const startISO = fromLocal(form.start);
    const endISO   = startISO;

    const empNames = (form.empNames ?? []).map(s => s.trim()).filter(Boolean);
    const legacyEmpName = empNames.join(', ');

    // ✅ 주소 연동: site_address + location(레거시) 동시 저장
    const fullPayload: Record<string, any> = {
      title: (form.title.trim() || (form.offDay ? '휴무' : '(제목없음)')),
      start_ts: startISO,
      end_ts: endISO,
      customer_name: form.customerName.trim() || null,
      customer_phone: form.customerPhone.trim() || null,
      site_address: form.siteAddress.trim() || null,
      location: form.siteAddress.trim() || null, // ← 레거시 컬럼 동기화
      revenue: num(form.total),
      material_cost: num(form.material),
      daily_wage: num(form.wage),
      extra_cost: num(form.extra),
    };

    if (supportsMultiEmp) {
      fullPayload.employee_names = empNames.length ? empNames : null;
      fullPayload.employee_name = empNames.length === 1 ? empNames[0] : (empNames.length ? legacyEmpName : null);
    } else {
      fullPayload.employee_name = empNames.length ? legacyEmpName : null;
    }
    // ★ 단일 선택이면 employee_id도 채워 넣기 (여러 명이면 NULL 유지)
    fullPayload.employee_id = empNames.length === 1 ? findProfileIdByName(empNames[0]) : null;

    // ★ 단일 선택이면 employee_id도 채워 넣기 (여러 명이면 NULL 유지)
    fullPayload.employee_id = empNames.length === 1 ? findProfileIdByName(empNames[0]) : null;


    if (supportsOff) fullPayload.off_day = !!form.offDay;
    else {
      if (form.offDay && !String(fullPayload.title).startsWith('휴무')) {
        fullPayload.title = `휴무 - ${fullPayload.title}`;
      }
    }

    /* ✅ 변경점 #1: 생성 레코드 전체를 받아서 즉시 반영(낙관 갱신) */
    const { data: created, error } = await supabase
      .from('schedules')
      .insert(fullPayload)
      .select('id,title,start_ts,end_ts,employee_id,employee_name,employee_names,off_day,customer_name,customer_phone,site_address,revenue,material_cost,daily_wage,extra_cost')
      .single();

    if (error) {
      // (안전) 최소 컬럼으로 재시도
      const safeKeys = ['title','start_ts','end_ts','employee_name','customer_name','customer_phone','site_address','location'];
      const safePayload: Record<string, any> = {};
      for (const k of safeKeys) safePayload[k] = fullPayload[k];
      const retry = await supabase
        .from('schedules')
        .insert(safePayload)
        .select('id,title,start_ts,end_ts,employee_id,employee_name,employee_names,off_day,customer_name,customer_phone,site_address,revenue,material_cost,daily_wage,extra_cost')
        .single();

      if (retry.error) {
        setMsg(`등록 오류: ${retry.error.message}`);
        setSaving(false);
        setShowAdd({ open:false, date:null });
        return;
      }

      // ✅ 낙관 갱신
      setRows(prev => [...prev, mapCreatedToRow(retry.data, supportsMultiEmp, supportsOff, empNames, fullPayload, startISO, endISO)]);
      try {
        await afterScheduleCreated(String(retry.data.id), (startISO || '').slice(0,10));
      } catch (e:any) {
        console.warn('materials apply failed:', e?.message ?? e);
        setMsg(`자재 반영 실패: ${e?.message ?? e}`);
      }
      setSaving(false);
      setShowAdd({ open:false, date:null });
      await load(); // 서버 상태 재동기화
      return;
    }

    // ✅ 낙관 갱신
    setRows(prev => [...prev, mapCreatedToRow(created, supportsMultiEmp, supportsOff, empNames, fullPayload, startISO, endISO)]);

    try {
      const startDateISO = (startISO || '').slice(0, 10);
      await afterScheduleCreated(String(created.id), startDateISO);
    } catch (e: any) {
      console.warn('materials apply failed:', e?.message ?? e);
      setMsg(`자재 반영 실패: ${e?.message ?? e}`);
    }

    setSaving(false);
    setShowAdd({ open:false, date:null });

    /* ✅ 변경점 #2: 즉시 보이되, 마지막에 서버 상태로 재동기화 */
    await load();
  };

  /* ====== 선택된 일정 ====== */
  const selectedRow = useMemo(() => {
    if (viewId == null) return null;
    const r = rows.find(x => x.id === viewId) || null;
    return r;
  }, [viewId, rows]);

  /* ====== 특정 날짜의 아이템 ====== */
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

  /* ====== 직원 검색 + 클릭 토글 UI용 데이터 ====== */
  const filteredEmpForAdd = useMemo(() => {
    const q = (empSearch ?? '').trim().toLowerCase();
    if (!q) return empNameList;
    return empNameList.filter(nm => nm.toLowerCase().includes(q));
  }, [empSearch, empNameList]);

  return (
    <div className="space-y-6">
      {/* 상단 바 */}
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

      {/* 달력 */}
      <section className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white shadow-[0_6px_16px_rgba(2,132,199,0.08)] overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-600">불러오는 중…</div>
        ) : (
          <>
            {/* 📱 모바일: Agenda 리스트(가독성 ↑) */}
            <div className="sm:hidden">
              <MonthAgendaMobile
                days={days}
                baseDate={baseDate}
                onAdd={openAddForDate}
                onView={openViewById}
                onDayClick={openDayDetail}
                isAdmin={isAdmin}
                isManager={isManager}
                hasFinanceCols={hasFinanceCols}
              />
            </div>

            {/* 🖥️ 데스크탑: 기존 그리드 그대로 */}
            <div className="hidden sm:block">
              <MonthGrid
                days={days}
                baseDate={baseDate}
                onAdd={openAddForDate}
                onView={openViewById}
                onDayClick={openDayDetail}
                isAdmin={isAdmin}
                isManager={isManager}
                hasFinanceCols={hasFinanceCols}
              />
            </div>
          </>
        )}
      </section>

      {/* ▶ 빠른 추가 모달 */}
      {showAdd.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div
            className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white w-[min(760px,94vw)] shadow-2xl flex flex-col"
            style={{ maxHeight: '85vh' }}
          >
            {/* 헤더: 고정 */}
            <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/90 backdrop-blur px-5 py-3 flex items-center justify-between">
              <div className="text-lg font-bold text-sky-800">일정 추가</div>
              <button className="text-slate-500 hover:text-slate-800" onClick={() => setShowAdd({open:false, date:null})}>✕</button>
            </div>

            {/* 본문: 스크롤 */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <Field label="작업내용">
                <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="예) 욕실 타일 보수 / 휴무 체크 시 자동 '휴무' 표기" />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                {/* ✅ 직원 선택(클릭 토글 + 칩) */}
                <Field label="직원 이름 (여러 명 선택)">
                  <MultiPick
                    search={empSearch}
                    setSearch={setEmpSearch}
                    options={filteredEmpForAdd}
                    values={form.empNames}
                    onToggle={(name) => {
                      setForm(f => {
                        const has = f.empNames.includes(name);
                        return { ...f, empNames: has ? f.empNames.filter(n => n!==name) : [...f.empNames, name] };
                      });
                    }}
                    placeholder="직원이름 검색"
                  />
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

              {/* 자재 선택 영역(기존 그대로) */}
              <div className="mt-4">
                <MaterialsPicker
                  lines={matLines}
                  setLines={setMatLines}
                  materials={materials}
                  locations={locations}
                />
              </div>
            </div>

            {/* 푸터: 고정 (버튼 항상 보임) */}
            <div className="sticky bottom-0 z-10 border-t border-slate-100 bg-white/90 backdrop-blur px-5 py-3 flex justify-end gap-2">
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
          isManager={isManager}
        />
      )}

      {/* ▶ 상세/수정 모달 (자재 UI 포함) */}
      {viewId !== null && selectedRow && (
        <DetailModal
          row={selectedRow}
          allRows={rows}
          onClose={closeView}
          isAdmin={isAdmin}
          isManager={isManager}
          hasFinanceCols={hasFinanceCols}
          empNameList={empNameList}
          empEditSearch={empEditSearch}
          setEmpEditSearch={setEmpEditSearch}
          supportsMultiEmp={supportsMultiEmp}
          supportsOff={supportsOff}
          /* ✅ 자재/지역 전달 */
          materials={materials}
          locations={locations}
        />
      )}
    </div>
  );
}

/* ---------- 상세/수정 모달 ---------- */
function DetailModal({
  row, allRows, onClose, isAdmin, isManager, hasFinanceCols, empNameList, empEditSearch, setEmpEditSearch,
  supportsMultiEmp, supportsOff, materials, locations
}: {
  row: Row;
  allRows: Row[];
  onClose: () => void;
  isAdmin: boolean;
  isManager: boolean;
  hasFinanceCols: boolean | null;
  empNameList: string[];
  empEditSearch: string;
  setEmpEditSearch: (v: string) => void;
  supportsMultiEmp: boolean;
  supportsOff: boolean;
  /* ✅ 자재/지역 */
  materials: MaterialPub[];
  locations: Location[];
}) {
  const start = row.start_ts ? parseISO(row.start_ts) : null;
  const net   = calcNet(row);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const initialNames = effectiveNames(row);

  // 편집폼 상태
  const [edit, setEdit] = useState<{
    title: string;
    empNames: string[];
    customerName: string;
    customerPhone: string;
    siteAddress: string;
    startLocal: string;
    revenue?: number;
    material_cost?: number;
    daily_wage?: number;
    extra_cost?: number;
    offDay: boolean;
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

  // ✅ 수정 모달에서 쓰는 자재 라인
  const [linesEdit, setLinesEdit] = useState<MatLine[]>([]);

  // 초기 로드: 해당 일정의 자재 사용내역 불러와서 피커에 반영
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('material_usages')
          .select('id, material_id, location_id, qty, used_date')
          .eq('schedule_id', row.id);
        if (!error && data) {
          setLinesEdit(
            data.map((u: any) => ({
              id: crypto.randomUUID(),
              material_id: u.material_id,
              location_id: u.location_id,
              qty: Number(u.qty),
            }))
          );
        }
      } catch {}
    })();
  }, [row.id]);

  // 직원 검색 필터(수정 모드)
  const filteredEmpForEdit = useMemo(() => {
    const q = (empEditSearch ?? '').trim().toLowerCase();
    if (!q) return empNameList;
    return empNameList.filter(nm => nm.toLowerCase().includes(q));
  }, [empEditSearch, empNameList]);

  // ✅ 자재 동기화: (1) 기존 사용내역 삭제 → (2) 새로 입력 → (3) 총 자재비 재계산/업데이트
  async function syncMaterialsForSchedule(scheduleId: number, startDateISO: string) {
    const valid = linesEdit
      .filter((ln) => ln.material_id && ln.location_id && ln.qty !== '' && Number(ln.qty) > 0)
      .map((ln) => ({ material_id: ln.material_id, location_id: ln.location_id, qty: Number(ln.qty) }));

    // 모두 비우면 삭제만 하고 자재비 0 처리
    const { error: delErr } = await supabase
      .from('material_usages')
      .delete()
      .eq('schedule_id', scheduleId);
    if (delErr) throw delErr;

    if (valid.length === 0) {
      await supabase.from('schedules').update({ material_cost: 0 }).eq('id', scheduleId);
      return;
    }

    const ids = valid.map(v => v.material_id);
    const { data: prices, error: pErr } = await supabase
      .from('materials')
      .select('id,unit_price')
      .in('id', ids);
    if (pErr) throw pErr;

    const priceMap = new Map<string, number>();
    (prices || []).forEach((r: any) => priceMap.set(r.id, Number(r.unit_price)));

    let totalCost = 0;
    for (const v of valid) totalCost += Number(priceMap.get(v.material_id) || 0) * Number(v.qty);

    const used_date = (startDateISO || '').slice(0, 10);
    const payload = valid.map(v => ({
      material_id: v.material_id,
      location_id: v.location_id,
      qty: v.qty,
      used_date,
      schedule_id: scheduleId as any,
    }));
    const { error: insErr } = await supabase.from('material_usages').insert(payload);
    if (insErr) throw insErr;

    await supabase.from('schedules').update({ material_cost: totalCost }).eq('id', scheduleId);
  }

  const onSave = async () => {
    setSaving(true);
    setErr(null);

    const startISO = fromLocal(edit.startLocal);
    const endISO = startISO;

    const empNames = (edit.empNames ?? []).map(s => s.trim()).filter(Boolean);
    const legacyEmpName = empNames.join(', ');

    // ✅ 주소 연동: site_address + location(레거시) 동시 업데이트
    const fullPayload: Record<string, any> = {
      title: edit.title.trim() || (edit.offDay ? '휴무' : '(제목없음)'),
      start_ts: startISO,
      end_ts: endISO,
      customer_name: edit.customerName.trim() || null,
      customer_phone: edit.customerPhone.trim() || null,
      site_address: edit.siteAddress.trim() || null,
      location: edit.siteAddress.trim() || null, // ← 레거시 컬럼 동기화
    };

    if (isAdmin) {
      fullPayload.revenue = num(edit.revenue);
      fullPayload.material_cost = num(edit.material_cost);
      fullPayload.daily_wage = num(edit.daily_wage);
      fullPayload.extra_cost = num(edit.extra_cost);
    }

    if (supportsMultiEmp) {
      fullPayload.employee_names = empNames.length ? empNames : null;
      fullPayload.employee_name = empNames.length === 1 ? empNames[0] : (empNames.length ? legacyEmpName : null);
    } else {
      fullPayload.employee_name = empNames.length ? legacyEmpName : null;
    }

    if (supportsOff) fullPayload.off_day = !!edit.offDay;
    else {
      if (edit.offDay && !String(fullPayload.title).startsWith('휴무')) {
        fullPayload.title = `휴무 - ${fullPayload.title}`;
      }
    }

    // 1) 일정 업데이트
    let { error } = await supabase.from('schedules').update(fullPayload).eq('id', row.id);
    if (error) {
      // 최소 컬럼으로 재시도
      const safeKeys = ['title','start_ts','end_ts','employee_name','customer_name','customer_phone','site_address','location'];
      const safePayload: Record<string, any> = {};
      for (const k of safeKeys) safePayload[k] = fullPayload[k];
      const retry = await supabase.from('schedules').update(safePayload).eq('id', row.id);
      if (retry.error) {
        setErr(`저장 오류: ${retry.error.message}`);
        setSaving(false);
        return;
      }
    }

    // 2) 자재 사용내역 동기화(삭제→재입력) + 자재비 자동 반영
    try {
      const dateISO = (startISO || '').slice(0, 10);
      await syncMaterialsForSchedule(row.id, dateISO);
    } catch (e: any) {
      console.warn('materials sync failed:', e?.message ?? e);
      setErr(`자재 동기화 실패: ${e?.message ?? e}`);
      // 계속 진행(일정은 저장됨)
    }

    setSaving(false);
    setEditing(false);
  };

  // ✅ 삭제 핸들러: 자재 사용내역도 함께 제거
  const onDelete = async () => {
    setErr(null);
    const ok = typeof window !== 'undefined'
      ? window.confirm('정말로 이 일정을 삭제할까요? 연결된 자재 사용내역도 함께 삭제됩니다.')
      : true;
    if (!ok) return;

    setDeleting(true);

    // 1) 자재 사용내역 삭제
    const delUsage = await supabase.from('material_usages').delete().eq('schedule_id', row.id);
    if (delUsage.error) {
      setErr(`자재내역 삭제 오류: ${delUsage.error.message}`);
      setDeleting(false);
      return;
    }

    // 2) 일정 삭제
    const { error } = await supabase.from('schedules').delete().eq('id', row.id);
    if (error) {
      setErr(`삭제 오류: ${error.message}`);
      setDeleting(false);
      return;
    }
    setDeleting(false);
    onClose();
  };

  // 💰 금액 표시 텍스트
  const moneyText = {
    revenue: moneyOrDash(row.revenue),
    material: isAdmin ? moneyOrDash(row.material_cost) : (isManager ? (row.material_cost != null ? '***' : '-') : moneyOrDash(row.material_cost)),
    wage: moneyOrDash(row.daily_wage),
    extra: moneyOrDash(row.extra_cost),
    net: isAdmin ? (net == null ? '-' : formatKRW(net)) : (isManager ? (net != null ? '***' : '-') : (net == null ? '-' : formatKRW(net))),
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div
        className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white w-[min(860px,94vw)] shadow-2xl flex flex-col"
        style={{ maxHeight: '85vh' }}
      >
        {/* 헤더: 고정 */}
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/90 backdrop-blur px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-sky-800">🗂️ 일정 {editing ? '수정' : '상세'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">✕</button>
        </div>

        {/* 본문: 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {err && (
            <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2">
              {err}
            </div>
          )}

          {!editing ? (
            <>
              {/* === 상세 보기 === */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Info label="작업내용" value={row.title || (effectiveOff(row) ? '휴무' : '(제목없음)')} />
                <Info label="직원" value={effectiveNames(row).join(', ') || '-'} />
                <Info label="예약시간" value={start ? fmt(start, 'yyyy-MM-dd HH:mm') : '-'} />
                <Info label="현장주소" value={row.site_address || '-'} />
                <Info label="고객이름" value={row.customer_name || '-'} />
                <Info label="고객 번호" value={row.customer_phone || '-'} />
                <Info label="휴무" value={effectiveOff(row) ? '예' : '아니오'} />
              </div>

              {(isAdmin || isManager) && (
                <div className="mt-4 border-t pt-3">
                  <div className="text-sm font-semibold mb-2">💰 금액 정보</div>
                  {hasFinanceCols === false ? (
                    <div className="text-sm text-slate-500">테이블에 금액 컬럼이 없어 금액 정보를 표시할 수 없습니다.</div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <Info label="총매출"  value={moneyText.revenue} />
                      <Info label="자재비"  value={moneyText.material} />
                      <Info label="인건비"  value={moneyText.wage} />
                      <Info label="기타비용" value={moneyText.extra} />
                      <Info label="순수익"  value={moneyText.net} highlight />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* === 수정 폼 === */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <EditField label="작업내용">
                  <input className="input" value={edit.title} onChange={e => setEdit(s => ({ ...s, title: e.target.value }))} />
                </EditField>

                {/* ✅ 직원 선택(클릭 토글 + 칩) */}
                <EditField label="직원 이름 (여러 명 선택)">
                  <MultiPick
                    search={empEditSearch}
                    setSearch={setEmpEditSearch}
                    options={filteredEmpForEdit}
                    values={edit.empNames}
                    onToggle={(name) => {
                      setEdit(s => {
                        const has = s.empNames.includes(name);
                        return { ...s, empNames: has ? s.empNames.filter(n => n!==name) : [...s.empNames, name] };
                      });
                    }}
                    placeholder="직원이름 검색"
                  />
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
                  <EditField label="자재비(수동)">
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

              {/* 자재 피커 */}
              <div className="mt-4">
                <MaterialsPicker
                  lines={linesEdit}
                  setLines={setLinesEdit}
                  materials={materials}
                  locations={locations}
                />
                <p className="text-[11px] text-slate-500 mt-2">
                  저장 시 현재 입력한 자재 사용내역으로 갈아끼우고(기존 내역 삭제), 자재비는 단가×수량으로 자동 반영됩니다.
                </p>
              </div>
            </>
          )}
        </div>

        {/* 푸터: 고정 */}
        <div className="sticky bottom-0 z-10 border-t border-slate-100 bg-white/90 backdrop-blur px-5 py-3">
          {!editing ? (
            <div className="flex justify-end gap-2">
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
          ) : (
            <div className="flex justify-end gap-2">
              <button onClick={onSave} disabled={saving} className="btn-primary disabled:opacity-50">저장</button>
              <button
                onClick={() => {
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
                  setLinesEdit([]);
                  setEmpEditSearch('');
                  setEditing(false);
                }}
                className="btn"
              >
                취소
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- 특정 날짜 전체 보기 모달 ---------- */
function DayDetailModal({
  date, items, onClose, onAdd, onView, isAdmin, isManager
}: {
  date: Date;
  items: Row[];
  onClose: () => void;
  onAdd: () => void;
  onView: (id:number) => void;
  isAdmin: boolean;
  isManager: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div
        className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white w-[min(860px,94vw)] shadow-2xl flex flex-col"
        style={{ maxHeight: '85vh' }}
      >
        {/* 헤더: 고정 */}
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/90 backdrop-blur px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-sky-800">📅 {fmt(date, 'yyyy-MM-dd')} 일정({items.length}건)</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">✕</button>
        </div>

        {/* 본문: 스크롤 */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <div className="flex justify-between mb-2">
            <div className="text-sm text-slate-600">해당 날짜의 모든 일정을 한눈에 확인하고 클릭해 상세로 들어갈 수 있어요.</div>
            <button className="btn" onClick={onAdd}>+ 이 날짜에 추가</button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 divide-y">
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
                  className={`w-full text-left p-3 hover:bg-slate-50 relative ${isOff ? 'border border-rose-400 rounded-lg' : ''}`}
                  title="클릭하여 상세 보기"
                >
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
                    {isManager && net != null && !isAdmin && <span className="font-semibold text-amber-700">💰 순익 ***</span>}
                    {isOff && <span className="text-rose-600 font-semibold">⛔ 휴무</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 푸터: 고정 */}
        <div className="sticky bottom-0 z-10 border-t border-slate-100 bg-white/90 backdrop-blur px-5 py-3 flex justify-end">
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
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm text-slate-600 mb-1">{label}</div>
      {children}
    </label>
  );
}

/* ✅ 직원 클릭-토글 + 칩 컴포넌트 */
function MultiPick({
  search, setSearch, options, values, onToggle, placeholder,
}: {
  search: string; setSearch: (v: string) => void;
  options: string[];
  values: string[];
  onToggle: (name: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <input
        className="input"
        placeholder={placeholder ?? '검색'}
        value={search}
        onChange={(e)=>setSearch(e.target.value)}
      />
      {/* 선택된 칩 */}
      <div className="flex flex-wrap gap-2 min-h-[36px] p-2 rounded border border-slate-200 bg-slate-50/50">
        {values.length === 0 ? (
          <span className="text-[12px] text-slate-500">선택된 직원 없음</span>
        ) : values.map((v) => (
          <button
            key={v}
            onClick={()=>onToggle(v)}
            className="text-xs px-2 py-1 rounded-full border bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100"
            title="클릭하면 제거됩니다"
            type="button"
          >
            {v} ✕
          </button>
        ))}
      </div>
      {/* 클릭 리스트 */}
      <div className="max-h-40 overflow-auto rounded border border-slate-200 divide-y">
        {options.length === 0 && (
          <div className="p-2 text-[12px] text-slate-500">검색 결과 없음</div>
        )}
        {options.map((name) => {
          const sel = values.includes(name);
          return (
            <button
              key={name}
              type="button"
              onClick={()=>onToggle(name)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                sel ? 'bg-sky-50 text-sky-800' : 'bg-white'
              }`}
              title={sel ? '클릭하면 선택 해제' : '클릭하면 선택'}
            >
              {sel ? '✓ ' : ''}{name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- 달력 그리드 (데스크탑) ---------- */
function MonthGrid({
  days, baseDate, onAdd, onView, onDayClick, isAdmin, isManager, hasFinanceCols,
}: {
  days: DayCell[]; baseDate: Date;
  onAdd: (d: Date) => void;
  onView: (id: number) => void;
  onDayClick: (d: Date) => void;
  isAdmin: boolean;
  isManager: boolean;
  hasFinanceCols: boolean | null;
}) {
  const weekDays = ['일','월','화','수','목','금','토'];

  return (
    <div>
      <div className="grid grid-cols-7 bg-sky-50/60 border-b border-sky-100">
        {weekDays.map(w => (
          <div key={w} className="p-2 text-center text-sm font-semibold text-sky-900">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map(({ date, items }, idx) => {
          const outMonth = !isSameMonth(date, baseDate);
          const today = isSameDay(date, new Date());
          return (
            <div key={idx} className="h-44 border-b border-r border-sky-100 p-1 align-top">
              <div className="flex items-center justify-between mb-1">
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
                      {r.isTeam && <span className="absolute left-0 top-0 h-full w-0.5 bg-sky-500 rounded-l" />}
                      <div className="truncate font-medium text-slate-800">{r.title}</div>
                      {r.emp && <div className="truncate text-[10px] text-slate-600">{r.emp}</div>}
                      {r.isOff && <div className="mt-0.5 text-[10px] text-rose-600 font-semibold">⛔ 휴무</div>}
                      {(isAdmin || isManager) && (
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

/* ---------- 모바일 Agenda 리스트(가독성↑) ---------- */
function MonthAgendaMobile({
  days, baseDate, onAdd, onView, onDayClick, isAdmin, isManager, hasFinanceCols,
}: {
  days: DayCell[]; baseDate: Date;
  onAdd: (d: Date) => void;
  onView: (id: number) => void;
  onDayClick: (d: Date) => void;
  isAdmin: boolean;
  isManager: boolean;
  hasFinanceCols: boolean | null;
}) {
  // 이번 달 날짜만 추림
  const inMonth = days.filter(d => isSameMonth(d.date, baseDate));

  const week = ['일','월','화','수','목','금','토'];

  return (
    <div className="divide-y">
      {inMonth.map(({ date, items }) => {
        const today = isSameDay(date, new Date());
        return (
          <div key={date.toISOString()}>
            {/* 날짜 헤더 */}
            <div className="flex items-center justify-between px-3 py-2 bg-sky-50/60">
              <button
                onClick={() => onDayClick(new Date(date))}
                className="text-sm font-semibold text-slate-800"
                title="이 날짜 일정 전체 보기"
              >
                {fmt(date, 'M월 d일')} <span className="text-slate-500">({week[date.getDay()]})</span>
              </button>
              <div className="flex items-center gap-2">
                {today && <span className="text-[10px] px-1 rounded border border-sky-200 bg-sky-50 text-sky-800">오늘</span>}
                <button
                  onClick={() => onAdd(new Date(date))}
                  className="text-[11px] px-2 h-7 rounded border border-slate-200 hover:bg-slate-50"
                  title="이 날짜에 일정 추가"
                >
                  + 추가
                </button>
              </div>
            </div>

            {/* 일정 리스트 */}
            {items.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">일정 없음</div>
            ) : (
              <ul className="px-2 py-1 space-y-1">
                {items.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => onView(r.id)}
                      className={`w-full text-left rounded border px-2 py-1 text-[12px] hover:bg-slate-50 ${
                        r.isOff ? 'border-rose-400' : 'border-slate-200'
                      } relative`}
                      title={r.emp ? `${r.title}\n(${r.emp})` : r.title}
                    >
                      {r.isTeam && <span className="absolute left-0 top-0 h-full w-0.5 bg-sky-500 rounded-l" />}
                      <div className="truncate font-medium text-slate-800">{r.title}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                        {r.emp && <span className="truncate">👤 {r.emp}</span>}
                        {r.isOff && <span className="text-rose-600 font-semibold">⛔ 휴무</span>}
                        {(isAdmin || isManager) && (
                          <span className="text-amber-700">
                            {r.netText ?? (hasFinanceCols === false ? '순익 -' : '')}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
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
function effectiveOff(r: Row): boolean {
  if (typeof r.off_day === 'boolean') return r.off_day;
  const t = (r.title ?? '').trim();
  if (!t) return false;
  return t === '휴무' || t.startsWith('휴무 ') || t.startsWith('휴무-') || t.startsWith('[휴무]');
}

/* ---------- 생성 레코드 → Row 매핑 (낙관 갱신용) ---------- */
function mapCreatedToRow(
  created: any,
  supportsMultiEmp: boolean,
  supportsOff: boolean,
  empNames: string[],
  fullPayload: Record<string, any>,
  startISO: string,
  endISO: string
): Row {
  return {
    id: created.id,
    title: created.title ?? fullPayload.title ?? null,
    start_ts: created.start_ts ?? startISO,
    end_ts: created.end_ts ?? endISO,
    employee_id: created.employee_id ?? null,
    employee_name: created.employee_name ?? (supportsMultiEmp ? null : (empNames.join(', ') || null)),
    employee_names: created.employee_names ?? (supportsMultiEmp ? empNames : null),
    off_day: typeof created.off_day === 'boolean' ? created.off_day : (supportsOff ? !!fullPayload.off_day : null),
    customer_name: created.customer_name ?? fullPayload.customer_name ?? null,
    customer_phone: created.customer_phone ?? fullPayload.customer_phone ?? null,
    site_address: created.site_address ?? fullPayload.site_address ?? null,
    revenue: created.revenue ?? fullPayload.revenue ?? null,
    material_cost: created.material_cost ?? fullPayload.material_cost ?? null,
    daily_wage: created.daily_wage ?? fullPayload.daily_wage ?? null,
    extra_cost: created.extra_cost ?? fullPayload.extra_cost ?? null,
  };
}
