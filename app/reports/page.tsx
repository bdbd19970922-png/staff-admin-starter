// FILE: app/reports/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import AuthBar from '../../components/AuthBar';
import { supabase } from '../../lib/supabaseClient';
import {
  format, parseISO, startOfMonth, endOfMonth, isAfter, isBefore, addDays,
} from 'date-fns';

type Row = {
  id: number;
  title: string | null;
  start_ts: string | null;
  end_ts: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  revenue?: number | null;
  material_cost?: number | null;
  daily_wage?: number | null;
  extra_cost?: number | null;
  net_profit_visible?: number | null; // (뷰에 있을 수 있음)
};

type GroupedRow = {
  key: string;
  label: string;
  count: number;
  revenue: number;
  material_cost: number;
  daily_wage: number;
  extra_cost: number;
  employee_id?: string | null;
  employee_name?: string | null;
};
type Grouped = {
  rows: GroupedRow[];
  total: GroupedRow;
};

type Mode = 'daily' | 'weekly' | 'monthly' | 'employee';
type Metric = 'revenue' | 'net' | 'daily_wage';

export default function ReportsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [isAdmin, setIsAdmin] = useState(false);
  const [hasFinanceCols, setHasFinanceCols] = useState<boolean | null>(null); // null=미확인

  // 현재 로그인 사용자 정보(자기 일정만 보이기용)
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  // 보기/그래프 옵션
  const [mode, setMode] = useState<Mode>('daily');
  const [metric, setMetric] = useState<Metric>('revenue');
  const [curved, setCurved] = useState(true);

  // 날짜 범위 (기본: 이번 달)
  const [dateFrom, setDateFrom] = useState<string>(() => toDateInputValue(startOfMonth(new Date())));
  const [dateTo, setDateTo] = useState<string>(() => toDateInputValue(endOfMonth(new Date())));

  // 직원별 보기에서 사용할 "직원 선택" (소문자 key, 'all' 포함)
  const [empNameFilter, setEmpNameFilter] = useState<string>('all');

  // 관리자/사용자 판별 + 사용자 프로필 이름 로드
  useEffect(() => {
    (async () => {
      const adminIds = (process.env.NEXT_PUBLIC_ADMIN_IDS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? '';
      const email = (session?.user?.email ?? '').toLowerCase();
      setUserId(uid || null);
      setIsAdmin((!!uid && adminIds.includes(uid)) || (!!email && adminEmails.includes(email)));

      // 이름은 profiles 테이블에서 우선 조회 (display_name/full_name/name 순)
      let name: string | null = null;
      if (uid) {
        const prof = await supabase
          .from('profiles')
          .select('display_name, full_name, name')
          .eq('id', uid)
          .maybeSingle();
        if (!prof.error) {
          name = (prof.data?.display_name || prof.data?.full_name || prof.data?.name || '').trim() || null;
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

  // 데이터 로드 (재무 컬럼 포함 → 실패 시 폴백)
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      // 읽기는 뷰로 (관리자=실값, 비관리자=뷰에서 적절 처리)
      const sel1 =
        'id,title,start_ts,end_ts,employee_id,employee_name,revenue,material_cost,daily_wage,extra_cost,net_profit_visible';

      let { data, error } = await supabase
        .from('schedules_secure') // 테이블이 아니라 보안 뷰 사용 권장
        .select(sel1)
        .order('start_ts', { ascending: true })
        .returns<Row[]>();

      if (error) {
        setHasFinanceCols(false);
        // 폴백 최소 컬럼
        const sel2 = 'id,title,start_ts,end_ts,employee_id,employee_name';
        const fb = await supabase
          .from('schedules_secure')
          .select(sel2)
          .order('start_ts', { ascending: true })
          .returns<Row[]>();
        data = fb.data; error = fb.error;
      } else {
        setHasFinanceCols(true);
      }

      if (error) { setMsg(`불러오기 오류: ${error.message}`); setRows([]); }
      else { setRows(data ?? []); }
      setLoading(false);
    })();
  }, []);

  // ✅ 권한 기반 1차 필터(관리자 제외: 본인 것만)
  const rowsForUser = useMemo(() => {
    if (isAdmin) return rows;
    const uid = (userId ?? '').trim();
    const uname = normalizeName(userName);
    if (!uid && !uname) return []; // 인증정보 없으면 아무 것도 안보임

    return rows.filter(r => {
      // employee_id 일치 또는 employee_name(정규화) 일치 시 본인 것으로 간주
      const matchId = !!uid && (r.employee_id ?? '').trim() === uid;
      const matchName = !!uname && normalizeName(r.employee_name) === uname;
      return matchId || matchName;
    });
  }, [rows, isAdmin, userId, userName]);

  // 날짜로 2차 필터
  const filteredByDate = useMemo(() => {
    const s = parseDateInput(dateFrom);
    const e = parseDateInput(dateTo);
    if (!s || !e) return rowsForUser;
    return rowsForUser.filter(r => {
      const d = safeParse(r.start_ts);
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
  const filteredForGrouping = useMemo(() => {
    if (mode !== 'employee' || empNameFilter === 'all') return filteredByDate;
    const target = empNameFilter;
    return filteredByDate.filter(r => (((r.employee_name ?? '').trim()) || '(미지정)').toLowerCase() === target);
  }, [filteredByDate, mode, empNameFilter]);

  // 테이블용 그룹핑
  const grouped: Grouped = useMemo(() => {
    if (mode === 'employee') return groupByEmployee(filteredForGrouping);
    if (mode === 'weekly')   return groupByWeek(filteredForGrouping);
    if (mode === 'monthly')  return groupByMonth(filteredForGrouping);
    return groupByDay(filteredForGrouping);
  }, [filteredForGrouping, mode]);

  // (중요) 비관리자는 net 선택 시 강제로 revenue로 대체
  const metricSafe: Metric = useMemo(
    () => (!isAdmin && metric === 'net') ? 'revenue' : metric,
    [isAdmin, metric]
  );

  // 그래프: 항상 "일자별 X축"
  const chartDaily = useMemo(() => {
    const s = parseDateInput(dateFrom);
    const e = parseDateInput(dateTo);
    if (!s || !e) return { labels: [] as string[], values: [] as number[] };

    // 직원별 모드에서 특정 직원 선택 시 해당 직원만 반영
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
        const rd = safeParse(r.start_ts);
        if (!rd) continue;
        const k = format(rd, 'yyyy-MM-dd');
        if (k !== key) continue;

        if (metricSafe === 'net') {
          // 관리자만 net 집계
          if (!isAdmin) continue;
          sum += computeNet(r);
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

  const syncPayrolls = async () => {
    if (!canSyncPayroll) return;
    setSyncMsg(null);

    const s = parseDateInput(dateFrom);
    const e = parseDateInput(dateTo);
    if (!s || !e) {
      setSyncMsg('⚠️ 기간을 올바르게 선택해주세요.');
      return;
    }
    const sameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
    const payMonth = sameMonth ? format(s, 'yyyy-MM') : `${dateFrom}~${dateTo}`;

    // 직원별 집계 (현재 모드의 직원 필터도 반영)
    const byEmp = groupByEmployee(filteredForGrouping);

    // 이름→ID 해석 시도(스케줄 전체에서 단일 ID면 채택)
    const needResolve = byEmp.rows.filter(r => !r.employee_id).map(r => r.label);
    const resolvedMap = new Map<string, string>();
    await Promise.all(
      needResolve.map(async (name) => {
        const id = await resolveEmployeeIdByName(name);
        if (id) resolvedMap.set(name, id);
      })
    );

    // 레코드 초안
    const raw = byEmp.rows.map(r => {
      const id = r.employee_id ?? resolvedMap.get(r.label) ?? null;
      const name = (r.employee_name ?? r.label ?? '').trim();
      const total = r.daily_wage;
      return {
        employee_id: id,
        employee_name: name || null,
        pay_month: payMonth,
        period_start: dateFrom,
        period_end: dateTo,
        amount: total,
        total_pay: total,
        paid: false,
        paid_at: null,
        memo: ' ',
      };
    });

    // 키(ID|월 또는 name|월)로 합산/중복 제거
    const dedup = new Map<string, typeof raw[number]>();
    for (const r of raw) {
      const key = r.employee_id
        ? `id:${r.employee_id}|${r.pay_month}`
        : `name:${(r.employee_name ?? '').toLowerCase()}|${r.pay_month}`;
      const prev = dedup.get(key);
      if (!prev) dedup.set(key, { ...r });
      else {
        const sumv = (prev.total_pay ?? 0) + (r.total_pay ?? 0);
        dedup.set(key, { ...prev, amount: sumv, total_pay: sumv });
      }
    }
    const records = Array.from(dedup.values());

    try {
      // 업서트 대신: 키로 정확히 삭제 후 단일 삽입
      for (const r of records) {
        if (r.employee_id) {
          const del = await supabase
            .from('payrolls')
            .delete()
            .eq('pay_month', r.pay_month)
            .eq('employee_id', r.employee_id);
          if (del.error) throw del.error;
        } else {
          let del = supabase
            .from('payrolls')
            .delete()
            .eq('pay_month', r.pay_month)
            .is('employee_id', null);
          if (r.employee_name) del = del.ilike('employee_name', r.employee_name);
          else del = del.is('employee_name', null);
          const delRes = await del;
          if (delRes.error) throw delRes.error;
        }
      }

      const ins = await supabase.from('payrolls').insert(records);
      if (ins.error) throw ins.error;

      const namesNoId = records.filter(r => !r.employee_id).map(r => r.employee_name).filter(Boolean) as string[];
      setSyncMsg(
        namesNoId.length
          ? `✅ 반영 완료(이름 기반 포함): ${Array.from(new Set(namesNoId)).join(', ')}`
          : '✅ 급여 테이블에 직원별 인건비가 반영되었습니다.'
      );
    } catch (err: any) {
      setSyncMsg(`⚠️ 급여 반영 실패: ${err?.message ?? '알 수 없는 오류'}`);
    }
  };

  // 🔹 컴포넌트 반환부
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
                  <option value="weekly">주별</option>
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
              isAdmin={isAdmin}
              hasFinanceCols={hasFinanceCols}
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
  hasFinanceCols: boolean | null;
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
            const net = computeNet(r);
            return (
              <tr key={r.key} className="hover:bg-sky-50/50">
                <td className="border border-sky-100 px-2 py-1 text-sm">{r.label}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{r.count}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{fmtMoney(r.revenue)}</td>

                {/* 자재비: 비관리자 마스킹 */}
                <td className="border border-sky-100 px-2 py-1 text-sm">
                  {isAdmin ? fmtMoney(r.material_cost) : '***'}
                </td>

                <td className="border border-sky-100 px-2 py-1 text-sm">{fmtMoney(r.daily_wage)}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm">{fmtMoney(r.extra_cost)}</td>

                {/* 순수익: 비관리자 마스킹 */}
                <td className="border border-sky-100 px-2 py-1 text-sm">
                  {isAdmin ? fmtMoney(net) : '***'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-sky-50">
          {(() => {
            const totalNet = computeNet(data.total);
            return (
              <tr>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">합계</td>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">{data.total.count}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">{fmtMoney(data.total.revenue)}</td>
                <td className="border border-sky-100 px-2 py-1 text-sm font-semibold">
                  {isAdmin ? fmtMoney(data.total.material_cost) : '***'}
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
function groupByWeek(rows: Row[]): Grouped {
  return group(rows, (d) => {
    const monday = startOfWeekMono(d);
    const w = weekIndex(monday);
    return `${format(monday, 'yyyy')}-W${w.toString().padStart(2, '0')}`;
  });
}

/** 직원별 그룹핑 */
function groupByEmployee(rows: Row[]): Grouped {
  type Acc = GroupedRow & { _ids: Set<string> };
  const map = new Map<string, Acc>(); // key: 직원명(정규화)

  for (const r of rows) {
    const name = ((r.employee_name ?? '').trim()) || '(미지정)';
    const norm = name.toLowerCase();

    if (!map.has(norm)) {
      map.set(norm, {
        key: norm,
        label: name,
        count: 0,
        revenue: 0,
        material_cost: 0,
        daily_wage: 0,
        extra_cost: 0,
        employee_id: null,
        employee_name: name,
        _ids: new Set<string>(),
      });
    }
    const g = map.get(norm)!;
    g.count += 1;
    g.revenue       += num(r.revenue);
    g.material_cost += num(r.material_cost);
    g.daily_wage    += num(r.daily_wage);
    g.extra_cost    += num(r.extra_cost);

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
      material_cost: g.material_cost,
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
    const d = safeParse(r.start_ts);
    if (!d) continue;
    const key = keyOf(d);
    if (!map.has(key)) map.set(key, emptyGroup(key, key));
    const g = map.get(key)!;
    g.count += 1;
    g.revenue       += num(r.revenue);
    g.material_cost += num(r.material_cost);
    g.daily_wage    += num(r.daily_wage);
    g.extra_cost    += num(r.extra_cost);
  }
  const list = Array.from(map.values()).sort((a,b)=>a.key.localeCompare(b.key));
  const total = list.reduce(sumGroups, emptyGroup('TOTAL','TOTAL'));
  return { rows: list, total };
}
function emptyGroup(key:string, label:string): GroupedRow {
  return { key, label, count:0, revenue:0, material_cost:0, daily_wage:0, extra_cost:0 };
}
function sumGroups(acc: GroupedRow, r: GroupedRow): GroupedRow {
  return {
    key: 'TOTAL',
    label: 'TOTAL',
    count: acc.count + r.count,
    revenue: acc.revenue + r.revenue,
    material_cost: acc.material_cost + r.material_cost,
    daily_wage: acc.daily_wage + r.daily_wage,
    extra_cost: acc.extra_cost + r.extra_cost,
  };
}

// 순수익 계산(현재 로직 유지: revenue - material_cost - daily_wage + extra_cost/2)
function computeNet(x: {revenue?:number|null; material_cost?:number|null; daily_wage?:number|null; extra_cost?:number|null}) {
  return num(x.revenue) - num(x.material_cost) - num(x.daily_wage) + num(x.extra_cost) / 2;
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n) || n === 0) return n === 0 ? '₩0' : '-';
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n);
  } catch { return `${Math.round(n).toLocaleString()}원`; }
}
function num(v: number | null | undefined) { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; }
function safeParse(iso: string | null | undefined) {
  if (!iso) return null;
  const d = parseISO(iso);
  return isNaN(+d) ? null : d;
}
function toDateInputValue(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}
function parseDateInput(s: string) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(+d) ? null : d;
}

// 월~일 주차 계산용
function startOfWeekMono(d: Date) {
  const day = d.getDay(); // 0=Sun
  const mondayDelta = (day === 0 ? -6 : 1 - day);
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayDelta);
  monday.setHours(0,0,0,0);
  return monday;
}
function weekIndex(monday: Date) {
  const firstMonday = startOfWeekMono(new Date(monday.getFullYear(), 0, 1));
  let idx = 1;
  let cur = new Date(firstMonday);
  while (isBefore(cur, monday)) {
    cur = addDays(cur, 7);
    idx++;
  }
  return idx;
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

// 이름 정규화
function normalizeName(n?: string | null) {
  return ((n ?? '').trim().toLowerCase()) || '';
}
