// FILE: app/schedules/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import EmployeePicker, { EmployeeValue } from '@/components/EmployeePicker';

/* ===== 세션 준비 대기(Unauthorized 예방) ===== */
async function waitForAuthReady(maxTries = 6, delayMs = 300) {
  for (let i = 0; i < maxTries; i++) {
    const { data } = await supabase.auth.getSession();
    const hasToken = !!data?.session?.access_token;
    if (hasToken) return data.session!;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

/* ====== 화면 Row 타입/라벨 ====== */
type Row = {
  id: number;
  title: string;
  site_address: string;
  start_ts: string;
  end_ts: string;
  daily_wage: number;
  status: 'scheduled' | 'in_progress' | 'done' | 'cancelled';
  employee_id?: string | null;
  employee_name?: string | null;
  employee_phone?: string | null;
  completed?: boolean;
};

const STATUS_LABEL: Record<Row['status'], string> = {
  scheduled: '예정',
  in_progress: '진행중',
  done: '완료',
  cancelled: '취소',
};

/* ====== 보안뷰 결과 타입(여기에는 completed가 없음) ====== */
type SchedulesSecureRow = {
  id: number;
  title: string | null;
  start_ts: string;
  end_ts: string;
  employee_id: string | null;
  employee_name: string | null;
  off_day: boolean | null;
  daily_wage: number | null;
  revenue: number | null;
  material_cost: number | null;
  extra_cost: number | null;
  net_profit_visible: number | null;
  site_address: string | null;
};

/* ===============================
   부모(래퍼): 세션 체크만 담당
   =============================== */
export default function SchedulesPage() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await waitForAuthReady();
      setIsAuthed(!!session?.user);
      setIsReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAuthed(!!session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="space-y-6">
      {!isReady ? (
        <div className="card text-sm">로딩 중…</div>
      ) : isAuthed ? (
        <SchedulesInner />
      ) : (
        <LoggedOutScreen />
      )}
    </div>
  );
}

function LoggedOutScreen() {
  return (
    <div className="card">
      <h1 className="text-xl font-extrabold tracking-tight mb-1">로그인이 필요합니다</h1>
      <p className="text-slate-600">오른쪽 위 버튼으로 로그인해 주세요.</p>
    </div>
  );
}

/* =====================================
   자식: 스케줄 생성/삭제 + 목록/필터 표시
   ===================================== */
function SchedulesInner() {
  // 권한/사용자
  const [uid, setUid] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const isElevated = isAdmin || isManager;

  // 생성용 직원 선택
  const [emp, setEmp] = useState<EmployeeValue>({ mode: 'profile', employeeId: '' });

  // 목록/상태
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);      // 최초/풀 로딩
  const [bgLoading, setBgLoading] = useState(false); // ✅ 백그라운드 로딩(리스트 유지)
  const reloadTimer = useRef<number | null>(null);   // ✅ 실시간 디바운스
  const [msg, setMsg] = useState<string | null>(null);

  // 폼
  const [formOpen, setFormOpen] = useState(false);
  const [f, setF] = useState({
    title: '',
    site_address: '',
    start_ts: '',
    end_ts: '',
    daily_wage: 0,
    status: 'scheduled' as Row['status'],
  });

  // 보기(필터): 직원별 보기 기능
  const [viewEmp, setViewEmp] = useState<EmployeeValue>({ mode: 'profile', employeeId: '' });
  const [onlyMine, setOnlyMine] = useState(false);

  function toISO(local: string) {
    if (!local) return new Date().toISOString();
    return new Date(local).toISOString();
  }

  // 내 권한/이름 로드
  useEffect(() => {
    (async () => {
      const session = await waitForAuthReady();
      const _uid = session?.user?.id ?? null;
      const email = (session?.user?.email ?? '').toLowerCase();
      setUid(_uid);

      const parseList = (env?: string) => (env ?? '').split(',').map(s => s.trim()).filter(Boolean);
      const adminIds = parseList(process.env.NEXT_PUBLIC_ADMIN_IDS);
      const adminEmails = parseList(process.env.NEXT_PUBLIC_ADMIN_EMAILS).map(s => s.toLowerCase());

      let elevatedAdmin = (!!_uid && adminIds.includes(_uid)) || (!!email && adminEmails.includes(email));
      let elevatedManager = false;

      let nameFromProfile = '';
      if (_uid) {
        const { data: me } = await supabase
          .from('profiles')
          .select('full_name,is_admin,is_manager')
          .eq('id', _uid)
          .maybeSingle();
        nameFromProfile = (me?.full_name ?? '').trim();
        if (me?.is_admin) elevatedAdmin = true;
        if (me?.is_manager) elevatedManager = true;
      }
      setFullName(nameFromProfile || (session?.user?.email?.split('@')[0] ?? ''));

      setIsAdmin(!!elevatedAdmin);
      setIsManager(!!elevatedManager);
    })();
  }, []);

  /** ✅ 보안뷰 로드 후, 기본 테이블에서 completed만 추가 조회하여 머지 */
  async function loadRows(soft = false) {
    if (soft) setBgLoading(true); else setLoading(true);
    setMsg(null);

    try {
      await waitForAuthReady();

      // 1) 읽기: 보안뷰
      let query = supabase
        .from('schedules_secure')
        .select('id,title,start_ts,end_ts,employee_id,employee_name,off_day,daily_wage,revenue,material_cost,extra_cost,net_profit_visible,site_address')
        .order('start_ts', { ascending: false })
        .limit(100);

      if (!isElevated) {
        if (uid) {
          query = query.eq('employee_id', uid);
        } else if (fullName) {
          query = query.ilike('employee_name', `%${fullName}%`);
        } else {
          query = query.eq('id', -1);
        }
      }

      if (isElevated) {
        if (onlyMine && uid) {
          query = query.eq('employee_id', uid);
        } else if (viewEmp.mode === 'profile' && viewEmp.employeeId) {
          query = query.eq('employee_id', viewEmp.employeeId);
        } else if (viewEmp.mode === 'manual' && viewEmp.name?.trim()) {
          query = query.ilike('employee_name', `%${viewEmp.name.trim()}%`);
        }
      }

      const { data, error } = await query.returns<SchedulesSecureRow[]>();
      if (error) throw error;

      // 2) 1차 매핑
      let mapped: Row[] = (data ?? []).map((r) => ({
        id: r.id,
        title: r.title ?? '',
        site_address: r.site_address ?? '',
        status: r.off_day ? 'cancelled' : 'scheduled',
        start_ts: r.start_ts,
        end_ts: r.end_ts,
        daily_wage: r.daily_wage ?? 0,
        employee_id: r.employee_id ?? null,
        employee_name: r.employee_name ?? '',
        employee_phone: null,
        completed: false,
      }));

      // 3) ✅ 기본 테이블에서 완료 플래그만 보강
      const ids = mapped.map(r => r.id);
      if (ids.length > 0) {
        const { data: flags, error: fErr } = await supabase
          .from('schedules')
          .select('id, completed')
          .in('id', ids);
        if (!fErr && flags && flags.length > 0) {
          const fm = new Map<number, boolean>(flags.map((f: any) => [Number(f.id), !!f.completed]));
          mapped = mapped.map(r => {
            const c = fm.get(r.id);
            if (typeof c === 'boolean') {
              const status: Row['status'] =
                r.status === 'cancelled' ? 'cancelled' : (c ? 'done' : r.status);
              return { ...r, completed: c, status };
            }
            return r;
          });
        }
      }

      setRows(mapped);
    } catch (e: any) {
      setMsg(e?.message || '데이터 로딩 중 오류가 발생했습니다.');
      if (!soft) setRows([]);
    } finally {
      if (soft) setBgLoading(false); else setLoading(false);
    }
  }

  // 최초/필터 변경 시 로드
  useEffect(() => {
    loadRows(); // 풀 로딩
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElevated, uid, fullName, viewEmp, onlyMine]);

  // ✅ Realtime 구독: 디바운스 + 소프트 로딩(리스트 유지)
  useEffect(() => {
    const ch = supabase
      .channel('schedules-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => {
        if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
        reloadTimer.current = window.setTimeout(() => loadRows(true), 200);
      })
      .subscribe();
    return () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate() {
    setMsg(null);
    try {
      await waitForAuthReady();

      const payload: any = {
        title: f.title.trim(),
        site_address: f.site_address.trim(),
        location: f.site_address.trim(),
        start_ts: toISO(f.start_ts),
        end_ts: toISO(f.end_ts),
        daily_wage: Number(f.daily_wage || 0),
        status: f.status,
        employee_id: null,
        employee_name: null,
        employee_phone: null,
      };

      if (!isElevated) {
        if (!uid) {
          setMsg('세션을 다시 확인해주세요.');
          return;
        }
        const { data: p } = await supabase
          .from('profiles')
          .select('full_name,phone')
          .eq('id', uid)
          .maybeSingle();

        payload.employee_id = uid;
        payload.employee_name = (p?.full_name ?? fullName ?? '').trim() || null;
        payload.employee_phone = (p?.phone ?? '').trim() || null;
      } else {
        if (emp.mode === 'profile') {
          if (!emp.employeeId) {
            setMsg('직원을 선택해주세요.');
            return;
          }
          const { data: prof, error: pErr } = await supabase
            .from('profiles')
            .select('full_name, phone')
            .eq('id', emp.employeeId)
            .maybeSingle();
          if (pErr) throw pErr;

          payload.employee_id = emp.employeeId;
          payload.employee_name = prof?.full_name ?? null;
          payload.employee_phone = prof?.phone ?? null;
        } else {
          if (!emp.name) {
            setMsg('직접입력: 이름을 입력해주세요.');
            return;
          }
          payload.employee_name = emp.name.trim();
          payload.employee_phone = emp.phone?.trim() || null;
        }
      }

      const { error } = await supabase.from('schedules').insert(payload);
      if (error) throw error;

      setFormOpen(false);
      setF({ title: '', site_address: '', start_ts: '', end_ts: '', daily_wage: 0, status: 'scheduled' });
      setEmp({ mode: 'profile', employeeId: '' });
      await loadRows(true); // 소프트 리로드
    } catch (e: any) {
      setMsg(e?.message || '등록 중 오류가 발생했습니다.');
    }
  }

  async function onDelete(id: number, row: Row) {
    if (!isElevated) {
      const ownerId = (row.employee_id ?? '').trim();
      if (!(ownerId && uid && ownerId === uid)) {
        setMsg('본인 일정만 삭제할 수 있습니다.');
        return;
      }
    }
    if (!confirm('정말 삭제할까요?')) return;
    const { error } = await supabase.from('schedules').delete().eq('id', id);
    if (error) {
      setMsg(error.message);
      return;
    }
    loadRows(true);
  }

  // ✅ 완료 처리: 급여 트리거 + UI 유지 보수
  async function onComplete(id: number) {
    const cur = rows.find(r => r.id === id);
    if (cur && (cur.completed || cur.status === 'done')) return;

    // 1) 낙관 갱신(리스트 유지)
    setRows(prev =>
      prev.map(r => (r.id === id ? { ...r, completed: true, status: r.status === 'cancelled' ? 'cancelled' : 'done' } : r))
    );

    // 2) DB 반영(트리거가 payrolls 생성/합산)
    const payload: any = { completed: true };
    if (uid) payload.completed_by = uid;
    payload.completed_at = new Date().toISOString();

    const { error } = await supabase.from('schedules').update(payload).eq('id', id);
    if (error) {
      alert('완료 처리 실패: ' + error.message);
      // 실패 시 롤백
      setRows(prev =>
        prev.map(r => (r.id === id ? { ...r, completed: false, status: r.status === 'done' ? 'scheduled' : r.status } : r))
      );
      return;
    }

    // 3) 최신 completed만 재확인(새로고침 없이 정합성 ↑)
    const { data: flag } = await supabase.from('schedules').select('id, completed').eq('id', id).maybeSingle();
    if (flag) {
      setRows(prev =>
        prev.map(r =>
          r.id === id ? { ...r, completed: !!flag.completed, status: r.status === 'cancelled' ? 'cancelled' : (!!flag.completed ? 'done' : 'scheduled') } : r
        )
      );
    }
  }

  const totalWage = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.daily_wage) || 0), 0),
    [rows]
  );

  const fmtLocal = (v?: string) => (v ? new Date(v).toLocaleString() : '-');

  return (
    <div className="space-y-6">
      {/* 타이틀 */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">스케줄</h1>
          <p className="text-slate-600 text-sm mt-1">작업 일정을 생성하고 상태를 관리하세요.</p>
        </div>

        {/* 상단 액션 */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => loadRows()} className="btn h-7 px-2 text-[11px] md:h-9 md:px-3 md:text-sm min-w-[68px]">
            새로고침
          </button>
          <button onClick={() => setFormOpen((v) => !v)} className="btn-primary h-7 px-2 text-[11px] md:h-9 md:px-3 md:text-sm min-w-[86px]">
            {formOpen ? '등록 폼 닫기' : '+ 새 일정'}
          </button>
        </div>
      </div>

      {/* 보기 필터: 직원별 보기 */}
      <section className="card p-3 sm:p-4">
        <div className="flex flex-col md:flex-row items-start md:items-end gap-2 md:gap-3 text-sm">
          {isElevated ? (
            <>
              <div className="grow w-full md:w-auto">
                <EmployeePicker label="직원별 보기(선택 시 해당 직원만)" value={viewEmp} onChange={setViewEmp} />
              </div>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="checkbox"
                  checked={onlyMine}
                  onChange={(e) => setOnlyMine(e.target.checked)} />
                내 것만 보기
              </label>
              <button
                className="btn h-7 px-2 text-[11px] md:h-9 md:px-3 md:text-sm"
                onClick={() => { setViewEmp({ mode: 'profile', employeeId: '' }); setOnlyMine(false); }}
              >
                필터 초기화
              </button>
            </>
          ) : (
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" className="checkbox" checked readOnly />
              직원 모드: 본인 일정만 표시됩니다
            </label>
          )}
        </div>
        {/* ✅ 백그라운드 동기화 표시 */}
        {bgLoading && <div className="mt-2 text-xs text-slate-500">동기화 중…</div>}
      </section>

      {/* 인라인 등록 폼 */}
      {formOpen && (
        <section className="card max-w-3xl p-3 sm:p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 text-sm">
            <div className="md:col-span-2">
              <label className="mb-1 block text-slate-600">제목</label>
              <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="작업 제목" />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-slate-600">현장주소</label>
              <input
                className="input"
                value={f.site_address}
                onChange={(e) => setF({ ...f, site_address: e.target.value })}
                placeholder="예) 서울시 ○○구 ○○로 123"
              />
            </div>

            {isElevated && (
              <div className="md:col-span-2">
                <EmployeePicker label="담당 직원" value={emp} onChange={setEmp} />
              </div>
            )}

            <div>
              <label className="mb-1 block text-slate-600">시작</label>
              <input type="datetime-local" className="input" value={f.start_ts} onChange={(e) => setF({ ...f, start_ts: e.target.value })} />
            </div>

            <div>
              <label className="mb-1 block text-slate-600">종료</label>
              <input type="datetime-local" className="input" value={f.end_ts} onChange={(e) => setF({ ...f, end_ts: e.target.value })} />
            </div>

            <div>
              <label className="mb-1 block text-slate-600">일당(₩)</label>
              <input type="number" className="input" value={f.daily_wage} onChange={(e) => setF({ ...f, daily_wage: Number(e.target.value || 0) })} min={0} />
            </div>

            <div>
              <label className="mb-1 block text-slate-600">상태</label>
              <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Row['status'] })}>
                <option value="scheduled">{STATUS_LABEL.scheduled} (예정)</option>
                <option value="in_progress">{STATUS_LABEL.in_progress} (작업 중)</option>
                <option value="done">{STATUS_LABEL.done} (완료)</option>
                <option value="cancelled">{STATUS_LABEL.cancelled} (취소)</option>
              </select>
            </div>
          </div>

          {msg ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {msg}
            </div>
          ) : null}

          <div className="mt-4 md:mt-5 flex gap-2">
            <button onClick={onCreate} className="btn-primary h-8 px-3 text-sm">등록</button>
            <button onClick={() => setFormOpen(false)} className="btn h-8 px-3 text-sm">취소</button>
          </div>
        </section>
      )}

      {/* 메시지 (폼 닫힌 상태) */}
      {msg && !formOpen ? (
        <div className="card border-rose-200 bg-rose-50 text-rose-700 text-sm">{msg}</div>
      ) : null}

      {/* ===== 목록 ===== */}
      <section className="card">
        {(loading && rows.length === 0) ? (
          // 최초 로딩에만 빈화면 방지용 메시지
          <div className="text-sm text-slate-600">불러오는 중…</div>
        ) : (
          <>
            {/* 📱 모바일: 카드 리스트 */}
            <div className="sm:hidden space-y-2">
              {rows.length === 0 && !loading && (
                <div className="text-sm text-slate-500">
                  데이터가 없습니다. {isElevated ? '필터를 조정하거나 “+ 새 일정”으로 추가해보세요.' : '관리자/매니저에게 일정을 배정받거나 “+ 새 일정”으로 본인 일정을 추가해보세요.'}
                </div>
              )}

              {rows.map((r) => {
                const start = fmtLocal(r.start_ts);
                const end = fmtLocal(r.end_ts);
                return (
                  <div
                    key={r.id}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-slate-900 truncate">{r.title || '(제목없음)'}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                          {r.employee_name && <span className="truncate">👤 {r.employee_name}</span>}
                          {r.site_address && <span className="truncate">📍 {r.site_address}</span>}
                          <span className="truncate">🕒 {start}</span>
                          <span className="truncate">~ {end}</span>
                        </div>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>

                    <div className="mt-2 flex items-center justify-end gap-1">
                      <Link className="btn h-7 px-2 text-[11px]" href={`/schedules/${r.id}/edit`}>
                        수정
                      </Link>
                      <button className="btn h-7 px-2 text-[11px]" onClick={() => onDelete(r.id, r)}>
                        삭제
                      </button>
                      {/* ✅ 완료 버튼(모바일) */}
                      <button
                        className="btn h-7 px-2 text-[11px]"
                        onClick={() => onComplete(r.id)}
                        disabled={!!r.completed || r.status === 'done'}
                        title={r.completed || r.status === 'done' ? '이미 완료됨' : '완료 처리'}
                      >
                        {r.completed || r.status === 'done' ? '완료됨' : '완료'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 🖥️ 데스크탑: 테이블 */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="border-b bg-sky-50/50">
                    <th className="p-2 text-left w-[220px]">제목</th>
                    <th className="p-2 text-left w-[240px]">현장주소</th>
                    <th className="p-2 text-left w-[240px]">담당</th>
                    <th className="p-2 text-left w-[170px]">시작</th>
                    <th className="p-2 text-left w-[170px]">종료</th>
                    <th className="p-2 text-right w-[140px]">일당</th>
                    <th className="p-2 text-left w-[120px]">상태</th>
                    <th className="p-2 text-left w-[200px]">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="p-2 truncate w-[220px]">{r.title}</td>
                      <td className="p-2 truncate w-[240px]">{r.site_address}</td>
                      <td className="p-2 truncate w-[240px]">{r.employee_name || '-'}</td>
                      <td className="p-2 w-[170px]">{fmtLocal(r.start_ts)}</td>
                      <td className="p-2 w-[170px]">{fmtLocal(r.end_ts)}</td>
                      <td className="p-2 text-right w-[140px]">{Number(r.daily_wage || 0).toLocaleString('ko-KR')}</td>
                      <td className="p-2 w-[120px]">{STATUS_LABEL[r.status]}</td>
                      <td className="p-2 w-[200px]">
                        <div className="flex flex-wrap gap-2">
                          <Link className="btn h-8 px-3 text-xs" href={`/schedules/${r.id}/edit`}>수정</Link>
                          <button className="btn h-8 px-3 text-xs" onClick={() => onDelete(r.id, r)}>삭제</button>
                          {/* ✅ 완료 버튼(데스크탑) */}
                          <button
                            className="btn h-8 px-3 text-xs"
                            onClick={() => onComplete(r.id)}
                            disabled={!!r.completed || r.status === 'done'}
                            title={r.completed || r.status === 'done' ? '이미 완료됨' : '완료 처리'}
                          >
                            {r.completed || r.status === 'done' ? '완료됨' : '완료'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-right text-xs text-slate-500 mt-2">
                총 인건비 합계: {rows.reduce((a,c)=>a+Number(c.daily_wage||0),0).toLocaleString('ko-KR')}원
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ====== 보조 컴포넌트 ====== */
function StatusBadge({ status }: { status: Row['status'] }) {
  const map: Record<Row['status'], string> = {
    scheduled: 'bg-sky-100 text-sky-700',
    in_progress: 'bg-amber-100 text-amber-700',
    done: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${map[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
