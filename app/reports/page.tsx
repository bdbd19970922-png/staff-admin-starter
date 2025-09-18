// FILE: app/reports/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  format, startOfMonth, endOfMonth, isAfter, isBefore, addDays,
} from 'date-fns';

// ===== 세션 준비 대기(Unauthorized 예방) =====
async function waitForAuthReady(maxTries = 6, delayMs = 300) {
  for (let i = 0; i < maxTries; i++) {
    const { data, error } = await supabase.auth.getSession();
    const hasToken = !!data?.session?.access_token;
    if (!error && hasToken) return data.session!;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

type Row = {
  id: number;
  // reports_secure 기준
  work_date?: string | null;                 // ← 뷰에서 date(s.start_ts)
  employee_id?: string | null;
  employee_name?: string | null;
  revenue?: number | null;
  material_cost_visible?: number | null;     // ← 항상 이 컬럼만 사용(마스킹 반영됨)
  daily_wage?: number | null;
  extra_cost?: number | null;
  net_profit_visible?: number | null;        // ← 관리자만 값, 비관리자 null
};

type GroupedRow = {
  key: string;
  label: string;
  count: number;
  revenue: number;
  material_cost_visible: number;             // ← visible 기준 합산
  daily_wage: number;
  extra_cost: number;
  employee_id?: string | null;
  employee_name?: string | null;
};
type Grouped = {
  rows: GroupedRow[];
  total: GroupedRow;
};

type Mode = 'daily' | 'monthly' | 'employee';
type Metric = 'revenue' | 'net' | 'daily_wage';

export default function ReportsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [isAdmin, setIsAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const isElevated = isAdmin || isManager; // 관리자 or 매니저

  // 현재 로그인 사용자 정보(직원 모드에서 본인 필터에 사용)
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  // 보기/그래프 옵션
  const [mode, setMode] = useState<Mode>('daily');
  const [metric, setMetric] = useState<Metric>('revenue');
  const [curved, setCurved] = useState(true);

  // 날짜 범위 (기본: 이번 달)
  const [dateFrom, setDateFrom] = useState<string>(() => toDateInputValue(startOfMonth(new Date())));
  const [dateTo, setDateTo] = useState<string>(() => toDateInputValue(endOfMonth(new Date())));

  // 직원별 보기에서 사용할 "직원 선택"
  const [empNameFilter, setEmpNameFilter] = useState<string>('all');

  // ===== 권한/사용자명 로드 =====
  useEffect(() => {
    (async () => {
      await waitForAuthReady();

      const adminIds = (process.env.NEXT_PUBLIC_ADMIN_IDS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? '';
      const email = (session?.user?.email ?? '').toLowerCase();
      setUserId(uid || null);
      setIsAdmin((!!uid && adminIds.includes(uid)) || (!!email && adminEmails.includes(email)));

      // 프로필에서 매니저 플래그 & 이름
      let name: string | null = null;
      if (uid) {
        const prof = await supabase
          .from('profiles')
          .select('display_name, full_name, name, is_manager, is_admin')
          .eq('id', uid)
          .maybeSingle();
        if (!prof.error) {
          name = (prof.data?.display_name || prof.data?.full_name || prof.data?.name || '').trim() || null;
          if (prof.data?.is_manager) setIsManager(true);
          if (prof.data?.is_admin) setIsAdmin(true); // DB is_admin도 인정
        }
      }
      // 메타데이터 fallback
      if (!name) {
        const metaName =
          (session?.user?.user_metadata?.name ??
            session?.user?.user_metadata?.full_name ??
            session?.user?.user_metadata?.user_name) as string | undefined;
        name = (metaName || '').trim() || null;
      }
      setUserName(name);
    })();
  }, []);

  // ===== 데이터 로드 (보안 뷰) =====
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);
      await waitForAuthReady();

      const sel =
        'id,employee_id,employee_name,work_date,revenue,daily_wage,extra_cost,material_cost_visible,net_profit_visible';

      // 기본: 리포트 보안뷰 사용
      let { data, error } = await supabase
        .from('reports_secure')
        .select(sel)
        .order('work_date', { ascending: false })
        .returns<Row[]>();

      if (error) {
        // 폴백: 최소 컬럼만 schedules_secure에서 읽기
        const sel2 =
          'id,title,start_ts,end_ts,employee_id,employee_name,employee_names,off_day,customer_name,customer_phone,site_address,revenue,material_cost,daily_wage,extra_cost,net_profit_visible';
        const fb = await supabase
          .from('schedules_secure')
          .select(sel2)
          .order('start_ts', { ascending: true })
          .returns<Row[]>();
        data = fb.data; error = fb.error;
      }

      if (error) { setMsg(`불러오기 오류: ${error.message}`); setRows([]); }
      else { setRows(data ?? []); }
      setLoading(false);
    })();
  }, []);

  // ✅ 권한 기반 1차 필터
  //   - 관리자/매니저: 전사 데이터
  //   - 직원: 본인 것만
  const rowsForUser = useMemo(() => {
    if (isElevated) return rows;
    const uid = (userId ?? '').trim();
    const uname = normalizeName(userName);
    if (!uid && !uname) return [];
    return rows.filter(r => {
      const matchId = !!uid && (r.employee_id ?? '').trim() === uid;
      const matchName = !!uname && normalizeName(r.employee_name) === uname;
      return matchId || matchName;
    });
  }, [rows, isElevated, userId, userName]);

  // 날짜로 2차 필터 (work_date 기준)
  const filteredByDate = useMemo(() => {
    const s = parseDateInput(dateFrom);
    const e = parseDateInput(dateTo);
    if (!s || !e) return rowsForUser;
    return rowsForUser.filter(r => {
      const d = parseDateInput((r.work_date ?? '').toString());
      if (!d) return false;
      return !isBefore(d, s) && !isAfter(d, e);
    });
  }, [rowsForUser, dateFrom, dateTo]);

  // 직원 이름 목록(날짜 필터 적용 후)
  const employeeNameOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of filteredByDate) {
      const name = ((r.employee_name ?? '').trim()) || '(미지정)';
      set.add(name);
    }
    return ['전체', ...Array.from(set).sort((a,b)=>a.localeCompare(b,'ko'))];
  }, [filteredByDate]);

  // 직원별 모드에서 추가 직원 필터 적용
  const filteredForBranding = useMemo(() => {
    if (mode !== 'employee' || empNameFilter === 'all') return filteredByDate;
    const target = empNameFilter;
    return filteredByDate.filter(r => (((r.employee_name ?? '').trim()) || '(미지정)').toLowerCase() === target);
  }, [filteredByDate, mode, empNameFilter]);

  // 테이블용 그룹핑
  const grouped: Grouped = useMemo(() => {
    if (mode === 'employee') return groupByEmployee(filteredForBranding);
    if (mode === 'monthly')  return groupByMonth(filteredByDate);
    return groupByDay(filteredByDate);
  }, [filteredForBranding, filteredByDate, mode]);

  // (중요) 비관리자는 net 선택 시 강제로 revenue로 대체(매니저도 마스킹)
  const metricSafe: Metric = useMemo(
    () => (!isAdmin && metric === 'net') ? 'revenue' : metric,
    [isAdmin, metric]
  );

  // 그래프: 항상 "일자별 X축" (work_date 사용)
  const chartDaily = useMemo(() => {
    const s = parseDateInput(dateFrom);
    const e = parseDateInput(dateTo);
    if (!s || !e) return { labels: [] as string[], values: [] as number[] };

    const baseRows = (mode === 'employee' && empNameFilter !== 'all')
      ? filteredByDate.filter(r => (((r.employee_name ?? '').trim()) || '(미지정)').toLowerCase() === empNameFilter)
      : filteredByDate;

    const days: Date[] = [];
    for (let d = new Date(s); !isAfter(d, e); d = addDays(d, 1)) days.push(new Date(d));

    const labels = days.map(d => format(d, 'yyyy-MM-dd'));
    const values = days.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      let sum = 0;
      for (const r of baseRows) {
        const d2 = parseDateInput((r.work_date ?? '').toString());
        if (!d2) continue;
        const k = format(d2, 'yyyy-MM-dd');
        if (k !== key) continue;

        if (metricSafe === 'net') {
          if (!isAdmin) continue; // 매니저/직원은 순수익 집계 제외
          sum += num(r.net_profit_visible);
        } else if (metricSafe === 'revenue') {
          sum += num(r.revenue);
        } else if (metricSafe === 'daily_wage') {
          sum += num(r.daily_wage);
        }
      }
      return sum;
    });

    return { labels, values };
  }, [filteredByDate, dateFrom, dateTo, metricSafe, mode, empNameFilter, isAdmin]);

  // 직원별 인건비 → 급여 테이블 반영(관리자만)
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const canSyncPayroll = isAdmin && mode === 'employee';

 // ======== 안전 UPSERT ========
  /**
   * 안전 반영
   * - key = (employee_id, YYYY-MM)
   * - 이미 paid=true면 건너뜀
   * - 그 외는 upsert(onConflict: employee_id,pay_month)로 신규/갱신
   * - employee_id가 없으면(이름만) 기존 방식(SELECT→UPDATE/INSERT) 유지
   */
  async function safeUpsertPayroll(record: {
    employee_id: string | null;
    employee_name: string | null;
    pay_month: string;        // 화면표시용(YYYY-MM 또는 범위)
    period_start: string;
    period_end: string;
    amount: number | null;
    total_pay: number | null;
    memo: string | null;
  }) {
    // 1) 키 월(YYYY-MM) 확정 (TEXT 컬럼이므로 'YYYY-MM'로 고정)
    const keyMonth =
      toYYYYMM(record.pay_month) ||
      toYYYYMM(record.period_start) ||
      toYYYYMM(record.period_end);
    if (!keyMonth) throw new Error('pay_month 계산 실패');

    // 2) employee_id가 있으면: paid 여부만 조회 → paid면 스킵, 아니면 upsert
    if (record.employee_id) {
      // 2-1) 기존 paid 여부 조회
      const { data: ex, error: exErr } = await supabase
        .from('payrolls')
        .select('id, paid')
        .eq('employee_id', record.employee_id)
        .eq('pay_month', keyMonth)
        .maybeSingle();
      if (exErr && exErr.code !== 'PGRST116') throw exErr;

      if (ex?.paid === true) {
        // 지급완료는 보호
        return { action: 'skip_paid' as const };
      }

      // 2-2) 미지급 또는 없음 → upsert (유니크: employee_id,pay_month)
      const payload = {
        employee_id: record.employee_id,
        employee_name: record.employee_name,
        pay_month: keyMonth,          // TEXT 'YYYY-MM'
        period_start: record.period_start,
        period_end: record.period_end,
        amount: record.amount ?? null,
        total_pay: record.total_pay ?? record.amount ?? null,
        paid: ex?.paid ?? false,      // 기존이 있으면 그대로 유지(보통 false)
        paid_at: ex?.paid ? (new Date()).toISOString().slice(0,10) : null, // paid면 유지, 아니면 null
        memo: record.memo ?? null,
      };

      const { data, error } = await supabase
        .from('payrolls')
        .upsert([payload], {
          onConflict: 'employee_id,pay_month',
          ignoreDuplicates: false,
          defaultToNull: false,
        })
        .select('id');

      if (error) throw error;

      // 갱신/신규 구분은 응답으로는 애매하므로 기존 유무로 판단
      return { action: ex ? ('update' as const) : ('insert' as const) };
    }

    // 3) employee_id가 없는 경우(이름만 있는 케이스):
    //    유니크 제약을 쓸 수 없으니, 기존 SELECT → (paid면 스킵, 아니면 UPDATE) → 없으면 INSERT
    let existing: { id: string; paid: boolean } | null = null;
    let q = supabase
      .from('payrolls')
      .select('id, paid')
      .is('employee_id', null)
      .eq('pay_month', keyMonth)
      .limit(1);
    if (record.employee_name) q = q.ilike('employee_name', record.employee_name);
    const { data: ex2, error: exErr2 } = await q.maybeSingle();
    if (exErr2 && exErr2.code !== 'PGRST116') throw exErr2;
    existing = (ex2 as any) ?? null;

    if (existing) {
      if (existing.paid === true) {
        return { action: 'skip_paid' as const };
      }
      const { error: upErr } = await supabase
        .from('payrolls')
        .update({
          amount: record.amount ?? null,
          total_pay: record.total_pay ?? record.amount ?? null,
          memo: record.memo ?? null,
          period_start: record.period_start,
          period_end: record.period_end,
        })
        .eq('id', existing.id);
      if (upErr) throw upErr;
      return { action: 'update' as const };
    } else {
      const payload2 = {
        employee_id: null as string | null,
        employee_name: record.employee_name,
        pay_month: keyMonth,
        period_start: record.period_start,
        period_end: record.period_end,
        amount: record.amount ?? null,
        total_pay: record.total_pay ?? record.amount ?? null,
        paid: false,
        paid_at: null,
        memo: record.memo ?? null,
      };
      const { error: insErr } = await supabase.from('payrolls').insert(payload2);
      if (insErr) throw insErr;
      return { action: 'insert' as const };
    }


    // 3-3) 없으면 INSERT
    const payload = {
      employee_id: record.employee_id,
      employee_name: record.employee_name,
      pay_month: keyMonth,        // TEXT 컬럼 → 'YYYY-MM'로 저장
      period_start: record.period_start,
      period_end: record.period_end,
      amount: record.amount ?? null,
      total_pay: record.total_pay ?? record.amount ?? null,
      paid: false,
      paid_at: null,
      memo: record.memo ?? null,
    };
    const { error: insErr } = await supabase.from('payrolls').insert(payload);
    if (insErr) throw insErr;
    return { action: 'insert' as const };
  }

  /**
   * 버튼 클릭 핸들러
   * - 직원별로 합산 → 이름→ID 매칭 → 중복 키(직원/월)로 dedup → safeUpsert 반복
   * - 완료 메시지: 신규/갱신/건너뜀(지급완료)
   */
  const syncPayrolls = async () => {
    if (!canSyncPayroll) return;
    setSyncMsg(null);

    // 1) 기간 유효성
    const s = parseDateInput(dateFrom);
    const e = parseDateInput(dateTo);
    if (s == null || e == null) {
      setSyncMsg('⚠️ 기간을 올바르게 선택해주세요.');
      return;
    }
    const sameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
    const payMonthDisplay = sameMonth ? format(s, 'yyyy-MM') : `${dateFrom}~${dateTo}`;

    // 2) 직원별 집계
    const byEmp = groupByEmployee(filteredByDate);

    // 3) 이름→ID 해석(스케줄에서 단일 ID면 채택)
    const needResolve = byEmp.rows.filter(r => !r.employee_id).map(r => r.label);
    const resolvedMap = new Map<string, string>();
    await Promise.all(
      needResolve.map(async (name) => {
        const id = await resolveEmployeeIdByName(name);
        if (id) resolvedMap.set(name, id);
      })
    );

    // 4) 레코드 초안
    const raw = byEmp.rows.map(r => {
      const id = r.employee_id ?? resolvedMap.get(r.label) ?? null;
      const name = (r.employee_name ?? r.label ?? '').trim();
      const total = r.daily_wage;
      return {
        employee_id: id,
        employee_name: name || null,
        pay_month: payMonthDisplay,
        period_start: dateFrom,
        period_end: dateTo,
        amount: total,
        total_pay: total,
        paid: false,
        paid_at: null,
        memo: ' ',
      };
    });

    // 5) 키(ID|월 or name|월)로 합산/중복제거
    const dedup = new Map<string, typeof raw[number]>();
    for (const r of raw) {
      const key =
        (r.employee_id ? `id:${r.employee_id}` : `name:${(r.employee_name ?? '').toLowerCase()}`) +
        `|${toYYYYMM(r.pay_month) || toYYYYMM(r.period_start)}`;
      const prev = dedup.get(key);
      if (!prev) dedup.set(key, { ...r });
      else {
        const sumv = (Number(prev.total_pay ?? 0) || 0) + (Number(r.total_pay ?? 0) || 0);
        dedup.set(key, { ...prev, amount: sumv, total_pay: sumv });
      }
    }
    const records = Array.from(dedup.values());

    // 6) 안전 반영 루프
    try {
      let inserted = 0, updated = 0, skippedPaid = 0;
      for (const r of records) {
        const res = await safeUpsertPayroll(r);
        if (res.action === 'insert') inserted++;
        else if (res.action === 'update') updated++;
        else skippedPaid++;
      }
      const skippedNote = skippedPaid ? ` / 지급완료라 건너뜀 ${skippedPaid}건` : '';
      setSyncMsg(`✅ 급여 반영 완료: 신규 ${inserted}건 / 갱신 ${updated}건${skippedNote}`);
    } catch (err: any) {
      setSyncMsg(`⚠️ 급여 반영 실패: ${err?.message ?? '알 수 없는 오류'}`);
    }
  };
// ======== 안전 UPSERT 끝 ========



  return (
    <div>
      <div className="p-4 space-y-4">
        <h1 className="text-2xl font-extrabold">
          <span className="title-gradient">📊 리포트</span>
        </h1>

        {/* 컨트롤 바 */}
        <div className="card p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col">
                <label className="text-xs text-gray-600">보기</label>
                <select
                  className="select min-w-[140px]"
                  value={mode}
                  onChange={e => { setMode(e.target.value as Mode); }}
                >
                  <option value="daily">일별</option>
                  <option value="monthly">월별</option>
                  <option value="employee">직원별</option>
                </select>
              </div>

              {/* 직원별 모드에서만 노출: 직원 선택 */}
              {mode === 'employee' && (
                <div className="flex flex-col">
                  <label className="text-xs text-gray-600">직원 선택</label>
                  <select
                    className="select min-w-[160px]"
                    value={empNameFilter}
                    onChange={e => setEmpNameFilter(e.target.value)}
                  >
                    <option value="all">전체</option>
                    {employeeNameOptions.slice(1).map(name => (
                      <option key={name} value={name.toLowerCase()}>{name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col">
                <label className="text-xs text-gray-600">지표</label>
                <select
                  className="select min-w-[140px]"
                  value={(!isAdmin && metric === 'net') ? 'revenue' : metric}
                  onChange={e => setMetric(e.target.value as Metric)}
                >
                  <option value="revenue">매출</option>
                  <option value="daily_wage">인건비</option>
                  {isAdmin && <option value="net">순수익</option>}
                </select>
              </div>

              <label className="mt-1.5 inline-flex items-center gap-2 text-sm">
                <input
                  id="curved"
                  type="checkbox"
                  className="h-4 w-4 accent-sky-500"
                  checked={curved}
                  onChange={e => setCurved(e.target.checked)}
                />
                곡선 그래프
              </label>

              <div className="flex items-end gap-2">
                <div className="flex flex-col">
                  <label className="text-xs text-gray-600">시작</label>
                  <input
                    type="date"
                    className="input min-w-[150px]"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs text-gray-600">종료</label>
                  <input
                    type="date"
                    className="input min-w-[150px]"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                  />
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    setDateFrom(toDateInputValue(startOfMonth(new Date())));
                    setDateTo(toDateInputValue(endOfMonth(new Date())));
                  }}
                >
                  이번 달
                </button>
              </div>
            </div>

            {isAdmin && mode === 'employee' && (
              <div className="flex items-end">
                <button
                  className="btn btn-primary"
                  onClick={syncPayrolls}
                >
                  직원별 인건비 → 급여 반영
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 동기화/에러 메시지 */}
        {syncMsg && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-2 text-sm text-sky-800">
            {syncMsg}
          </div>
        )}
        {msg && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {msg}
          </div>
        )}

        {/* 그래프 */}
        <div className="card p-3">
          {loading ? (
            <div className="text-sm text-gray-600">그래프 준비 중…</div>
          ) : chartDaily.labels.length === 0 ? (
            <div className="text-sm text-gray-500">표시할 데이터가 없습니다.</div>
          ) : (
            <LineChart labels={chartDaily.labels} values={chartDaily.values} curved={curved} />
          )}
        </div>

        {/* 표 */}
        <div className="card p-3">
          {loading ? (
            <div className="text-sm text-gray-600">불러오는 중…</div>
          ) : (
            <TableReport
              mode={mode}
              data={grouped}
              isAdmin={isAdmin}   // ← 관리자만 민감값 표시
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* =================== 표 컴포넌트 =================== */
function TableReport({
  mode, data, isAdmin,
}: {
  mode: Mode;
  data: Grouped;
  isAdmin: boolean;
}) {
  const baseHeaders = mode === 'employee'
    ? ['직원', '건수', '매출', '자재비', '인건비', '기타비용']
    : ['기간', '건수', '매출', '자재비', '인건비', '기타비용'];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[760px] w-full border border-sky-100">
        <thead className="bg-sky-50">
          <tr>
            {baseHeaders.map(h => (
              <th key={h} className="border border-sky-100 px-2 py-1 text-left text-sm">{h}</th>
            ))}
            <th className="border border-sky-100 px-2 py-1 text-left text-sm">순수익</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => {
            const net = computeNetGrouped(r);
            return (
              <tr key={r.key} className="hover:bg-sky-50/50">
                <td className="border border-sky-100 px-2 py-1 text-sm">{r.label}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{r.count}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{fmtMoney(r.revenue)}</td>

                {/* 자재비: 관리자만 숫자, 그 외 *** */}
                <td className="border border-sky-100 px-2 py-1 text-sm">
                  {isAdmin ? fmtMoney(r.material_cost_visible) : '***'}
                </td>

                <td className="border border-sky-100 px-2 py-1 text-sm">{fmtMoney(r.daily_wage)}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{fmtMoney(r.extra_cost)}</td>

                {/* 순수익: 관리자만 숫자, 그 외 *** */}
                <td className="border border-sky-100 px-2 py-1 text-sm">
                  {isAdmin ? fmtMoney(net) : '***'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-sky-50">
          {(() => {
            const totalNet = computeNetGrouped(data.total);
            return (
              <tr>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">합계</td>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">{data.total.count}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">{fmtMoney(data.total.revenue)}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">
                  {isAdmin ? fmtMoney(data.total.material_cost_visible) : '***'}
                </td>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">{fmtMoney(data.total.daily_wage)}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">{fmtMoney(data.total.extra_cost)}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">
                  {isAdmin ? fmtMoney(totalNet) : '***'}
                </td>
              </tr>
            );
          })()}
        </tfoot>
      </table>
    </div>
  );
}

/* =================== 라인 차트(SVG) =================== */
function LineChart({ labels, values, curved }: { labels: string[]; values: number[]; curved: boolean }) {
  const w = Math.max(320, Math.min(1040, labels.length * 64));
  const h = 280;
  const pad = { l: 48, r: 12, t: 18, b: 40 };

  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = maxV - minV || 1;

  const points = values.map((v, i) => {
    const x = pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, labels.length - 1);
    const y = pad.t + (h - pad.t - pad.b) * (1 - (v - minV) / span);
    return { x, y };
  });

  const path = curved ? buildSmoothPath(points) : buildPolyline(points);

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = minV + (span * i) / ticks;
    const y = pad.t + (h - pad.t - pad.b) * (1 - (v - minV) / span);
    return { v, y };
  });

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h}>
        <line x1={pad.l} y1={h - pad.b} x2={w - pad.r} y2={h - pad.b} stroke="#ddd" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={h - pad.b} stroke="#ddd" />

        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} y1={t.y} x2={w - pad.r} y2={t.y} stroke="#f0f0f0" />
            <text x={pad.l - 6} y={t.y + 4} fontSize="10" textAnchor="end">
              {fmtMoney(t.v)}
            </text>
          </g>
        ))}

        {/* x 라벨 (최대 12개만 표시) */}
        {labels.map((lab, i) => {
          const show = labels.length <= 12 || i % Math.ceil(labels.length / 12) === 0;
          if (!show) return null;
          const x = pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, labels.length - 1);
          return (
            <text key={i} x={x} y={h - pad.b + 14} fontSize="10" textAnchor="middle">
              {lab}
            </text>
          );
        })}

        <path d={path} fill="none" stroke="black" strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2} fill="black" />
        ))}
      </svg>
    </div>
  );
}
function buildPolyline(pts: {x:number;y:number}[]) {
  if (pts.length === 0) return '';
  const d = ['M', pts[0].x, pts[0].y, ...pts.slice(1).flatMap(p => ['L', p.x, p.y])];
  return d.join(' ');
}
function buildSmoothPath(pts: {x:number;y:number}[]) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const d: (string|number)[] = ['M', pts[0].x, pts[0].y];
  const t = 0.2;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const dx = p1.x - p0.x;
    d.push('C', p0.x + dx * t, p0.y, p1.x - dx * t, p1.y, p1.x, p1.y);
  }
  return d.join(' ');
}

/* =================== 그룹핑/유틸 =================== */
function groupByDay(rows: Row[]): Grouped {
  return group(rows, (d) => format(d, 'yyyy-MM-dd'));
}
function groupByMonth(rows: Row[]): Grouped {
  return group(rows, (d) => format(d, 'yyyy-MM'));
}
function groupByEmployee(rows: Row[]): Grouped {
  type Acc = GroupedRow & { _ids: Set<string> };
  const map = new Map<string, Acc>();

  for (const r of rows) {
    const name = ((r.employee_name ?? '').trim()) || '(미지정)';
    const norm = name.toLowerCase();

    if (!map.has(norm)) {
      map.set(norm, {
        key: norm,
        label: name,
        count: 0,
        revenue: 0,
        material_cost_visible: 0,
        daily_wage: 0,
        extra_cost: 0,
        employee_id: null,
        employee_name: name,
        _ids: new Set<string>(),
      });
    }
    const g = map.get(norm)!;
    g.count += 1;
    g.revenue                 += num(r.revenue);
    g.material_cost_visible   += num(r.material_cost_visible);
    g.daily_wage              += num(r.daily_wage);
    g.extra_cost              += num(r.extra_cost);

    const id = (r.employee_id ?? '').trim();
    if (id) g._ids.add(id);
  }

  const list: GroupedRow[] = [];
  for (const g of map.values()) {
    const ids = Array.from(g._ids);
    const employee_id = ids.length === 1 ? ids[0] : null;
    list.push({
      key: g.key,
      label: g.label,
      count: g.count,
      revenue: g.revenue,
      material_cost_visible: g.material_cost_visible,
      daily_wage: g.daily_wage,
      extra_cost: g.extra_cost,
      employee_id,
      employee_name: g.employee_name,
    } as GroupedRow);
  }

  list.sort((a,b)=>a.label.localeCompare(b.label,'ko'));
  const total = list.reduce(sumGroups, emptyGroup('TOTAL','TOTAL'));
  return { rows: list, total };
}

function group(rows: Row[], keyOf: (d: Date) => string): Grouped {
  const map = new Map<string, GroupedRow>();
  for (const r of rows) {
    const d = parseDateInput((r.work_date ?? '').toString());
    if (!d) continue;
    const key = keyOf(d);
    if (!map.has(key)) map.set(key, emptyGroup(key, key));
    const g = map.get(key)!;
    g.count += 1;
    g.revenue               += num(r.revenue);
    g.material_cost_visible += num(r.material_cost_visible);
    g.daily_wage            += num(r.daily_wage);
    g.extra_cost            += num(r.extra_cost);
  }
  const list = Array.from(map.values()).sort((a,b)=>a.key.localeCompare(b.key));
  const total = list.reduce(sumGroups, emptyGroup('TOTAL','TOTAL'));
  return { rows: list, total };
}
function emptyGroup(key:string, label:string): GroupedRow {
  return { key, label, count:0, revenue:0, material_cost_visible:0, daily_wage:0, extra_cost:0 };
}
function sumGroups(acc: GroupedRow, r: GroupedRow): GroupedRow {
  return {
    key: 'TOTAL',
    label: 'TOTAL',
    count: acc.count + r.count,
    revenue: acc.revenue + r.revenue,
    material_cost_visible: acc.material_cost_visible + r.material_cost_visible,
    daily_wage: acc.daily_wage + r.daily_wage,
    extra_cost: acc.extra_cost + r.extra_cost,
  };
}

// 그룹 단위 순수익: 관리자일 때만 표시되도록 위에서 마스킹
function computeNetGrouped(x: {revenue:number; material_cost_visible:number; daily_wage:number; extra_cost:number}) {
  return num(x.revenue) - num(x.material_cost_visible) - num(x.daily_wage) - num(x.extra_cost);
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n) || n === 0) return n === 0 ? '₩0' : '-';
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n);
  } catch { return `${Math.round(n).toLocaleString()}원`; }
}
function num(v: number | null | undefined) { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; }

// 날짜 파서 (YYYY-MM-DD)
function parseDateInput(s: string) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(+d) ? null : d;
}
function toDateInputValue(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}
function toYYYYMM(s?: string | null) {
  if (!s) return '';
  return s.slice(0, 7);
}

// 이름 정규화
function normalizeName(n?: string | null) {
  return ((n ?? '').trim().toLowerCase()) || '';
}

/** schedules 전체에서 같은 이름의 employee_id가 "정확히 1개"면 그 ID 반환 */
async function resolveEmployeeIdByName(name: string): Promise<string | null> {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from('schedules')
    .select('employee_id, employee_name')
    .ilike('employee_name', trimmed)
    .not('employee_id', 'is', null);

  if (error) return null;

  const ids = Array.from(
    new Set((data ?? [])
      .map((r: any) => (r.employee_id as string | null)?.trim())
      .filter(Boolean) as string[])
  );
  return ids.length === 1 ? ids[0] : null;
}
