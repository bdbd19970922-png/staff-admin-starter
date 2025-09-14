'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AuthBar from '@/components/AuthBar'
import { supabase } from '@/lib/supabaseClient'

export default function NewMaterialPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [vendor, setVendor] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [dateStr, setDateStr] = useState<string>(() => new Date().toISOString().slice(0, 10)) // ✅ 날짜 입력
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const save = async () => {
    setMsg(null)

    const priceNum = Number(String(unitPrice).replace(/[,\s]/g, ''))
    if (!name.trim() || !Number.isFinite(priceNum) || priceNum < 0) {
      setMsg('자재이름(필수), 단가(숫자)를 확인해주세요.')
      return
    }
    if (!dateStr) {
      setMsg('날짜를 입력하세요.')
      return
    }

    setLoading(true)
    try {
      const { data: u } = await supabase.auth.getUser()
      const uid = u?.user?.id ?? null

      // 수량 기본 1, 합계 = 단가 * 수량
      const qty = 1
      const unit = Math.round(priceNum) // materials.unit_price가 integer라 반올림 저장
      const total = unit * qty

      // id가 uuid이고 기본값이 없을 수 있어, 클라이언트에서 생성
      const makeUuid = () =>
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? (crypto as any).randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`

      const payload: any = {
        id: makeUuid(),
        date: dateStr,             // ✅ 사용자가 고른 날짜로 저장
        item: name.trim(),         // 스키마의 NOT NULL 컬럼
        quantity: qty,             // 기본 1
        unit_price: unit,          // integer
        total_amount: total,       // integer
        vendor: vendor.trim() || null,
        name: name.trim(),         // 보조 표시용 컬럼이 있으면 같이 채움
        created_by: uid ?? null,
      }

      const { error } = await supabase.from('materials').insert(payload)
      if (error) throw error

      router.push('/materials')
    } catch (e: any) {
      setMsg(e.message ?? '등록 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  function getTodayLocalYYYYMMDD() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const isToday = dateStr && dateStr === getTodayLocalYYYYMMDD()

  return (
    <div className="min-h-screen flex flex-col">
      <AuthBar />

      <main className="max-w-2xl w-full mx-auto p-4 space-y-4">
        {/* 제목: 스카이 → 인디고 그라데이션 */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">
            <span className="title-gradient">신규 자재 등록</span>
          </h1>
          <Link href="/materials" className="btn">
            자재 목록으로
          </Link>
        </div>

        <div className="card p-4 space-y-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <label className="text-sm text-gray-600">날짜</label>
              {isToday ? <span className="badge-today">오늘</span> : null}
            </div>
            <input
              type="date"
              className="input"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-600">자재 이름</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예) 12mm 합판"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-600">거래처</label>
            <input
              className="input"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="예) ○○자재상사"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-600">단가</label>
            <input
              className="input"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="예) 12000"
              inputMode="numeric"
            />
            <p className="mt-1 text-xs text-gray-500">숫자만 입력 (원)</p>
          </div>

          <button
            onClick={save}
            disabled={loading}
            className="w-full mt-2 btn btn-primary"
          >
            {loading ? '등록 중...' : '등록 완료'}
          </button>

          {msg && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {msg}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
