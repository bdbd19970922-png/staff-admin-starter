'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import AuthBar from '@/components/AuthBar'
import { supabase } from '@/lib/supabaseClient'

type Material = {
  id: string
  display_name: string
  vendor: string | null
  unit_price: number
}

export default function MaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data, error } = await supabase
        .from('materials')
        .select('id, name, item, vendor, unit_price')
        .order('created_at', { ascending: false })

      if (!mounted) return
      if (error) {
        setMsg(error.message)
      } else {
        const list = (data ?? []).map((r: any) => ({
          id: String(r.id),
          display_name: (r.name ?? r.item ?? '') as string,
          vendor: (r.vendor ?? null) as string | null,
          unit_price: Number(r.unit_price ?? 0),
        }))
        setMaterials(list)
      }
      setLoading(false)
    })()
    return () => { mounted = false }
  }, [])

  const selected = materials.find(m => m.id === selectedId)

  return (
    <div className="min-h-screen flex flex-col">
      

      <main className="flex-1 p-4 space-y-4">
        {/* 제목: 스카이 → 인디고 그라데이션 */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">
            <span className="title-gradient">자재</span>
          </h1>
          <div className="flex gap-2">
            <Link href="/materials/entries" className="btn">
              사용/정산
            </Link>
            <Link href="/materials/new" className="btn btn-primary">
              신규 자재 등록
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="card p-4 text-sm text-gray-600">불러오는 중...</div>
        ) : (
          <div className="space-y-4">
            {msg && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                {msg}
              </div>
            )}

            <div className="card p-4">
              <div className="mb-2 text-sm font-medium">자재 선택 (드롭다운)</div>
              <select
                className="select"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                <option value="">자재를 선택하세요</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name || '(이름 없음)'}
                    {m.vendor ? ` — ${m.vendor}` : ''} {`(₩${m.unit_price.toLocaleString()})`}
                  </option>
                ))}
              </select>

              {selected && (
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">자재 이름</label>
                    <input className="input" value={selected.display_name} readOnly />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">거래처</label>
                    <input className="input" value={selected.vendor ?? ''} readOnly />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">단가</label>
                    <input
                      className="input"
                      value={`₩${selected.unit_price.toLocaleString()}`}
                      readOnly
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
