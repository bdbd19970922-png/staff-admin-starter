// FILE: app/admin/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, endOfMonth, addDays } from 'date-fns'

/* ================= 공통 타입 ================= */
type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
  phone: string | null
  is_admin: boolean | null
}

type ScheduleRow = {
  id: number
  title: string | null
  start_ts: string | null
  end_ts: string | null
  employee_id?: string | null
  employee_name?: string | null
  revenue?: number | null
  material_cost?: number | null
  daily_wage?: number | null
  extra_cost?: number | null
}

type FinanceItem = {
  id: number
  item_date: string
  category: 'revenue'|'material_cost'|'daily_wage'|'extra_income'|'fixed_expense'|'extra_expense'
  label: string | null
  amount: number
  employee_id: string | null
  employee_name: string | null
  created_at: string
}

/* ================= 유틸 ================= */
const COOKIE = 'admin_ok=1'
const hasGate = () => typeof document !== 'undefined' && document.cookie.includes(COOKIE)
const pass = () => { if (typeof document !== 'undefined') document.cookie = `${COOKIE}; path=/; max-age=86400` }

const num = (v: number | null | undefined) => Number.isFinite(Number(v ?? 0)) ? Number(v ?? 0) : 0
const money = (n: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n)
function toDateInputValue(d: Date) { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}` }
function parseDateInput(s: string) { const d = new Date(s + 'T00:00:00'); return isNaN(+d) ? null : d }
function safeDate(iso: string | null | undefined) { if (!iso) return null; const d = new Date(iso); return isNaN(+d) ? null : d }
function isAfter(a: Date, b: Date) { return a.getTime() > b.getTime() }

/* ================= 메인 페이지 ================= */
export default function AdminPage() {
  // 하이드레이션 안전 처리
  const [mounted, setMounted] = useState(false)
  const [gate, setGate] = useState<boolean | null>(null)
  const [gateInput, setGateInput] = useState('')
  const [gateMsg, setGateMsg] = useState<string | null>(null)

  // 임시 게이트 비번 (배포 전엔 .env 사용 권장)
  const ADMIN_PASS = process.env.NEXT_PUBLIC_ADMIN_GATE_PASSWORD || '1234'

  useEffect(() => { setMounted(true); setGate(hasGate()) }, [])
  const onEnter = () => {
    if (!ADMIN_PASS) { setGateMsg('NEXT_PUBLIC_ADMIN_GATE_PASSWORD 미설정'); return }
    if (gateInput === ADMIN_PASS) { pass(); setGate(true) } else { setGateMsg('비밀번호가 올바르지 않습니다.') }
  }

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'report'|'employees'|'finance'>('report')

  // 공통 관리자 체크 (※ /admin 접근은 is_admin만 통과)
  useEffect(() => {
    if (!mounted || gate !== true) return
    ;(async () => {
      const { data: u } = await supabase.auth.getUser()
      if (!u.user) { if (typeof window !== 'undefined') window.location.href = '/'; return }
      const { data: me } = await supabase.from('profiles').select('is_admin').eq('id', u.user.id).maybeSingle()
      const admin = !!me?.is_admin; setIsAdmin(admin)
      if (!admin) { if (typeof window !== 'undefined') window.location.href = '/dashboard' }
    })()
  }, [mounted, gate])

  // ✅ JSX 렌더 형태로 변경 (함수 직접 호출 금지)
  if (!mounted || gate === null) return <LoadingCard />
  if (gate === false) return <GateCard gateInput={gateInput} setGateInput={setGateInput} onEnter={onEnter} gateMsg={gateMsg} />
  if (isAdmin === null) return <LoadingCard />
  if (!isAdmin) return null

  return (
    <div className="container">
      <div className="card" style={{ marginTop: 16 }}>
        <h1>관리자</h1>

        {/* 탭 */}
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className={`btn ${tab==='report'?'primary':'secondary'}`} onClick={()=>setTab('report')}>리포트</button>
          <button className={`btn ${tab==='employees'?'primary':'secondary'}`} onClick={()=>setTab('employees')}>직원 관리</button>
          <button className={`btn ${tab==='finance'?'primary':'secondary'}`} onClick={()=>setTab('finance')}>정산(수입/지출)</button>
        </div>

        {/* 콘텐츠 */}
        <div style={{ marginTop: 12 }}>
          {tab === 'report' && <ReportSection />}
          {tab === 'employees' && <EmployeesSection />}
          {tab === 'finance' && <FinanceSection />}
        </div>
      </div>
    </div>
  )
}

/* ================= 공통 작은 컴포넌트 ================= */
function LoadingCard() {
  return <div className="container"><div className="card" style={{ marginTop: 16 }}>불러오는 중…</div></div>
}
function GateCard({ gateInput, setGateInput, onEnter, gateMsg }:{
  gateInput:string; setGateInput:(v:string)=>void; onEnter:()=>void; gateMsg:string|null
}) {
  return (
    <div className="container">
      <div className="card" style={{ marginTop: 16, maxWidth: 480 }}>
        <h1>관리자 페이지</h1>
        <p className="muted">주소창으로 /admin 직접 접근 시에만 보입니다.</p>
        <input className="input" placeholder="관리자 비밀번호" type="password" value={gateInput} onChange={e => setGateInput(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={onEnter}>입장</button>
        </div>
        {gateMsg && <p className="muted" style={{ marginTop: 8 }}>{gateMsg}</p>}
        <p className="muted" style={{ marginTop: 8 }}>※ 실제 데이터 보호는 RLS(관리자 전용 정책)으로 수행됩니다.</p>
      </div>
    </div>
  )
}

/* ================= 직원 관리 탭 ================= */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableHeader, TableRow, TableHead,
  TableBody, TableCell
} from "@/components/ui/table";

function EmployeesSection() {
  type ProfileRowLite = {
    id: string
    full_name: string | null
    phone: string | null
    email: string | null
    is_admin: boolean | null
    is_manager: boolean | null
  }

  const [rows, setRows] = useState<ProfileRowLite[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [edit, setEdit] = useState<ProfileRowLite | null>(null)
  const [q, setQ] = useState('') // 🔎 검색어

  const load = async () => {
    setLoading(true); setMsg(null)
    const { data, error } = await supabase
      .from('profiles')
      .select('id,full_name,phone,email,is_admin,is_manager')
      .order('full_name', { ascending: true })
    if (error) setMsg(error.message)
    setRows((data ?? []) as ProfileRowLite[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const onSave = async () => {
    if (!edit) return
    const { id, full_name, phone, is_manager } = edit
    const { error } = await supabase
      .from('profiles')
      .update({ full_name, phone, is_manager })
      .eq('id', id)
    if (error) { alert(error.message); return }
    setEdit(null); load()
  }

  const onDelete = async (id: string) => {
    if (!confirm('정말 삭제할까요? (auth 계정은 삭제되지 않습니다)')) return
    const { error } = await supabase.from('profiles').delete().eq('id', id)
    if (error) { alert(error.message); return }
    load()
  }

  // 🔎 클라이언트 단 검색(이름/이메일/전화)
  const filtered = rows.filter(r => {
    if (!q.trim()) return true
    const key = `${r.full_name ?? ''} ${r.email ?? ''} ${r.phone ?? ''}`.toLowerCase()
    return key.includes(q.toLowerCase())
  })

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      {/* 헤더/액션바 */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-slate-800">직원 관리</h2>
        <div className="flex items-center gap-2">
          <Input
            placeholder="이름/이메일/전화 검색"
            className="w-64"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button
            variant="outline"
            onClick={load}
            disabled={loading}
            title="새로고침"
          >
            새로고침
          </Button>
        </div>
      </div>

      {msg && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {msg}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">불러오는 중…</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>전화</TableHead>
                <TableHead className="text-center">관리자</TableHead>
                <TableHead className="text-center">매니저</TableHead>
                <TableHead className="text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const isEditing = edit?.id === r.id
                return (
                  <TableRow key={r.id} className="hover:bg-slate-50/70">
                    {/* 이름 */}
                    <TableCell className="align-middle">
                      {isEditing ? (
                        <Input
                          value={edit!.full_name ?? ''}
                          onChange={(e) =>
                            setEdit({ ...edit!, full_name: e.target.value })
                          }
                        />
                      ) : (
                        <span className="text-slate-800">
                          {r.full_name ?? '(미입력)'}
                        </span>
                      )}
                    </TableCell>

                    {/* 이메일 */}
                    <TableCell className="align-middle">
                      {r.email && r.email.trim() !== '' ? r.email : (
                        <span className="text-slate-400">미등록</span>
                      )}
                    </TableCell>

                    {/* 전화 */}
                    <TableCell className="align-middle">
                      {isEditing ? (
                        <Input
                          value={edit!.phone ?? ''}
                          onChange={(e) =>
                            setEdit({ ...edit!, phone: e.target.value })
                          }
                        />
                      ) : (
                        r.phone ?? ''
                      )}
                    </TableCell>

                    {/* 관리자(읽기 전용) */}
                    <TableCell className="align-middle text-center">
                      {r.is_admin ? '✅' : '—'}
                    </TableCell>

                    {/* 매니저 토글 */}
                    <TableCell className="align-middle text-center">
                      {isEditing ? (
                        <Switch
                          checked={!!edit!.is_manager}
                          onCheckedChange={(v) =>
                            setEdit({ ...edit!, is_manager: v })
                          }
                        />
                      ) : (r.is_manager ? '✅' : '—')}
                    </TableCell>

                    {/* 작업 */}
                    <TableCell className="align-middle text-right space-x-2">
                      {isEditing ? (
                        <>
                          <Button size="sm" onClick={onSave} className="bg-sky-600 hover:bg-sky-700">
                            저장
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEdit(null)}>
                            취소
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setEdit(r)}>
                            수정
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => onDelete(r.id)}>
                            삭제
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        ※ 매니저는 /admin 접근권한은 없지만 직원/스케줄/정산 편집 권한은 관리자와 동일합니다.
      </p>
    </div>
  )
}

/* ================= 정산(수입/지출) 탭 ================= */
function FinanceSection() {
  const [list, setList] = useState<FinanceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // 기존 일반 입력 폼
  const [form, setForm] = useState<Partial<FinanceItem>>({
    item_date: toDateInputValue(new Date()),
    category: 'revenue',
    label: '',
    amount: 0,
    employee_name: ''   // ⭐ 자유 입력 이름
  })
  const [editId, setEditId] = useState<number | null>(null)

  // ✨ 추가수익 계산 입력 UI
  const [openExtra, setOpenExtra] = useState(false)
  const [extraForm, setExtraForm] = useState<{
    item_date: string
    revenue: number
    wage: number
    other: number
    label: string
    employee_name: string | null   // ⭐ 이름
  }>({
    item_date: toDateInputValue(new Date()),
    revenue: 0,
    wage: 0,
    other: 0,
    label: '',
    employee_name: null,
  })
  const extraNet = (Number(extraForm.revenue) || 0) - (Number(extraForm.wage) || 0) - (Number(extraForm.other) || 0)

  const load = async () => {
    setLoading(true); setMsg(null)
    const { data, error } = await supabase
      .from('finance_items')
      .select('*')
    if (error) setMsg(error.message)
    setList((data ?? []) as FinanceItem[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const resetForm = () => {
    setForm({ item_date: toDateInputValue(new Date()), category: 'revenue', label: '', amount: 0, employee_name: '' })
    setEditId(null)
  }

  const onSubmit = async () => {
    if (!form.item_date || !form.category || form.amount == null) { alert('날짜/분류/금액은 필수'); return }
    const payload = {
      item_date: form.item_date,
      category: form.category,
      label: form.label ?? null,
      amount: Number(form.amount),
      employee_name: (form.employee_name ?? '') || null,
    }
    if (editId) {
      const { error } = await supabase.from('finance_items').update(payload).eq('id', editId)
      if (error) { alert(error.message); return }
    } else {
      const { error } = await supabase.from('finance_items').insert([payload])
      if (error) { alert(error.message); return }
    }
    resetForm(); load()
  }

  const onEdit = (row: FinanceItem) => {
    setEditId(row.id)
    setForm({
      item_date: row.item_date,
      category: row.category,
      label: row.label ?? '',
      amount: row.amount,
      employee_name: row.employee_name ?? ''
    })
  }
  const onDelete = async (id: number) => {
    if (!confirm('정말 삭제할까요?')) return
    const { error } = await supabase.from('finance_items').delete().eq('id', id)
    if (error) { alert(error.message); return }
    load()
  }

  // ✨ 추가수익 계산 → extra_income으로 저장 (이름 포함)
  const saveExtraIncome = async () => {
    if (!extraForm.item_date) { alert('날짜를 선택하세요.'); return }
    const amount = Number(extraNet) || 0
    if (amount <= 0) {
      const ok = confirm(`계산된 순수익이 ${amount}원입니다. 그래도 추가수익으로 저장할까요?`)
      if (!ok) return
    }
    const { error } = await supabase.from('finance_items').insert([{
      item_date: extraForm.item_date,
      category: 'extra_income',
      label: extraForm.label || '추가수익(계산: 매출-인건비-그외)',
      amount,
      employee_name: (extraForm.employee_name ?? '') || null
    }])
    if (error) { alert(error.message); return }
    setOpenExtra(false)
    setExtraForm({
      item_date: toDateInputValue(new Date()),
      revenue: 0, wage: 0, other: 0, label: '', employee_name: null
    })
    load()
  }

  return (
    <div className="card">
      <h2>정산 항목 입력</h2>
      {msg && <p className="muted">{msg}</p>}

      {/* ✨ 추가수익 계산 버튼 */}
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <button className="btn secondary" onClick={() => setOpenExtra(v => !v)}>
          {openExtra ? '추가수익 계산 닫기' : '추가수익 계산 입력'}
        </button>
      </div>

      {/* ✨ 추가수익 계산 폼 */}
      {openExtra && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div>
              <label className="muted">날짜</label>
              <input
                type="date"
                className="input"
                value={extraForm.item_date}
                onChange={e=>setExtraForm({...extraForm, item_date:e.target.value})}
              />
            </div>
            <div>
              <label className="muted">매출</label>
              <input
                className="input" type="number"
                value={extraForm.revenue}
                onChange={e=>setExtraForm({...extraForm, revenue:Number(e.target.value)})}
                placeholder="0"
              />
            </div>
            <div>
              <label className="muted">인건비</label>
              <input
                className="input" type="number"
                value={extraForm.wage}
                onChange={e=>setExtraForm({...extraForm, wage:Number(e.target.value)})}
                placeholder="0"
              />
            </div>
            <div>
              <label className="muted">그외비용</label>
              <input
                className="input" type="number"
                value={extraForm.other}
                onChange={e=>setExtraForm({...extraForm, other:Number(e.target.value)})}
                placeholder="0"
              />
            </div>
            <div>
              <label className="muted">직원이름(선택)</label>
              <input
                className="input"
                value={extraForm.employee_name ?? ''}
                onChange={e=>setExtraForm({...extraForm, employee_name: e.target.value || null})}
                placeholder="자유 입력 (가입 여부 무관)"
              />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="muted">메모(선택)</label>
              <input
                className="input"
                value={extraForm.label}
                onChange={e=>setExtraForm({...extraForm, label:e.target.value})}
                placeholder="예) A고객 추가수익 정산"
              />
            </div>
          </div>

          <div className="row" style={{ gap: 8, marginTop: 8, alignItems:'center', flexWrap:'wrap' }}>
            <div className="muted">순수익 = 매출 - 인건비 - 그외비용</div>
            <div><b>{money(extraNet)}</b></div>
            <div style={{ marginLeft: 'auto' }}>
              <button className="btn primary" onClick={saveExtraIncome}>추가수익으로 저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 기존 일반 입력 폼 */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div>
          <label className="muted">날짜</label>
          <input type="date" className="input" value={form.item_date ?? ''} onChange={e=>setForm({...form, item_date:e.target.value})}/>
        </div>
        <div>
          <label className="muted">분류</label>
          <select className="input" value={form.category ?? 'revenue'} onChange={e=>setForm({...form, category: e.target.value as any})}>
            <option value="revenue">매출</option>
            <option value="material_cost">자재비</option>
            <option value="daily_wage">인건비</option>
            <option value="extra_income">추가수익</option>
            <option value="fixed_expense">고정지출</option>
            <option value="extra_expense">추가지출</option>
          </select>
        </div>
        <div>
          <label className="muted">메모</label>
          <input className="input" value={form.label ?? ''} onChange={e=>setForm({...form, label:e.target.value})} placeholder="설명(선택)"/>
        </div>
        <div>
          <label className="muted">금액</label>
          <input className="input" type="number" value={form.amount ?? 0} onChange={e=>setForm({...form, amount:Number(e.target.value)})}/>
        </div>
        <div>
          <label className="muted">직원이름(선택)</label>
          <input
            className="input"
            value={form.employee_name ?? ''}
            onChange={e=>setForm({...form, employee_name:e.target.value})}
            placeholder="자유 입력 (가입 여부 무관)"
          />
        </div>
        <div style={{ alignSelf:'end' }}>
          <button className="btn primary" onClick={onSubmit}>{editId ? '수정' : '추가'}</button>{' '}
          {editId && <button className="btn" onClick={resetForm}>취소</button>}
        </div>
      </div>

      {/* 목록 */}
      <div style={{ overflowX:'auto', marginTop: 12 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ borderBottom:'1px solid #e5e7eb' }}>
              <th style={{ textAlign:'left', padding:6 }}>날짜</th>
              <th style={{ textAlign:'left', padding:6 }}>분류</th>
              <th style={{ textAlign:'left', padding:6 }}>메모</th>
              <th style={{ textAlign:'right', padding:6 }}>금액</th>
              <th style={{ textAlign:'left', padding:6 }}>직원이름</th>
              <th style={{ textAlign:'right', padding:6 }}>작업</th>
            </tr>
          </thead>
          <tbody>
            {list.sort((a,b)=> (a.item_date > b.item_date?1:-1) ).map(r=>(
              <tr key={r.id} style={{ borderBottom:'1px solid #f2f2f2' }}>
                <td style={{ padding:6 }}>{r.item_date}</td>
                <td style={{ padding:6 }}>{categoryLabel(r.category)}</td>
                <td style={{ padding:6 }}>{r.label ?? ''}</td>
                <td style={{ padding:6, textAlign:'right' }}>{money(r.amount)}</td>
                <td style={{ padding:6 }}>
                  {r.employee_name
                    ? r.employee_name
                    : (r.employee_id ? <span className="muted">{r.employee_id}</span> : '')}
                </td>
                <td style={{ padding:6, textAlign:'right' }}>
                  <button className="btn secondary" onClick={()=>onEdit(r)}>수정</button>{' '}
                  <button className="btn" onClick={()=>onDelete(r.id)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function categoryLabel(c: FinanceItem['category']) {
  return c==='revenue'?'매출'
    : c==='material_cost'?'자재비'
    : c==='daily_wage'?'인건비'
    : c==='extra_income'?'추가수익'
    : c==='fixed_expense'?'고정지출'
    : '추가지출'
}

/* ================= 리포트 탭 ================= */
function ReportSection() {
  // 기간
  const [dateFrom, setDateFrom] = useState<string>(() => toDateInputValue(startOfMonth(new Date())))
  const [dateTo, setDateTo] = useState<string>(() => toDateInputValue(endOfMonth(new Date())))

  // 포함/제외 체크박스
  const [inc, setInc] = useState({
    revenue: true,
    material_cost: true,
    daily_wage: true,
    extra_income: true,
    fixed_expense: true,
    extra_expense: true,
    extra_cost_half: true,
  })

  // 데이터
  const [sRows, setSRows] = useState<ScheduleRow[]>([])
  const [fRows, setFRows] = useState<FinanceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = async () => {
    setLoading(true); setMsg(null)
    const { data: s, error: es } = await supabase
      .from('schedules')
      .select('id,title,start_ts,end_ts,employee_id,employee_name,revenue,material_cost,daily_wage,extra_cost')
      .order('start_ts', { ascending: true })
    if (es) setMsg(es.message)
    setSRows((s ?? []) as ScheduleRow[])

    const { data: f, error: ef } = await supabase
      .from('finance_items')
      .select('*')
    if (ef) setMsg(ef.message)
    setFRows((f ?? []) as FinanceItem[])
    setLoading(false)
  }
  useEffect(()=>{ load() }, [])

  // 기간 필터링
  const sFiltered = useMemo(()=>{
    const s = parseDateInput(dateFrom), e = parseDateInput(dateTo)
    if (!s || !e) return sRows
    return sRows.filter(r => {
      const d = safeDate(r.start_ts); if (!d) return false
      return !(d < s) && !(d > e)
    })
  }, [sRows, dateFrom, dateTo])
  const fFiltered = useMemo(()=>{
    const s = parseDateInput(dateFrom), e = parseDateInput(dateTo)
    if (!s || !e) return fRows
    return fRows.filter(r => {
      const d = parseDateInput(r.item_date); if (!d) return false
      return !(d < s) && !(d > e)
    })
  }, [fRows, dateFrom, dateTo])

  // 일자 라벨
  const days = useMemo(()=>{
    const s = parseDateInput(dateFrom), e = parseDateInput(dateTo)
    if (!s || !e) return [] as Date[]
    const arr: Date[] = []
    for (let d = new Date(s); !isAfter(d, e); d = addDays(d, 1)) arr.push(new Date(d))
    return arr
  }, [dateFrom, dateTo])
  const labels = days.map(d=>format(d,'yyyy-MM-dd'))

  // 일자별 합산
  const values = labels.map(key => {
    // schedules에서 기본 3종 + 기타비용(분리)
    let rev=0, mat=0, wage=0, extraCost=0
    for (const r of sFiltered) {
      const rd = safeDate(r.start_ts); if (!rd) continue
      if (format(rd,'yyyy-MM-dd') !== key) continue
      rev += num(r.revenue)
      mat += num(r.material_cost)
      wage += num(r.daily_wage)
      extraCost += num(r.extra_cost)
    }
    // finance_items에서 추가 3종
    let exIncome=0, fixExp=0, exExp=0
    for (const f of fFiltered) {
      if (f.item_date !== key) continue
      if (f.category === 'extra_income') exIncome += f.amount
      else if (f.category === 'fixed_expense') fixExp += f.amount
      else if (f.category === 'extra_expense') exExp += f.amount
      else if (f.category === 'revenue') rev += f.amount
      else if (f.category === 'material_cost') mat += f.amount
      else if (f.category === 'daily_wage') wage += f.amount
    }

    // 체크박스 적용
    let total = 0
    if (inc.revenue) total += rev
    if (inc.extra_income) total += exIncome
    if (inc.material_cost) total -= mat
    if (inc.daily_wage) total -= wage
    if (inc.fixed_expense) total -= fixExp
    if (inc.extra_expense) total -= exExp
    if (inc.extra_cost_half) total += (extraCost / 2)

    return total
  })

  const minV = Math.min(0, ...values), maxV = Math.max(1, ...values)
  const path = buildSmoothPath(values, 1040, 280, { l:48, r:12, t:18, b:40 }, minV, maxV)

  // 표 합계
  const totals = {
    revenue: sumBy(labels, key => {
      let val=0
      for (const r of sFiltered) { const d=safeDate(r.start_ts); if (!d) continue; if (format(d,'yyyy-MM-dd')!==key) continue; val+=num(r.revenue) }
      for (const f of fFiltered) { if (f.item_date===key && f.category==='revenue') val+=f.amount }
      return val
    }),
    material_cost: sumBy(labels, key => {
      let val=0
      for (const r of sFiltered) { const d=safeDate(r.start_ts); if (!d) continue; if (format(d,'yyyy-MM-dd')!==key) continue; val+=num(r.material_cost) }
      for (const f of fFiltered) { if (f.item_date===key && f.category==='material_cost') val+=f.amount }
      return val
    }),
    daily_wage: sumBy(labels, key => {
      let val=0
      for (const r of sFiltered) { const d=safeDate(r.start_ts); if (!d) continue; if (format(d,'yyyy-MM-dd')!==key) continue; val+=num(r.daily_wage) }
      for (const f of fFiltered) { if (f.item_date===key && f.category==='daily_wage') val+=f.amount }
      return val
    }),
    extra_income: sumBy(labels, key => fFiltered.filter(f=>f.item_date===key && f.category==='extra_income').reduce((a,c)=>a+c.amount,0)),
    fixed_expense: sumBy(labels, key => fFiltered.filter(f=>f.item_date===key && f.category==='fixed_expense').reduce((a,c)=>a+c.amount,0)),
    extra_expense: sumBy(labels, key => fFiltered.filter(f=>f.item_date===key && f.category==='extra_expense').reduce((a,c)=>a+c.amount,0)),
    extra_cost: sumBy(labels, key => {
      return sFiltered
        .filter(r => { const d=safeDate(r.start_ts); if (!d) return false; return format(d,'yyyy-MM-dd')===key })
        .reduce((a,c)=>a+num(c.extra_cost),0)
    }),
  }

  const netTotal =
    (inc.revenue?totals.revenue:0) +
    (inc.extra_income?totals.extra_income:0) -
    (inc.material_cost?totals.material_cost:0) -
    (inc.daily_wage?totals.daily_wage:0) -
    (inc.fixed_expense?totals.fixed_expense:0) -
    (inc.extra_expense?totals.extra_expense:0) +
    (inc.extra_cost_half? (totals.extra_cost/2) : 0)

  return (
    <div>
      <h2>리포트</h2>
      {msg && <p className="muted">{msg}</p>}
      <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginTop: 6 }}>
        <div>
          <label className="muted">시작</label>
          <input type="date" className="input" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="muted">종료</label>
          <input type="date" className="input" value={dateTo} onChange={e=>setDateTo(e.target.value)} />
        </div>
        <button className="btn secondary" onClick={()=>{ setDateFrom(toDateInputValue(startOfMonth(new Date()))); setDateTo(toDateInputValue(endOfMonth(new Date()))) }}>이번 달</button>
      </div>

      {/* 체크박스 */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 12, flexWrap:'wrap' }}>
          {([
            ['revenue','매출'],
            ['material_cost','자재비'],
            ['daily_wage','인건비'],
            ['extra_income','추가수익'],
            ['fixed_expense','고정지출'],
            ['extra_expense','추가지출'],
            ['extra_cost_half','기타비용(캘린더, 1/2 가산)'],
          ] as const).map(([key, label])=>(
            <label key={key} className="row" style={{ gap:6 }}>
              <input
                type="checkbox"
                checked={(inc as any)[key]}
                onChange={e=>setInc(prev=>({ ...prev, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* 그래프 */}
      <div className="card" style={{ marginTop: 12 }}>
        <LineChart labels={labels} values={values} />
      </div>

      {/* 표 요약 */}
      <div className="card" style={{ marginTop: 12 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ borderBottom:'1px solid #e5e7eb' }}>
              <th style={{ textAlign:'left', padding:6 }}>지표</th>
              <th style={{ textAlign:'right', padding:6 }}>합계</th>
            </tr>
          </thead>
          <tbody>
            <RowSum name="매출" value={totals.revenue} on={inc.revenue}/>
            <RowSum name="자재비" value={totals.material_cost} on={inc.material_cost} neg/>
            <RowSum name="인건비" value={totals.daily_wage} on={inc.daily_wage} neg/>
            <RowSum name="추가수익" value={totals.extra_income} on={inc.extra_income}/>
            <RowSum name="고정지출" value={totals.fixed_expense} on={inc.fixed_expense} neg/>
            <RowSum name="추가지출" value={totals.extra_expense} on={inc.extra_expense} neg/>
            <RowSum name="기타비용(캘린더, 1/2 가산)" value={totals.extra_cost/2} on={inc.extra_cost_half}/>
            <tr style={{ borderTop:'2px solid #e5e7eb' }}>
              <td style={{ padding:6 }}><b>순수익(체크 반영)</b></td>
              <td style={{ padding:6, textAlign:'right' }}><b>{money(netTotal)}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RowSum({ name, value, on, neg }:{ name:string; value:number; on:boolean; neg?:boolean }) {
  const shown = on ? value : 0
  return (
    <tr>
      <td style={{ padding:6 }}>{name}{!on && <span className="muted"> (제외)</span>}</td>
      <td style={{ padding:6, textAlign:'right', color: neg ? '#b91c1c' : undefined }}>{money(shown*(neg?-1:1))}</td>
    </tr>
  )
}

/* ================= 라인차트 (SVG) ================= */
function LineChart({ labels, values }: { labels: string[]; values: number[] }) {
  const w = Math.max(320, Math.min(1040, labels.length * 64))
  const h = 280; const pad = { l: 48, r: 12, t: 18, b: 40 }
  const minV = Math.min(...values, 0); const maxV = Math.max(...values, 1); const span = maxV - minV || 1
  const pts = values.map((v, i) => {
    const x = pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, labels.length - 1)
    const y = pad.t + (h - pad.t - pad.b) * (1 - (v - minV) / span)
    return { x, y }
  })
  const d = buildSmoothPathPts(pts)
  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}>
        <line x1={pad.l} y1={h - pad.b} x2={w - pad.r} y2={h - pad.b} stroke="#ddd" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={h - pad.b} stroke="#ddd" />
        <path d={d} fill="none" stroke="black" strokeWidth={2} />
        {pts.map((p, i) => (<circle key={i} cx={p.x} cy={p.y} r={2} fill="black" />))}
        {labels.map((lab, i) => {
          const show = labels.length <= 12 || i % Math.ceil(labels.length / 12) === 0
          if (!show) return null
          const x = pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, labels.length - 1)
          return (<text key={i} x={x} y={h - pad.b + 14} fontSize="10" textAnchor="middle">{lab}</text>)
        })}
      </svg>
    </div>
  )
}
function buildSmoothPath(values:number[], w:number, h:number, pad:{l:number;r:number;t:number;b:number}, minV:number, maxV:number) {
  const span = maxV - minV || 1
  const pts = values.map((v,i)=>{
    const x = pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, values.length - 1)
    const y = pad.t + (h - pad.t - pad.b) * (1 - (v - minV) / span)
    return {x,y}
  })
  return buildSmoothPathPts(pts)
}
function buildSmoothPathPts(pts: { x: number; y: number }[]) {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  const d: (string | number)[] = ['M', pts[0].x, pts[0].y]; const t = 0.2
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1]; const dx = p1.x - p0.x
    d.push('C', p0.x + dx * t, p0.y, p1.x - dx * t, p1.y, p1.x, p1.y)
  }
  return d.join(' ')
}
function sumBy(labels:string[], f:(key:string)=>number){ return labels.reduce((a,k)=>a+f(k),0) }
