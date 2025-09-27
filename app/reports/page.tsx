// FILE: app/reports/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  format, startOfMonth, endOfMonth, isAfter, isBefore, addDays,
} from 'date-fns';

/* ===== 세션 준비 대기 ===== */
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
  work_date?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  revenue?: number | null;
  material_cost_visible?: number | null;
  daily_wage?: number | null;
  extra_cost?: number | null;
  net_profit_visible?: number | null;
};
type GroupedRow = {
  key: string;
  label: string;
  count: number;
  revenue: number;
  material_cost_visible: number;
  daily_wage: number;
  extra_cost: number;
  employee_id?: string | null;
  employee_name?: string | null;
};
type Grouped = { rows: GroupedRow[]; total: GroupedRow };

type Mode = 'daily' | 'monthly' | 'employee';
type Metric = 'revenue' | 'net' | 'daily_wage';

export default function ReportsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [isAdmin, setIsAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const isElevated = isAdmin || isManager;

  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('daily');
  const [metric, setMetric] = useState<Metric>('revenue');
  const [curved, setCurved] = useState(true);

  const [dateFrom, setDateFrom] = useState<string>(() => toDateInputValue(startOfMonth(new Date())));
  const [dateTo, setDateTo] = useState<string>(() => toDateInputValue(endOfMonth(new Date())));
  const [empNameFilter, setEmpNameFilter] = useState<string>('all');

  /* ===== 권한/사용자 로드 ===== */
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

      let admin = (!!uid && adminIds.includes(uid)) || (!!email && adminEmails.includes(email));
      let manager = false;

      let name: string | null = null;
      if (uid) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, name, is_manager, is_admin')
          .eq('id', uid)
          .maybeSingle();
        if (prof) {
          name = ((prof.full_name ?? prof.name ?? '') as string).trim() || null;
          if (prof.is_manager) manager = true;
          if (prof.is_admin)   admin = true;
        }
      }
      if (!name) {
        const metaName =
          (session?.user?.user_metadata?.name ??
           session?.user?.user_metadata?.full_name ??
           session?.user?.user_metadata?.user_name) as string | undefined;
        name = (metaName || '').trim() || null;
      }

      setUserName(name);
      setIsManager(manager);
      setIsAdmin(admin);
    })();
  }, []);

  /* ===== 데이터 로드 (보안 뷰) ===== */
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);
      await waitForAuthReady();

      const sel =
        'id,employee_id,employee_name,work_date,revenue,daily_wage,extra_cost,material_cost_visible,net_profit_visible';

      let { data, error } = await supabase
        .from('reports_secure')
        .select(sel)
        .order('work_date', { ascending: false })
        .returns<Row[]>();

      if (error) {
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

  /* ===== 필터/그룹 ===== */
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

  const employeeNameOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of filteredByDate) set.add(((r.employee_name ?? '').trim()) || '(미지정)');
    return ['전체', ...Array.from(set).sort((a,b)=>a.localeCompare(b,'ko'))];
  }, [filteredByDate]);

  const filteredForBranding = useMemo(() => {
    if (mode !== 'employee' || empNameFilter === 'all') return filteredByDate;
    const target = empNameFilter;
    return filteredByDate.filter(r => (((r.employee_name ?? '').trim()) || '(미지정)').toLowerCase() === target);
  }, [filteredByDate, mode, empNameFilter]);

  const grouped: Grouped = useMemo(() => {
    if (mode === 'employee') return groupByEmployee(filteredForBranding);
    if (mode === 'monthly')  return groupByMonth(filteredByDate);
    return groupByDay(filteredByDate);
  }, [filteredForBranding, filteredByDate, mode]);

  const metricSafe: Metric = useMemo(
    () => (!isAdmin && metric === 'net') ? 'revenue' : metric,
    [isAdmin, metric]
  );

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
          if (!isAdmin) continue;
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

  /* ===== 급여 반영(관리자 전용) ===== */
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const canSyncPayroll = isAdmin && mode === 'employee';

  // ✅ 변경: 스케줄 단위 멱등 반영 (DB RPC 호출)
  const syncPayrolls = async () => {
    if (!canSyncPayroll) return;
    setSyncMsg('진행 중…');

    // 현재 화면의 날짜/직원 필터가 적용된 행들(=스케줄 단위)을 대상으로 처리
    const base = filteredByDate;
    const targetRows = (mode === 'employee' && empNameFilter !== 'all')
      ? base.filter(r => (((r.employee_name ?? '').trim()) || '(미지정)').toLowerCase() === empNameFilter)
      : base;

    // 스케줄 PK만 추출해서 중복 제거
    const scheduleIds = Array.from(new Set(
      targetRows.map(r => r.id).filter((v): v is number => Number.isFinite(v))
    ));

    if (scheduleIds.length === 0) {
      setSyncMsg('선택된 기간/필터에 반영할 스케줄이 없습니다.');
      return;
    }

    try {
      let ok = 0, fail = 0;
      for (const sid of scheduleIds) {
        const { error } = await supabase.rpc('reflect_schedule_to_payroll', { p_schedule_id: sid });
        if (error) fail++; else ok++;
      }
      setSyncMsg(`✅ 급여 반영 완료: ${ok}건 처리${fail ? ` / 실패 ${fail}건` : ''} (이미 반영된 스케줄은 자동 무시)`);
    } catch (e: any) {
      setSyncMsg(`⚠️ 급여 반영 실패: ${e?.message ?? '알 수 없는 오류'}`);
    }
  };

  return (
    <div>
      <div className="p-4 space-y-4">
        <h1 className="text-2xl font-extrabold">
          <span className="title-gradient">📊 리포트</span>
        </h1>

        {/* ===== 컨트롤 바 ===== */}
        <div className="card p-3">
          {/* 📱 모바일: 2줄(보기+지표 / 시작+종료). 곡선 체크, '이번 달' 버튼 제거 */}
          <div className="sm:hidden">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-gray-600 mb-1">보기</label>
                <select
                  className="select h-8 px-2 text-[13px] w-full"
                  value={mode}
                  onChange={e => setMode(e.target.value as Mode)}
                >
                  <option value="daily">일별</option>
                  <option value="monthly">월별</option>
                  <option value="employee">직원별</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-gray-600 mb-1">지표</label>
                <select
                  className="select h-8 px-2 text-[13px] w-full"
                  value={(!isAdmin && metric === 'net') ? 'revenue' : metric}
                  onChange={e => setMetric(e.target.value as Metric)}
                >
                  <option value="revenue">매출</option>
                  <option value="daily_wage">인건비</option>
                  {isAdmin && <option value="net">순수익</option>}
                </select>
              </div>
            </div>

            {/* 직원별일 때만 간단 필터 추가 */}
            {mode === 'employee' && (
              <div className="mt-2">
                <label className="block text-[11px] text-gray-600 mb-1">직원</label>
                <select
                  className="select h-8 px-2 text-[13px] w-full"
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

            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="block text-[11px] text-gray-600 mb-1">시작</label>
                <input
                  type="date"
                  className="input h-8 px-2 text-[13px] w-full"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-600 mb-1">종료</label>
                <input
                  type="date"
                  className="input h-8 px-2 text-[13px] w-full"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* 🖥️ 데스크탑/태블릿: 기존 레이아웃 유지 */}
          <div className="hidden sm:flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col">
                <label className="text-xs text-gray-600">보기</label>
                <select
                  className="select min-w-[140px]"
                  value={mode}
                  onChange={e => setMode(e.target.value as Mode)}
                >
                  <option value="daily">일별</option>
                  <option value="monthly">월별</option>
                  <option value="employee">직원별</option>
                </select>
              </div>

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

              {/* 데스크탑에서만 곡선 체크 표시 */}
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
                {/* 데스크탑에서만 '이번 달' 유지 */}
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
                <button className="btn btn-primary" onClick={syncPayrolls}>
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

        {/* 그래프(동일) */}
        <div className="card p-0">
          <div className="-mx-4 px-4 md:mx-0 md:px-0" style={{ overflowX: 'auto', overflowY: 'visible' }}>
            {loading ? (
              <div className="p-3 text-sm text-gray-600">그래프 준비 중…</div>
            ) : chartDaily.labels.length === 0 ? (
              <div className="p-3 text-sm text-gray-500">표시할 데이터가 없습니다.</div>
            ) : (
              <div className="p-3">
                <LineChart labels={chartDaily.labels} values={chartDaily.values} curved={curved} />
              </div>
            )}
          </div>
        </div>

        {/* ===== 표 ===== */}
        <div className="card p-3">
          {loading ? (
            <div className="text-sm text-gray-600">불러오는 중…</div>
          ) : (
            <>
              {/* 📱 모바일: 카드형 요약 리스트 — 합계를 맨 위로 (5줄) */}
              <div className="md:hidden">
                <MobileSummaryCards mode={mode} data={grouped} isAdmin={isAdmin} />
              </div>
              {/* 🖥️ 데스크탑/태블릿: 표 — 각 컬럼에 맞춘 합계 1행 */}
              <div className="hidden md:block">
                <TableReport mode={mode} data={grouped} isAdmin={isAdmin} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* =================== 모바일 카드 요약 표 =================== */
function MobileSummaryCards({ mode, data, isAdmin }: { mode: Mode; data: Grouped; isAdmin: boolean }) {
  const head = mode === 'employee' ? '직원' : '기간';

  const totalCard = (
    <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 mb-2">
      <div className="space-y-1 text-[12px]">
        <div className="font-semibold">합계 • 건수 {data.total.count}</div>
        <div>매출 {fmtMoney(data.total.revenue)}</div>
        <div>인건비 {fmtMoney(data.total.daily_wage)}</div>
        <div>기타 {fmtMoney(data.total.extra_cost)}</div>
        <div>{isAdmin ? `순수익 ${fmtMoney(computeNetGrouped(data.total))}` : '순수익 ***'}</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {totalCard}
      {data.rows.map((r) => {
        const net = computeNetGrouped(r);
        return (
          <div key={r.key} className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-slate-900 truncate">
                <span className="text-slate-500 mr-1">{head}:</span>{r.label}
              </div>
              <div className="mt-1 space-y-0.5 text-[11px] text-slate-700">
                <div>건수 {r.count}</div>
                <div>매출 {fmtMoney(r.revenue)}</div>
                <div>인건비 {fmtMoney(r.daily_wage)}</div>
                <div>기타 {fmtMoney(r.extra_cost)}</div>
                <div>{isAdmin ? `순수익 ${fmtMoney(net)}` : '순수익 ***'}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* =================== 데스크탑 표 (합계 1행을 컬럼 맞춤) =================== */
function TableReport({ mode, data, isAdmin }: { mode: Mode; data: Grouped; isAdmin: boolean; }) {
  const baseHeaders = mode === 'employee'
    ? ['직원', '건수', '매출', '자재비', '인건비', '기타비용']
    : ['기간', '건수', '매출', '자재비', '인건비', '기타비용'];

  const totalNet = computeNetGrouped(data.total);

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
          {/* ✅ 합계 행: 각 컬럼에 맞춰 배치 */}
          <tr className="bg-sky-100/60 font-medium">
            <td className="border border-sky-100 px-2 py-2 text-sm">금액합계</td>
            <td className="border border-sky-100 px-2 py-2 text-sm">{data.total.count}</td>
            <td className="border border-sky-100 px-2 py-2 text-sm">{fmtMoney(data.total.revenue)}</td>
            <td className="border border-sky-100 px-2 py-2 text-sm">{isAdmin ? fmtMoney(data.total.material_cost_visible) : '***'}</td>
            <td className="border border-sky-100 px-2 py-2 text-sm">{fmtMoney(data.total.daily_wage)}</td>
            <td className="border border-sky-100 px-2 py-2 text-sm">{fmtMoney(data.total.extra_cost)}</td>
            <td className="border border-sky-100 px-2 py-2 text-sm">{isAdmin ? fmtMoney(totalNet) : '***'}</td>
          </tr>

          {data.rows.map(r => {
            const net = computeNetGrouped(r);
            return (
              <tr key={r.key} className="hover:bg-sky-50/50">
                <td className="border border-sky-100 px-2 py-1 text-sm">{r.label}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{r.count}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{fmtMoney(r.revenue)}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{isAdmin ? fmtMoney(r.material_cost_visible) : '***'}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{fmtMoney(r.daily_wage)}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{fmtMoney(r.extra_cost)}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{isAdmin ? fmtMoney(net) : '***'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* =================== 라인 차트(SVG) =================== */
function LineChart({ labels, values, curved }: { labels: string[]; values: number[]; curved: boolean }) {
  const w = Math.max(320, Math.min(1040, labels.length * 64));
  const h = 280;
  const pad = { l: 56, r: 24, t: 18, b: 48 };

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
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMin meet" style={{ display: 'block' }}>
        <line x1={pad.l} y1={h - pad.b} x2={w - pad.r} y2={h - pad.b} stroke="#ddd" />
        <line x1={pad.l} y1={pad.t} x2={h - pad.b} y2={h - pad.b} stroke="#ddd" />

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
            <text key={i} x={x} y={h - pad.b + 16} fontSize="10" textAnchor="middle">
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
function groupByDay(rows: Row[]): Grouped { return group(rows, (d) => format(d, 'yyyy-MM-dd')); }
function groupByMonth(rows: Row[]): Grouped { return group(rows, (d) => format(d, 'yyyy-MM')); }

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
    g.revenue               += num(r.revenue);
    g.material_cost_visible += num(r.material_cost_visible);
    g.daily_wage            += num(r.daily_wage);
    g.extra_cost            += num(r.extra_cost);

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

function computeNetGrouped(x: {revenue:number; material_cost_visible:number; daily_wage:number; extra_cost:number}) {
  return num(x.revenue) - num(x.material_cost_visible) - num(x.daily_wage) - num(x.extra_cost);
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n) || n === 0) return n === 0 ? '₩0' : '-';
  try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n); }
  catch { return `${Math.round(n).toLocaleString()}원`; }
}
function num(v: number | null | undefined) { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; }

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
function toYYYYMM(s?: string | null) { return s ? s.slice(0, 7) : ''; }
function normalizeName(n?: string | null) { return ((n ?? '').trim().toLowerCase()) || ''; }

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
