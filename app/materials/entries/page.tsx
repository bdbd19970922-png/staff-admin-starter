'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AuthBar from '@/components/AuthBar'
import { supabase } from '@/lib/supabaseClient'

type Material = {
  id: string
  name: string
  vendor: string | null
  unit_price: number
}

type EntryRow = {
  material_id: string
  vendor: string
  unit_price: string
  qty: string
  date: string
}

type SavedEntry = {
  id: number
  vendor: string
  unit_price: number
  qty: number
  total: number | null
  entry_date: string
  material_id: string
}

export default function MaterialEntriesPage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [rows, setRows] = useState<EntryRow[]>([])
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [recent, setRecent] = useState<SavedEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const [mats, rec] = await Promise.all([
        supabase.from('materials')
          .select('id, name, item, vendor, unit_price')
          .order('created_at', { ascending: false }),
        supabase.from('material_entries')
          .select('id, vendor, unit_price, qty, total, entry_date, material_id')
          .order('created_at', { ascending: false })
          .limit(200),
      ])
      if (!mounted) return

      if (mats.error) setMsg(mats.error.message)
      else {
        const list = (mats.data ?? []).map((r: any) => ({
          id: String(r.id),
          name: (r.name ?? r.item ?? '') as string,
          vendor: (r.vendor ?? null) as string | null,
          unit_price: Number(r.unit_price ?? 0),
        }))
        setMaterials(list)
        const today = new Date().toISOString().slice(0, 10)
        setRows([
          list.length
            ? { material_id: list[0].id, vendor: list[0].vendor ?? '', unit_price: String(list[0].unit_price), qty: '1', date: today }
            : { material_id: '', vendor: '', unit_price: '', qty: '1', date: today }
        ])
      }

      if (rec.error) setMsg(prev => prev ?? rec.error?.message ?? null)
      else setRecent((rec.data ?? []).map((r: any) => ({ ...r, material_id: String(r.material_id) })))

      setLoading(false)
    })()
    return () => { mounted = false }
  }, [])

  const rowTotal = (r: EntryRow) => {
    const price = Number(String(r.unit_price).replace(/[,\s]/g, ''))
    const qty = Number(String(r.qty).replace(/[,\s]/g, ''))
    if (!Number.isFinite(price) || !Number.isFinite(qty)) return 0
    return price * qty
  }

  const grandTotal = useMemo(() => rows.reduce((s, r) => s + rowTotal(r), 0), [rows])

  const vendorSummary = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of recent) {
      const subtotal = r.total ?? (Number(r.unit_price) * Number(r.qty))
      map.set(r.vendor, (map.get(r.vendor) ?? 0) + (Number(subtotal) || 0))
    }
    const arr = Array.from(map.entries())
    const max = Math.max(1, ...arr.map(([, v]) => v))
    return { arr: arr.sort((a, b) => b[1] - a[1]), max }
  }, [recent])

  const addRow = () => {
    const today = new Date().toISOString().slice(0, 10)
    if (materials.length > 0) {
      const m = materials[0]
      setRows(prev => [...prev, { material_id: m.id, vendor: m.vendor ?? '', unit_price: String(m.unit_price), qty: '1', date: today }])
    } else {
      setRows(prev => [...prev, { material_id: '', vendor: '', unit_price: '', qty: '1', date: today }])
    }
  }
  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx))
  const changeMaterial = (idx: number, material_id: string) => {
    setRows(prev => {
      const copy = [...prev]
      const row = { ...copy[idx] }
      row.material_id = material_id
      const m = materials.find(mm => mm.id === material_id)
      if (m) {
        row.vendor = m.vendor ?? ''
        row.unit_price = String(m.unit_price)
      }
      copy[idx] = row
      return copy
    })
  }
  const changeField = (idx: number, key: 'vendor' | 'unit_price' | 'qty' | 'date', value: string) => {
    setRows(prev => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], [key]: value }
      return copy
    })
  }

  const saveAll = async () => {
    setMsg(null)
    if (rows.length === 0) return setMsg('추가된 행이 없습니다.')

    const payload: any[] = []
    for (const r of rows) {
      const price = Number(String(r.unit_price).replace(/[,\s]/g, ''))
      const qty = Number(String(r.qty).replace(/[,\s]/g, ''))
      if (!r.material_id || !r.date || !Number.isFinite(price) || price < 0 || !Number.isFinite(qty) || qty <= 0) {
        setMsg('자재/날짜/단가/수량을 확인하세요.')
        return
      }
      payload.push({
        material_id: r.material_id,
        vendor: r.vendor?.trim() || '',
        unit_price: price,
        qty,
        entry_date: r.date,
      })
    }

    try {
      setSaving(true)
      const { data: u } = await supabase.auth.getUser()
      const uid = u?.user?.id ?? null
      const withCreator = payload.map(p => ({ ...p, created_by: uid }))

      const { error } = await supabase.from('material_entries').insert(withCreator)
      if (error) throw error

      const rec = await supabase
        .from('material_entries')
        .select('id, vendor, unit_price, qty, total, entry_date, material_id')
        .order('created_at', { ascending: false })
        .limit(200)
      if (!rec.error && rec.data) setRecent((rec.data as any).map((r: any) => ({ ...r, material_id: String(r.material_id) })))
      setMsg('저장 완료!')
    } catch (e: any) {
      setMsg(e.message ?? '저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const deleteEntry = async (id: number) => {
    if (!confirm('이 항목을 삭제하시겠어요?')) return
    setMsg(null)
    setDeletingId(id)
    try {
      const { error } = await supabase.from('material_entries').delete().eq('id', id)
      if (error) throw error
      setRecent(prev => prev.filter(r => r.id !== id))
      setMsg('삭제 완료!')
    } catch (e: any) {
      setMsg(e.message ?? '삭제 중 오류가 발생했습니다.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="min-h-screen">
      <AuthBar />

      <header className="sticky top-0 z-10 bg-white/70 backdrop-blur border-b">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">
            <span className="title-gradient">자재 사용/정산</span>
          </h1>
          <div className="flex gap-2">
            <Link href="/materials" className="btn">자재 목록</Link>
            <Link href="/materials/new" className="btn btn-primary">신규 자재 등록</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {loading ? (
          <div className="card p-6 text-sm text-gray-600">불러오는 중…</div>
        ) : (
          <>
            {msg && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                {msg}
              </div>
            )}

            {/* 입력 카드 */}
            <section className="card p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">입력</div>
                <div className="text-sm">
                  총 합계: <span className="font-bold">₩{grandTotal.toLocaleString()}</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed border border-sky-100">
                  <colgroup>
                    <col className="w-[220px]" />
                    <col className="w-[180px]" />
                    <col className="w-[160px]" />
                    <col className="w-[140px]" />
                    <col className="w-[110px]" />
                    <col className="w-[140px]" />
                    <col className="w-[90px]" />
                  </colgroup>
                  <thead className="bg-sky-50">
                    <tr>
                      <th className="border border-sky-100 text-left p-2 whitespace-nowrap">자재</th>
                      <th className="border border-sky-100 text-left p-2 whitespace-nowrap">거래처</th>
                      <th className="border border-sky-100 text-left p-2 whitespace-nowrap">날짜</th>
                      <th className="border border-sky-100 text-right p-2 whitespace-nowrap">금액(단가)</th>
                      <th className="border border-sky-100 text-right p-2 whitespace-nowrap">수량</th>
                      <th className="border border-sky-100 text-right p-2 whitespace-nowrap">합계</th>
                      <th className="border border-sky-100 p-2 text-center whitespace-nowrap">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const t = rowTotal(r)
                      return (
                        <tr key={i} className="border-b border-sky-100">
                          <td className="p-2">
                            <select
                              className="select"
                              value={r.material_id}
                              onChange={(e) => changeMaterial(i, e.target.value)}
                            >
                              {materials.length === 0 && <option value="">등록된 자재 없음</option>}
                              {materials.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              className="input"
                              value={r.vendor}
                              onChange={(e) => changeField(i, 'vendor', e.target.value)}
                              placeholder="거래처"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="date"
                              className="input"
                              value={r.date}
                              onChange={(e) => changeField(i, 'date', e.target.value)}
                            />
                          </td>
                          <td className="p-2">
                            <input
                              className="input text-right"
                              value={r.unit_price}
                              onChange={(e) => changeField(i, 'unit_price', e.target.value)}
                              placeholder="예) 12000"
                              inputMode="numeric"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              className="input text-right"
                              value={r.qty}
                              onChange={(e) => changeField(i, 'qty', e.target.value)}
                              placeholder="예) 2"
                              inputMode="numeric"
                            />
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">₩{t.toLocaleString()}</td>
                          <td className="p-2 text-center">
                            <button
                              className="btn py-1"
                              onClick={() => removeRow(i)}
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button onClick={addRow} className="btn">행 추가</button>
                <button
                  onClick={saveAll}
                  disabled={saving || rows.length === 0}
                  className="btn btn-primary disabled:opacity-50"
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </section>

            {/* 거래처별 합계 */}
            <section className="card p-6">
              <div className="text-sm font-semibold mb-3">거래처별 합계 (최근 200건 기준)</div>
              {vendorSummary.arr.length === 0 ? (
                <div className="text-sm text-gray-600">데이터가 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {vendorSummary.arr.map(([vendor, sum]) => (
                    <div key={vendor} className="flex items-center gap-3">
                      <div className="w-40 text-sm text-gray-700 truncate">{vendor || '(거래처 없음)'}</div>
                      <div className="flex-1 h-2 rounded-full bg-sky-100 overflow-hidden">
                        <div
                          className="h-full bg-sky-500"
                          style={{ width: `${Math.round((Number(sum) / vendorSummary.max) * 100)}%` }}
                        />
                      </div>
                      <div className="w-32 text-right text-sm font-medium whitespace-nowrap">
                        ₩{Number(sum).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 최근 입력 */}
            <section className="card p-6">
              <div className="text-sm font-semibold mb-3">최근 입력</div>
              {recent.length === 0 ? (
                <div className="text-sm text-gray-600">최근 입력이 없습니다.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm table-fixed border border-sky-100">
                    <colgroup>
                      <col className="w-[140px]" />
                      <col className="w-[180px]" />
                      <col className="w-[140px]" />
                      <col className="w-[100px]" />
                      <col className="w-[140px]" />
                      <col className="w-[110px]" />
                    </colgroup>
                    <thead className="bg-sky-50">
                      <tr>
                        <th className="border border-sky-100 text-left p-2 whitespace-nowrap">날짜</th>
                        <th className="border border-sky-100 text-left p-2 whitespace-nowrap">거래처</th>
                        <th className="border border-sky-100 text-right p-2 whitespace-nowrap">단가</th>
                        <th className="border border-sky-100 text-right p-2 whitespace-nowrap">수량</th>
                        <th className="border border-sky-100 text-right p-2 whitespace-nowrap">합계</th>
                        <th className="border border-sky-100 p-2 text-center whitespace-nowrap">삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map(r => (
                        <tr key={r.id} className="border-b border-sky-100">
                          <td className="p-2 whitespace-nowrap">{r.entry_date}</td>
                          <td className="p-2 truncate">{r.vendor}</td>
                          <td className="p-2 text-right whitespace-nowrap">₩{Number(r.unit_price).toLocaleString()}</td>
                          <td className="p-2 text-right whitespace-nowrap">{Number(r.qty).toLocaleString()}</td>
                          <td className="p-2 text-right whitespace-nowrap">
                            ₩{Number((r.total ?? r.unit_price * r.qty)).toLocaleString()}
                          </td>
                          <td className="p-2 text-center">
                            <button
                              onClick={() => deleteEntry(r.id)}
                              disabled={deletingId === r.id}
                              className="btn py-1 disabled:opacity-50"
                              title="이 항목 삭제"
                            >
                              {deletingId === r.id ? '삭제중…' : '삭제'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
