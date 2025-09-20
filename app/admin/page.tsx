// FILE: app/admin/page.tsx
'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, endOfMonth, addDays } from 'date-fns'

/* ================= 공통 타입 ================= */
type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
  phone: string | null
  is_admin: boolean | null
  is_manager: boolean | null
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

  if (!mounted || gate === null) return <LoadingCard />
  if (gate === false) return <GateCard gateInput={gateInput} setGateInput={setGateInput} onEnter={onEnter} gateMsg={gateMsg} />
  if (isAdmin === null) return <LoadingCard />
  if (!isAdmin) return null

  return (
    <div className="container px-3 md:px-4">
      <div className="card" style={{ marginTop: 16 }}>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-sky-700 via-sky-600 to-indigo-600 bg-clip-text text-transparent">관리자</span>
        </h1>

        {/* 탭: 한 줄 고정(아주 작으면 가로 스크롤) */}
        <div
          className="row flex items-center gap-2 md:gap-3 overflow-x-auto flex-nowrap"
          style={{ marginTop: 8 }}
        >
          <button className={`btn ${tab==='report'?'primary':'secondary'} min-h-[44px]`} onClick={()=>setTab('report')}>리포트</button>
          <button className={`btn ${tab==='employees'?'primary':'secondary'} min-h-[44px]`} onClick={()=>setTab('employees')}>직원 관리</button>
          {/* 요구: "정산(수입/지출)" → "정산" */}
          <button className={`btn ${tab==='finance'?'primary':'secondary'} min-h-[44px]`} onClick={()=>setTab('finance')}>정산</button>
        </div>

        {/* 콘텐츠 */}
        <div className="mt-3">
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
  return (
    <div className="container px-3 md:px-4">
      <div className="card" style={{ marginTop: 16 }}>불러오는 중…</div>
    </div>
  )
}
function GateCard({ gateInput, setGateInput, onEnter, gateMsg }:{
  gateInput:string; setGateInput:(v:string)=>void; onEnter:()=>void; gateMsg:string|null
}) {
  return (
    <div className="container px-3 md:px-4">
      <div className="card" style={{ marginTop: 16, maxWidth: 520 }}>
        <h1 className="text-2xl font-semibold">관리자 페이지</h1>
        <p className="muted">주소창으로 /admin 직접 접근 시에만 보입니다.</p>
        <input className="input w-full" placeholder="관리자 비밀번호" type="password" value={gateInput} onChange={e => setGateInput(e.target.value)} />
        <div className="row flex flex-wrap gap-2" style={{ marginTop: 8 }}>
          <button className="btn primary min-h-[44px] w-full sm:w-auto" onClick={onEnter}>입장</button>
        </div>
        {gateMsg && <p className="muted" style={{ marginTop: 8 }}>{gateMsg}</p>}
        <p className="muted" style={{ marginTop: 8 }}>※ 실제 데이터 보호는 RLS(관리자 전용 정책)으로 수행됩니다.</p>
      </div>
    </div>
  )
}

/* ================= 직원 관리 탭 (모바일 카드형 추가) ================= */
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
  const [meId, setMeId] = useState<string | null>(null)

  useEffect(() => { (async () => {
    const { data } = await supabase.auth.getUser()
    setMeId(data.user?.id ?? null)
  })() }, [])

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
    const { error } = await supabase.from('profiles').update({ full_name, phone, is_manager }).eq('id', id)
    if (error) { alert(error.message); return }
    if (meId && meId === id && typeof window !== 'undefined') { window.location.reload(); return }
    setEdit(null); load()
  }

  const onDelete = async (id: string) => {
    if (!confirm('정말 삭제할까요? (auth 계정은 삭제되지 않습니다)')) return
    const { error } = await supabase.from('profiles').delete().eq('id', id)
    if (error) { alert(error.message); return }
    load()
  }

  const grantManager = async (id: string) => {
    const { error } = await supabase.from('profiles').update({ is_manager: true }).eq('id', id)
    if (error) { alert(error.message); return }
    if (meId && meId === id && typeof window !== 'undefined') { window.location.reload(); return }
    load()
  }
  const revokeManager = async (id: string) => {
    const { error } = await supabase.from('profiles').update({ is_manager: false }).eq('id', id)
    if (error) { alert(error.message); return }
    if (meId && meId === id && typeof window !== 'undefined') { window.location.reload(); return }
    load()
  }

  const filtered = rows.filter(r => {
    if (!q.trim()) return true
    const key = `${r.full_name ?? ''} ${r.email ?? ''} ${r.phone ?? ''}`.toLowerCase()
    return key.includes(q.toLowerCase())
  })

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      {/* 액션바 */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-slate-800">직원 관리</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="이름/이메일/전화 검색" className="w-full sm:w-64" value={q} onChange={(e)=>setQ(e.target.value)} />
          <Button variant="outline" onClick={load} disabled={loading} title="새로고침" className="min-h-[44px]">새로고침</Button>
        </div>
      </div>

      {msg && <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</div>}

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">불러오는 중…</div>
      ) : (
        <>
          {/* 데스크탑: 기존 테이블 유지 */}
          <div className="hidden sm:block overflow-x-auto">
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
                      <TableCell className="align-middle">
                        {isEditing ? <Input value={edit!.full_name ?? ''} onChange={(e)=>setEdit({ ...edit!, full_name:e.target.value })} /> : <span className="text-slate-800">{r.full_name ?? '(미입력)'}</span>}
                      </TableCell>
                      <TableCell className="align-middle">{r.email && r.email.trim() !== '' ? r.email : <span className="text-slate-400">미등록</span>}</TableCell>
                      <TableCell className="align-middle">
                        {isEditing ? <Input value={edit!.phone ?? ''} onChange={(e)=>setEdit({ ...edit!, phone:e.target.value })} /> : (r.phone ?? '')}
                      </TableCell>
                      <TableCell className="align-middle text-center">{r.is_admin ? '✅' : '—'}</TableCell>
                      <TableCell className="align-middle text-center">
                        {isEditing ? <Switch checked={!!edit!.is_manager} onCheckedChange={(v)=>setEdit({ ...edit!, is_manager:v })} /> : (r.is_manager ? '✅' : '—')}
                      </TableCell>
                      <TableCell className="align-middle text-right space-x-2">
                        {isEditing ? (
                          <>
                            <Button size="sm" onClick={onSave} className="bg-sky-600 hover:bg-sky-700 min-h-[36px]">저장</Button>
                            <Button size="sm" variant="outline" onClick={()=>setEdit(null)} className="min-h-[36px]">취소</Button>
                          </>
                        ) : (
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={()=>setEdit(r)} className="min-h-[36px]">수정</Button>
                            {r.is_manager ? (
                              <Button size="sm" variant="secondary" onClick={()=>revokeManager(r.id)} className="min-h-[36px]">매니저 해제</Button>
                            ) : (
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 min-h-[36px]" onClick={()=>grantManager(r.id)}>매니저 부여</Button>
                            )}
                            <Button size="sm" variant="destructive" onClick={()=>onDelete(r.id)} className="min-h-[36px]">삭제</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* 모바일: 카드형 리스트 */}
          <div className="sm:hidden space-y-2">
            {filtered.map(r => {
              const isEditing = edit?.id === r.id
              return (
                <div key={r.id} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{r.full_name ?? '(미입력)'}</div>
                    <div className="text-xs text-slate-500">{r.is_admin ? '관리자' : (r.is_manager ? '매니저' : '')}</div>
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    <div>{r.email || <span className="text-slate-400">이메일 미등록</span>}</div>
                    <div>{isEditing ? <Input value={edit!.phone ?? ''} onChange={(e)=>setEdit({ ...edit!, phone:e.target.value })} /> : (r.phone ?? '')}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isEditing ? (
                      <>
                        <Button size="sm" onClick={onSave} className="bg-sky-600 hover:bg-sky-700">저장</Button>
                        <Button size="sm" variant="outline" onClick={()=>setEdit(null)}>취소</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={()=>setEdit(r)}>수정</Button>
                        {r.is_manager
                          ? <Button size="sm" variant="secondary" onClick={()=>revokeManager(r.id)}>매니저 해제</Button>
                          : <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={()=>grantManager(r.id)}>매니저 부여</Button>}
                        <Button size="sm" variant="destructive" onClick={()=>onDelete(r.id)}>삭제</Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && <div className="text-center text-sm text-slate-500 py-6">검색 결과가 없습니다.</div>}
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-slate-500">
        ※ 매니저는 /admin 접근권한은 없지만 직원/스케줄/정산 편집 권한은 관리자와 동일합니다. <br/>
        ※ 캘린더/리포트에서 <b>자재비·순수익은 자동 마스킹</b> 처리(별도 과정 불필요).
      </p>
    </div>
  )
}

/* ================= 정산 탭 (모바일 컴팩트) ================= */
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
    employee_name: ''
  })
  const [editId, setEditId] = useState<number | null>(null)

  // 추가수익 계산 입력 UI
  const [openExtra, setOpenExtra] = useState(false)
  const [extraForm, setExtraForm] = useState<{
    item_date: string
    revenue: number
    wage: number
    other: number
    label: string
    employee_name: string | null
  }>({
    item_date: toDateInputValue(new Date()),
    revenue: 0, wage: 0, other: 0, label: '', employee_name: null,
  })
  const extraNet = (Number(extraForm.revenue) || 0) - (Number(extraForm.wage) || 0) - (Number(extraForm.other) || 0)

  const load = async () => {
    setLoading(true); setMsg(null)
    const { data, error } = await supabase.from('finance_items').select('*')
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
    setForm({ item_date: row.item_date, category: row.category, label: row.label ?? '', amount: row.amount, employee_name: row.employee_name ?? '' })
  }
  const onDelete = async (id: number) => {
    if (!confirm('정말 삭제할까요?')) return
    const { error } = await supabase.from('finance_items').delete().eq('id', id)
    if (error) { alert(error.message); return }
    load()
  }

  const saveExtraIncome = async () => {
    if (!extraForm.item_date) { alert('날짜를 선택하세요.'); return }
    const amount = Number(extraNet) || 0
    if (amount <= 0) { const ok = confirm(`계산된 순수익이 ${amount}원입니다. 그래도 추가수익으로 저장할까요?`); if (!ok) return }
    const { error } = await supabase.from('finance_items').insert([{
      item_date: extraForm.item_date,
      category: 'extra_income',
      label: extraForm.label || '추가수익(계산: 매출-인건비-그외)',
      amount,
      employee_name: (extraForm.employee_name ?? '') || null
    }])
    if (error) { alert(error.message); return }
    setOpenExtra(false)
    setExtraForm({ item_date: toDateInputValue(new Date()), revenue: 0, wage: 0, other: 0, label: '', employee_name: null })
    load()
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold">정산 항목 입력</h2>
      {msg && <p className="muted">{msg}</p>}

      {/* 추가수익 계산 버튼 */}
      <div className="row flex flex-wrap gap-2 md:gap-3" style={{ marginBottom: 8 }}>
        <button className="btn secondary min-h-[44px] w-full sm:w-auto" onClick={() => setOpenExtra(v => !v)}>
          {openExtra ? '추가수익 계산 닫기' : '추가수익 계산 입력'}
        </button>
      </div>

      {openExtra && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <div>
              <label className="muted">날짜</label>
              <input type="date" className="input min-h-[44px]" value={extraForm.item_date} onChange={e=>setExtraForm({...extraForm, item_date:e.target.value})}/>
            </div>
            <div>
              <label className="muted">매출</label>
              <input className="input min-h-[44px]" type="number" value={extraForm.revenue} onChange={e=>setExtraForm({...extraForm, revenue:Number(e.target.value)})} />
            </div>
            <div>
              <label className="muted">인건비</label>
              <input className="input min-h-[44px]" type="number" value={extraForm.wage} onChange={e=>setExtraForm({...extraForm, wage:Number(e.target.value)})} />
            </div>
            <div>
              <label className="muted">그외비용</label>
              <input className="input min-h-[44px]" type="number" value={extraForm.other} onChange={e=>setExtraForm({...extraForm, other:Number(e.target.value)})} />
            </div>
            <div>
              <label className="muted">직원이름(선택)</label>
              <input className="input min-h-[44px]" value={extraForm.employee_name ?? ''} onChange={e=>setExtraForm({...extraForm, employee_name:e.target.value || null})} placeholder="자유 입력" />
            </div>
            <div>
              <label className="muted">메모(선택)</label>
              <input className="input min-h-[44px]" value={extraForm.label} onChange={e=>setExtraForm({...extraForm, label:e.target.value})} />
            </div>
          </div>

          <div className="row" style={{ gap: 8, marginTop: 8, alignItems:'center', flexWrap:'wrap' }}>
            <div className="muted">순수익 = 매출 - 인건비 - 그외비용</div>
            <div><b>{money(extraNet)}</b></div>
            <div className="ml-auto">
              <button className="btn primary min-h-[44px]" onClick={saveExtraIncome}>추가수익으로 저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 기존 일반 입력 폼 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
        <div>
          <label className="muted">날짜</label>
          <input type="date" className="input min-h-[44px]" value={form.item_date ?? ''} onChange={e=>setForm({...form, item_date:e.target.value})}/>
        </div>
        <div>
          <label className="muted">분류</label>
          <select className="input min-h-[44px]" value={form.category ?? 'revenue'} onChange={e=>setForm({...form, category: e.target.value as any})}>
            <option value="revenue">매출</option>
            <option value="material_cost">자재비</option>
            <option value="daily_wage">인건비</option>
            <option value="extra_income">추가수익</option>
            <option value="fixed_expense">고정지출</option>
            <option value="extra_expense">추가지출</option>
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="muted">메모</label>
          <input className="input min-h-[44px]" value={form.label ?? ''} onChange={e=>setForm({...form, label:e.target.value})} placeholder="설명(선택)"/>
        </div>
        <div>
          <label className="muted">금액</label>
          <input className="input min-h-[44px]" type="number" value={form.amount ?? 0} onChange={e=>setForm({...form, amount:Number(e.target.value)})}/>
        </div>
        <div>
          <label className="muted">직원이름(선택)</label>
          <input className="input min-h-[44px]" value={form.employee_name ?? ''} onChange={e=>setForm({...form, employee_name:e.target.value})} placeholder="자유 입력"/>
        </div>
        <div className="sm:self-end">
          <button className="btn primary min-h-[44px] w-full sm:w-auto" onClick={onSubmit}>{editId ? '수정' : '추가'}</button>{' '}
          {editId && <button className="btn min-h-[44px] w-full sm:w-auto mt-2 sm:mt-0" onClick={resetForm}>취소</button>}
        </div>
      </div>

      {/* 목록: 데스크탑 표 유지 + 모바일 카드형 */}
      <div className="hidden sm:block" style={{ overflowX:'auto', marginTop: 12 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth: 760 }}>
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
                <td style={{ padding:6, whiteSpace:'nowrap' }}>{r.item_date}</td>
                <td style={{ padding:6 }}>{categoryLabel(r.category)}</td>
                <td style={{ padding:6 }}>{r.label ?? ''}</td>
                <td style={{ padding:6, textAlign:'right' }}>{money(r.amount)}</td>
                <td style={{ padding:6 }}>{r.employee_name ?? ''}</td>
                <td style={{ padding:6, textAlign:'right' }}>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button className="btn secondary min-h-[36px]" onClick={()=>onEdit(r)}>수정</button>
                    <button className="btn min-h-[36px]" onClick={()=>onDelete(r.id)}>삭제</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sm:hidden space-y-2 mt-3">
        {list.sort((a,b)=> (a.item_date > b.item_date?1:-1) ).map(r=>(
          <div key={r.id} className="rounded-xl border p-3">
            <div className="text-sm text-slate-500">{r.item_date} · {categoryLabel(r.category)}</div>
            <div className="font-medium">{r.label ?? '(메모 없음)'}</div>
            <div className="mt-1 flex items-center justify-between">
              <div className="text-xs text-slate-500">{r.employee_name ?? ''}</div>
              <div className="font-semibold">{money(r.amount)}</div>
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn secondary min-h-[36px] flex-1" onClick={()=>onEdit(r)}>수정</button>
              <button className="btn min-h-[36px] flex-1" onClick={()=>onDelete(r.id)}>삭제</button>
            </div>
          </div>
        ))}
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

    const { data: f, error: ef } = await supabase.from('finance_items').select('*')
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
    let rev=0, mat=0, wage=0, extraCost=0
    for (const r of sFiltered) {
      const rd = safeDate(r.start_ts); if (!rd) continue
      if (format(rd,'yyyy-MM-dd') !== key) continue
      rev += num(r.revenue)
      mat += num(r.material_cost)
      wage += num(r.daily_wage)
      extraCost += num(r.extra_cost)
    }
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

  return (
    <div>
      <h2 className="text-lg font-semibold">리포트</h2>
      {msg && <p className="muted">{msg}</p>}

      {/* 필터: 2줄(시작/종료) + 3줄(이번 달) */}
      <div className="mt-2">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
          <div>
            <label className="muted">시작</label>
            <input type="date" className="input min-h-[44px]" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="muted">종료</label>
            <input type="date" className="input min-h-[44px]" value={dateTo} onChange={e=>setDateTo(e.target.value)} />
          </div>
          <div className="col-span-2 sm:col-auto">
            <button
              className="btn secondary min-h-[44px] w-full sm:w-auto"
              onClick={()=>{ setDateFrom(toDateInputValue(startOfMonth(new Date()))); setDateTo(toDateInputValue(endOfMonth(new Date()))) }}
            >
              이번 달
            </button>
          </div>
        </div>
      </div>

      {/* 체크박스: 모바일 2열 그리드 */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:flex sm:flex-wrap">
          {([
            ['revenue','매출'],
            ['material_cost','자재비'],
            ['daily_wage','인건비'],
            ['extra_income','추가수익'],
            ['fixed_expense','고정지출'],
            ['extra_expense','추가지출'],
            ['extra_cost_half','기타비용(캘린더, 1/2 가산)'],
          ] as const).map(([key, label])=>(
            <label key={key} className="row items-center" style={{ gap:6 }}>
              <input
                type="checkbox"
                checked={(inc as any)[key]}
                onChange={e=>setInc(prev=>({ ...prev, [key]: e.target.checked }))}
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 그래프: 모바일 친화형(너비 자동, 툴팁/영역 채움) */}
      <div className="card" style={{ marginTop: 12 }}>
        <ResponsiveLineChart labels={labels} values={values} minV={minV} maxV={maxV} />
      </div>

      {/* 표 요약: 데스크탑 표 유지 / 모바일 카드 요약 */}
      <SummaryTable labels={labels} sFiltered={sFiltered} fFiltered={fFiltered} inc={inc} />
    </div>
  )
}

/* ================= 모바일 친화형 LineChart ================= */
function ResponsiveLineChart({
  labels, values, minV, maxV
}:{ labels:string[]; values:number[]; minV:number; maxV:number }) {
  const wrapRef = useRef<HTMLDivElement|null>(null)
  const [w, setW] = useState(360)

  // 컨테이너 너비 추적(모바일에서도 가득 차게)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new (window as any).ResizeObserver((entries:any[]) => {
      const width = entries[0]?.contentRect?.width ?? el.clientWidth
      setW(Math.max(320, Math.round(width)))
    })
    ro.observe(el)
    setW(Math.max(320, el.clientWidth))
    return () => ro.disconnect?.()
  }, [])

  const h = 260
  const pad = { l: 44, r: 12, t: 16, b: 40 }
  const innerW = Math.max(1, w - pad.l - pad.r)
  const innerH = h - pad.t - pad.b

  const spanBase = Math.max(1, maxV - minV)
  const yMin = minV - spanBase * 0.05
  const yMax = maxV + spanBase * 0.05
  const span = Math.max(1, yMax - yMin)

  const pts = values.map((v, i) => {
    const x = pad.l + (i * innerW) / Math.max(1, values.length - 1)
    const y = pad.t + innerH * (1 - (v - yMin) / span)
    return { x, y }
  })

  const d = (() => {
    if (pts.length === 0) return ''
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
    const t = 0.22
    const segs: (string|number)[] = ['M', pts[0].x, pts[0].y]
    for (let i=0;i<pts.length-1;i++){
      const p0 = pts[i], p1 = pts[i+1]; const dx = p1.x - p0.x
      segs.push('C', p0.x + dx*t, p0.y, p1.x - dx*t, p1.y, p1.x, p1.y)
    }
    return segs.join(' ')
  })()

  // 눈금(X라벨 최대 6개만)
  const xTicks = (() => {
    const count = Math.min(6, Math.max(2, Math.floor(innerW / 64)))
    const step = Math.max(1, Math.ceil(values.length / (count - 1)))
    const arr:number[] = []
    for (let i=0;i<values.length;i+=step) arr.push(i)
    if (arr[arr.length-1] !== values.length-1) arr.push(values.length-1)
    return arr
  })()

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => yMin + span*t)

  // 인터랙션(툴팁)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const onPointer = (clientX:number, target:SVGSVGElement) => {
    const box = target.getBoundingClientRect()
    const x = clientX - box.left - pad.l
    const ratio = Math.min(1, Math.max(0, x / innerW))
    const idx = Math.round(ratio * (values.length - 1))
    setHoverIdx(idx)
  }

  return (
    <div ref={wrapRef}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display:'block' }}>
        {/* 영역 채움 그라디언트 */}
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.25"/>
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0"/>
          </linearGradient>
        </defs>

        {/* Y 그리드 */}
        {yTicks.map((v, i) => {
          const y = pad.t + innerH * (1 - (v - yMin) / span)
          return <line key={i} x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#e5e7eb" />
        })}

        {/* X 축 */}
        <line x1={pad.l} y1={h - pad.b} x2={w - pad.r} y2={h - pad.b} stroke="#d1d5db" />

        {/* 영역 + 선 + 포인트 */}
        <path
          d={`${d} L ${w-pad.r} ${h-pad.b} L ${pad.l} ${h-pad.b} Z`}
          fill="url(#g1)"
          opacity={0.9}
        />
        <path d={d} fill="none" stroke="#0f172a" strokeWidth={2.2} />

        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2} fill="#0f172a" />
        ))}

        {/* X 라벨(최대 6개) */}
        {xTicks.map((i, k) => {
          const x = pad.l + (i * innerW) / Math.max(1, values.length - 1)
          return (
            <text key={k} x={x} y={h - pad.b + 14} fontSize="10" textAnchor="middle">
              {labels[i]}
            </text>
          )
        })}

        {/* 인터랙션 레이어 */}
        <rect
          x={pad.l} y={pad.t} width={innerW} height={innerH}
          fill="transparent"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={(e) => onPointer(e.clientX, e.currentTarget.ownerSVGElement!)}
          onTouchStart={(e) => onPointer(e.touches[0].clientX, e.currentTarget.ownerSVGElement!)}
          onTouchMove={(e) => onPointer(e.touches[0].clientX, e.currentTarget.ownerSVGElement!)}
        />
        {hoverIdx != null && (
          <>
            <line
              x1={pts[hoverIdx].x} y1={pad.t}
              x2={pts[hoverIdx].x} y2={h - pad.b}
              stroke="#94a3b8" strokeDasharray="4 4"
            />
            <circle cx={pts[hoverIdx].x} cy={pts[hoverIdx].y} r={4} fill="#0ea5e9" stroke="white" />
            {/* 툴팁 */}
            <g transform={`translate(${Math.min(pts[hoverIdx].x + 8, w - 130)}, ${pad.t + 8})`}>
              <rect width="122" height="38" rx="6" fill="white" stroke="#cbd5e1" />
              <text x={8} y={14} fontSize="11" fill="#334155">{labels[hoverIdx]}</text>
              <text x={8} y={28} fontSize="12" fontWeight="600" fill="#0f172a">
                {money(values[hoverIdx] || 0)}
              </text>
            </g>
          </>
        )}
      </svg>
    </div>
  )
}

/* ================= 리포트 요약(표/카드) ================= */
function SummaryTable({
  labels, sFiltered, fFiltered, inc
}:{
  labels:string[]
  sFiltered:ScheduleRow[]
  fFiltered:FinanceItem[]
  inc: { [k:string]: boolean }
}) {
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
    <>
      {/* 데스크탑 표 */}
      <div className="hidden sm:block card overflow-x-auto" style={{ marginTop: 12 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth: 520 }}>
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

      {/* 모바일 카드 요약 */}
      <div className="sm:hidden space-y-2 mt-3">
        {[
          ['매출', totals.revenue, inc.revenue, false],
          ['자재비', totals.material_cost, inc.material_cost, true],
          ['인건비', totals.daily_wage, inc.daily_wage, true],
          ['추가수익', totals.extra_income, inc.extra_income, false],
          ['고정지출', totals.fixed_expense, inc.fixed_expense, true],
          ['추가지출', totals.extra_expense, inc.extra_expense, true],
          ['기타비용(캘린더, 1/2 가산)', totals.extra_cost/2, inc.extra_cost_half, false],
        ].map(([name, val, on, neg], i)=>(
          <div key={i} className="rounded-xl border p-3 flex items-center justify-between">
            <div className="text-sm">{name as string}{!on && <span className="text-slate-400"> (제외)</span>}</div>
            <div className={`font-semibold ${neg ? 'text-rose-700' : ''}`}>{money((val as number) * ((neg as boolean)?-1:1))}</div>
          </div>
        ))}
        <div className="rounded-xl border p-3 flex items-center justify-between">
          <div className="font-semibold">순수익(체크 반영)</div>
          <div className="font-bold">{money(netTotal)}</div>
        </div>
      </div>
    </>
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

function sumBy(labels:string[], f:(key:string)=>number){ return labels.reduce((a,k)=>a+f(k),0) }
