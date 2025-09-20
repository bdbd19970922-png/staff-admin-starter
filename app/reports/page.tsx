// FILE: app/reports/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  format, startOfMonth, endOfMonth, isAfter, isBefore, addDays,
} from 'date-fns';

/* ===== 세션 준비 대기(Unauthorized 예방) ===== */
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

/* ===== 타입 ===== */
type Row = {
  id: number;
  work_date?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  revenue?: number | null;
  material_cost_visible?: number | null; // ← 마스킹 반영된 컬럼만 사용
  daily_wage?: number | null;
  extra_cost?: number | null;
  net_profit_visible?: number | null;     // ← 관리자만 값, 비관리자 null
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

/* ===== 페이지 ===== */
export default function ReportsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [isAdmin, setIsAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const isElevated = isAdmin || isManager;

  // 현재 사용자
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  // 보기/그래프 옵션
  const [mode, setMode] = useState<Mode>('daily');
  const [metric, setMetric] = useState<Metric>('revenue');
  const [curved, setCurved] = useState(true);

  // 날짜(기본: 이번 달)
  const [dateFrom, setDateFrom] = useState<string>(() => toDateInputValue(startOfMonth(new Date())));
  const [dateTo, setDateTo] = useState<string>(() => toDateInputValue(endOfMonth(new Date())));

  // 직원별 보기 필터
  const [empNameFilter, setEmpNameFilter] = useState<string>('all');

  /* ===== 권한/사용자명 로드 ===== */
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

      // 이름/권한: 존재하는 컬럼만 사용
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

  /* ===== 데이터 로드(보안 뷰 우선, 실패 시 schedules_secure 폴백) ===== */
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

  /* ===== 권한 기반 1차 필터: 관리자/매니저 전사, 직원 본인만 ===== */
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

  /* ===== 날짜 2차 필터 ===== */
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

  /* ===== 직원 옵션 ===== */
  const employeeNameOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of filteredByDate) set.add(((r.employee_name ?? '').trim()) || '(미지정)');
    return ['전체', ...Array.from(set).sort((a,b)=>a.localeCompare(b,'ko'))];
  }, [filteredByDate]);

  /* ===== 직원별 보기 추가 필터 ===== */
  const filteredForBranding = useMemo(() => {
    if (mode !== 'employee' || empNameFilter === 'all') return filteredByDate;
    const target = empNameFilter;
    return filteredByDate.filter(r => (((r.employee_name ?? '').trim()) || '(미지정)').toLowerCase() === target);
  }, [filteredByDate, mode, empNameFilter]);

  /* ===== 그룹핑(표) ===== */
  const grouped: Grouped = useMemo(() => {
    if (mode === 'employee') return groupByEmployee(filteredForBranding);
    if (mode === 'monthly')  return groupByMonth(filteredByDate);
    return groupByDay(filteredByDate);
  }, [filteredForBranding, filteredByDate, mode]);

  /* ===== 지표(비관리자 net 금지) ===== */
  const metricSafe: Metric = useMemo(
    () => (!isAdmin && metric === 'net') ? 'revenue' : metric,
    [isAdmin, metric]
  );

  /* ===== 그래프 데이터(일자 X축) ===== */
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

  async function safeUpsertPayroll(record: {
    employee_id: string | null;
    employee_name: string | null;
    pay_month: string;
    period_start: string;
    period_end: string;
    amount: number | null;
    total_pay: number | null;
    memo: string | null;
  }) {
    const keyMonth =
      toYYYYMM(record.pay_month) ||
      toYYYYMM(record.period_start) ||
      toYYYYMM(record.period_end);
    if (!keyMonth) throw new Error('pay_month 계산 실패');

    if (record.employee_id) {
      const { data: ex, error: exErr } = await supabase
        .from('payrolls')
        .select('id, paid')
        .eq('employee_id', record.employee_id)
        .eq('pay_month', keyMonth)
        .maybeSingle();
      if (exErr && exErr.code !== 'PGRST116') throw exErr;

      if (ex?.paid === true) return { action: 'skip_paid' as const };

      const payload = {
        employee_id: record.employee_id,
        employee_name: record.employee_name,
        pay_month: keyMonth,
        period_start: record.period_start,
        period_end: record.period_end,
        amount: record.amount ?? null,
        total_pay: record.total_pay ?? record.amount ?? null,
        paid: ex?.paid ?? false,
        paid_at: ex?.paid ? (new Date()).toISOString().slice(0,10) : null,
        memo: record.memo ?? null,
      };

      const { error } = await supabase
        .from('payrolls')
        .upsert([payload], { onConflict: 'employee_id,pay_month', ignoreDuplicates: false, defaultToNull: false })
        .select('id');

      if (error) throw error;
      return { action: ex ? ('update' as const) : ('insert' as const) };
    }

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
      if (existing.paid === true) return { action: 'skip_paid' as const };
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
  }

  const syncPayrolls = async () => {
    if (!canSyncPayroll) return;
    setSyncMsg(null);

    const s = parseDateInput(dateFrom);
    const e = parseDateInput(dateTo);
    if (s == null || e == null) {
      setSyncMsg('⚠️ 기간을 올바르게 선택해주세요.');
      return;
    }
    const sameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
    const payMonthDisplay = sameMonth ? format(s, 'yyyy-MM') : `${dateFrom}~${dateTo}`;

    const byEmp = groupByEmployee(filteredByDate);

    const needResolve = byEmp.rows.filter(r => !r.employee_id).map(r => r.label);
    const resolvedMap = new Map<string, string>();
    await Promise.all(
      needResolve.map(async (name) => {
        const id = await resolveEmployeeIdByName(name);
        if (id) resolvedMap.set(name, id);
      })
    );

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

  /* ===== 렌더 ===== */
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
        <span className="bg-gradient-to-r from-sky-700 via-sky-600 to-indigo-600 bg-clip-text text-transparent">
          📊 리포트
        </span>
      </h1>

      {/* 컨트롤 바 */}
      <div className="card p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 w-full md:w-auto">
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">보기</span>
              <select
                className="select min-h-[var(--tap-size)] w-full"
                value={mode}
                onChange={e => setMode(e.target.value as Mode)}
              >
                <option value="daily">일별</option>
                <option value="monthly">월별</option>
                <option value="employee">직원별</option>
              </select>
            </label>

            {mode === 'employee' && (
              <label className="flex flex-col col-span-2 sm:col-span-1">
                <span className="text-xs text-gray-600">직원</span>
                <select
                  className="select min-h-[var(--tap-size)] w-full"
                  value={empNameFilter}
                  onChange={e => setEmpNameFilter(e.target.value)}
                >
                  <option value="all">전체</option>
                  {employeeNameOptions.slice(1).map(name => (
                    <option key={name} value={name.toLowerCase()}>{name}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex flex-col">
              <span className="text-xs text-gray-600">지표</span>
              <select
                className="select min-h-[var(--tap-size)] w-full"
                value={(!isAdmin && metric === 'net') ? 'revenue' : metric}
                onChange={e => setMetric(e.target.value as Metric)}
              >
                <option value="revenue">매출</option>
                <option value="daily_wage">인건비</option>
                {isAdmin && <option value="net">순수익</option>}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm mt-5 sm:mt-6">
              <input
                id="curved"
                type="checkbox"
                className="h-4 w-4 accent-sky-500"
                checked={curved}
                onChange={e => setCurved(e.target.checked)}
              />
              곡선 그래프
            </label>

            <label className="flex flex-col">
              <span className="text-xs text-gray-600">시작</span>
              <input
                type="date"
                className="input min-h-[var(--tap-size)] w-full"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
            </label>

            <label className="flex flex-col">
              <span className="text-xs text-gray-600">종료</span>
              <input
                type="date"
                className="input min-h-[var(--tap-size)] w-full"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
              />
            </label>

            <div className="col-span-2 sm:col-span-1">
              <button
                className="btn min-h-[var(--tap-size)] w-full"
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
                className="btn btn-primary min-h-[var(--tap-size)]"
                onClick={syncPayrolls}
                title="직원별 인건비 합계를 급여 테이블로 반영"
              >
                직원별 인건비 → 급여 반영
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 안내/에러 */}
      {syncMsg && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-2 text-sm text-sky-800">
          {syncMsg}
        </div>
      )}
      {msg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
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
          <TableReport mode={mode} data={grouped} isAdmin={isAdmin} />
        )}
      </div>
    </div>
  );
}

/* ===== 표 컴포넌트 ===== */
function TableReport({ mode, data, isAdmin }: { mode: Mode; data: Grouped; isAdmin: boolean; }) {
  const baseHeaders = mode === 'employee'
    ? ['직원', '건수', '매출', '자재비', '인건비', '기타비용']
    : ['기간', '건수', '매출', '자재비', '인건비', '기타비용'];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[760px] w-full text-sm">
        <thead className="bg-sky-50/60 border-b border-sky-100">
          <tr>
            {baseHeaders.map(h => (
              <th key={h} className="px-2 py-2 text-left font-semibold text-sky-900">{h}</th>
            ))}
            <th className="px-2 py-2 text-left font-semibold text-sky-900">순수익</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => {
            const net = computeNetGrouped(r);
            return (
              <tr key={r.key} className="border-b border-slate-100 hover:bg-slate-50/60">
                <td className="px-2 py-2">{r.label}</td>
                <td className="px-2 py-2">{r.count}</td>
                <td className="px-2 py-2">{fmtMoney(r.revenue)}</td>
                <td className="px-2 py-2">{isAdmin ? fmtMoney(r.material_cost_visible) : '***'}</td>
                <td className="px-2 py-2">{fmtMoney(r.daily_wage)}</td>
                <td className="px-2 py-2">{fmtMoney(r.extra_cost)}</td>
                <td className="px-2 py-2">{isAdmin ? fmtMoney(net) : '***'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-sky-50/40 border-t border-sky-100">
          {(() => {
            const totalNet = computeNetGrouped(data.total);
            return (
              <tr>
                <td className="px-2 py-2 font-semibold">합계</td>
                <td className="px-2 py-2 font-semibold">{data.total.count}</td>
                <td className="px-2 py-2 font-semibold">{fmtMoney(data.total.revenue)}</td>
                <td className="px-2 py-2 font-semibold">{isAdmin ? fmtMoney(data.total.material_cost_visible) : '***'}</td>
                <td className="px-2 py-2 font-semibold">{fmtMoney(data.total.daily_wage)}</td>
                <td className="px-2 py-2 font-semibold">{fmtMoney(data.total.extra_cost)}</td>
                <td className="px-2 py-2 font-semibold">{isAdmin ? fmtMoney(totalNet) : '***'}</td>
              </tr>
            );
          })()}
        </tfoot>
      </table>
    </div>
  );
}

/* ===== 라인 차트(SVG, 가로 스크롤 허용) ===== */
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
        {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2} fill="black" />)}
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

/* ===== 그룹핑/유틸 ===== */
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
