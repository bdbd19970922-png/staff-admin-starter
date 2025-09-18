// FILE: app/materials/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import AuthBar from '@/components/AuthBar';

type MaterialPub = {
  id: string;
  name: string;
  vendor: string | null;
  unit_price_visible: number | null; // 관리자면 숫자, 아니면 null
};

type Location = { id: string; name: string };

type StockRow = {
  material_id: string;
  material_name: string;
  vendor: string | null;
  unit_price: number | null;        // 관리자만 read 되는 원본(뷰 아님)
  location_id: string;
  location_name: string;
  stock_qty: number;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
};

export default function MaterialsPage() {
  const [tab, setTab] = useState<'register' | 'inbound' | 'stock' | 'settings'>('register');

  // 자재 등록 폼
  const [matName, setMatName] = useState('');
  const [matVendor, setMatVendor] = useState('');
  const [matPrice, setMatPrice] = useState<number | ''>('');

  // 선택 드롭다운용 마스터
  const [materials, setMaterials] = useState<MaterialPub[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // 입고 폼
  const [inMatId, setInMatId] = useState<string>('');
  const [inLocId, setInLocId] = useState<string>('');
  const [inQty, setInQty] = useState<number | ''>('');
  const [inDate, setInDate] = useState<string>('');

  // 재고
  const [stock, setStock] = useState<StockRow[]>([]);

  // 상태 표시
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 설정: 지역 추가
  const [newLoc, setNewLoc] = useState('');

  // 최초 로드
  useEffect(() => {
    (async () => {
      await loadBase();
      await loadStock();
    })();
  }, []);

  // 자재/지역 목록 로드
  async function loadBase() {
    setLoading(true);
    setMsg(null);
    try {
      const { data: mats, error: e1 } = await supabase
        .from('materials_public')
        .select('id,name,vendor,unit_price_visible')
        .order('name', { ascending: true })
        .returns<MaterialPub[]>();
      if (e1) throw e1;
      setMaterials(mats || []);

      const { data: locs, error: e2 } = await supabase
        .from('material_locations')
        .select('id,name')
        .order('name', { ascending: true })
        .returns<Location[]>();
      if (e2) throw e2;
      setLocations(locs || []);
    } catch (e: any) {
      setMsg(`기본 데이터 로드 실패: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  // 재고 뷰 로드
  async function loadStock() {
    setLoading(true);
    setMsg(null);
    try {
      const { data, error } = await supabase
        .from('material_stock_view')
        .select('material_id,material_name,vendor,unit_price,location_id,location_name,stock_qty,last_inbound_at,last_outbound_at')
        .order('material_name', { ascending: true })
        .order('location_name', { ascending: true })
        .returns<StockRow[]>();
      if (error) throw error;
      setStock(data || []);
    } catch (e: any) {
      setMsg(`재고 로드 실패: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  // ========== 자재 등록 ==========
  async function onCreateMaterial() {
    setMsg(null);
    if (!matName || matPrice === '' || Number(matPrice) < 0) {
      setMsg('자재이름과 금액을 확인해줘.');
      return;
    }
    const { error } = await supabase.from('materials').insert({
      name: matName.trim(),
      vendor: matVendor.trim() || null,
      unit_price: Number(matPrice),
    });
    if (error) {
      setMsg(`자재 등록 실패: ${error.message}`);
      return;
    }
    setMatName(''); setMatVendor(''); setMatPrice('');
    await loadBase();
    setMsg('자재 등록 완료');
  }

  // ========== 입고(+ 재고 증가) ==========
  async function onInbound() {
    setMsg(null);
    if (!inMatId || !inLocId || inQty === '' || Number(inQty) <= 0) {
      setMsg('자재/지역/수량을 확인해줘.');
      return;
    }
    const payload = {
      material_id: inMatId,
      location_id: inLocId,
      qty: Number(inQty),
      received_date: inDate || new Date().toISOString().slice(0, 10),
    };
    const { error } = await supabase.from('material_receipts').insert(payload);
    if (error) { setMsg(`입고 실패: ${error.message}`); return; }
    setInMatId(''); setInLocId(''); setInQty(''); setInDate('');
    await loadStock();
    setMsg('입고 반영 완료 (+재고)');
  }

  // ========== 지역 추가 ==========
  async function onAddLocation() {
    setMsg(null);
    if (!newLoc.trim()) { setMsg('지역명을 입력해줘.'); return; }
    const { error } = await supabase.from('material_locations').insert({ name: newLoc.trim() });
    if (error) { setMsg(`지역 추가 실패: ${error.message}`); return; }
    setNewLoc('');
    await loadBase();
    await loadStock();
    setMsg('지역 추가 완료');
  }

  // 재고 피벗(행=자재, 열=지역)
  const pivot = useMemo(() => {
    const locMap = new Map(locations.map(l => [l.id, l.name]));
    const byMat = new Map<string, { material_name: string; vendor: string | null; unit_price: number | null; stocks: Record<string, number> }>();
    for (const r of stock) {
      const row = byMat.get(r.material_id) || {
        material_name: r.material_name,
        vendor: r.vendor,
        unit_price: r.unit_price,
        stocks: {},
      };
      row.stocks[r.location_id] = Number(r.stock_qty || 0);
      byMat.set(r.material_id, row);
    }
    return { byMat, locMap };
  }, [stock, locations]);

  return (
    <div className="space-y-6">
      {/* 상단 바(로그인/프로필) */}
      <AuthBar />

      {/* 페이지 헤더 - 캘린더와 동일한 톤 */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-sky-700 via-sky-600 to-indigo-600 bg-clip-text text-transparent">
            자재
          </span>{' '}
          <span className="text-slate-600">관리</span>
        </h1>
        <p className="text-slate-600 text-sm mt-1">
          자재를 등록하고 지역별 재고를 관리하세요. 입고는 재고에 <b>+</b>로 반영됩니다.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTab('register')} className={`btn ${tab==='register' ? 'btn-primary' : ''}`}>자재등록</button>
        <button onClick={() => setTab('inbound')}  className={`btn ${tab==='inbound'  ? 'btn-primary' : ''}`}>입고</button>
        <button onClick={() => setTab('stock')}    className={`btn ${tab==='stock'    ? 'btn-primary' : ''}`}>지역별 재고현황</button>
        <button onClick={() => setTab('settings')} className={`btn ${tab==='settings' ? 'btn-primary' : ''}`}>지역 관리(+추가)</button>
      </div>

      {msg && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {msg}
        </div>
      )}
      {loading && <div className="p-3 text-sm text-slate-600">불러오는 중…</div>}

      {/* 탭 내용 */}
      {tab === 'register' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 등록 카드 */}
          <form
            onSubmit={(e)=>{e.preventDefault(); onCreateMaterial();}}
            className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white shadow-[0_6px_16px_rgba(2,132,199,0.08)] p-5 space-y-3"
          >
            <div className="text-lg font-bold text-sky-800">자재등록</div>
            <label className="block">
              <div className="text-sm text-slate-600 mb-1">자재 이름</div>
              <input className="input" value={matName} onChange={e=>setMatName(e.target.value)} placeholder="예: 실리콘(백색)" />
            </label>
            <label className="block">
              <div className="text-sm text-slate-600 mb-1">거래처</div>
              <input className="input" value={matVendor} onChange={e=>setMatVendor(e.target.value)} placeholder="예: ○○자재상" />
            </label>
            <label className="block">
              <div className="text-sm text-slate-600 mb-1">금액(단가, 원)</div>
              <input
                type="number"
                inputMode="numeric"
                className="input"
                value={matPrice}
                onChange={e=>setMatPrice(e.target.value===''? '' : Number(e.target.value))}
                placeholder="예: 3500"
              />
              <p className="text-xs text-gray-500 mt-1">⚠️ 단가는 관리자만 조회 가능(비관리자는 마스킹).</p>
            </label>
            <div className="flex justify-end">
              <button className="btn-primary">등록</button>
            </div>
          </form>

          {/* 등록된 자재 목록 카드 */}
          <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white shadow-[0_6px_16px_rgba(2,132,199,0.08)] p-5">
            <div className="text-lg font-bold text-sky-800 mb-3">등록된 자재</div>
            <div className="overflow-x-auto -mx-2 md:mx-0">
              <table className="min-w-[640px] md:min-w-0 w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">이름</th>
                    <th className="text-left p-2">거래처</th>
                    <th className="text-right p-2">단가(관리자만)</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map(m => (
                    <tr key={m.id} className="border-b">
                      <td className="p-2">{m.name}</td>
                      <td className="p-2">{m.vendor || '-'}</td>
                      <td className="p-2 text-right">{m.unit_price_visible ?? '—'}</td>
                    </tr>
                  ))}
                  {materials.length === 0 && (
                    <tr><td className="p-3 text-gray-500" colSpan={3}>아직 등록된 자재가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'inbound' && (
        <form
          onSubmit={(e)=>{e.preventDefault(); onInbound();}}
          className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white shadow-[0_6px_16px_rgba(2,132,199,0.08)] p-5 space-y-3"
        >
          <div className="text-lg font-bold text-sky-800">입고</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <div className="text-sm text-slate-600 mb-1">자재</div>
              <select className="select" value={inMatId} onChange={e=>setInMatId(e.target.value)}>
                <option value="">선택</option>
                {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="text-sm text-slate-600 mb-1">지역</div>
              <select className="select" value={inLocId} onChange={e=>setInLocId(e.target.value)}>
                <option value="">선택</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="text-sm text-slate-600 mb-1">수량(+)</div>
              <input
                type="number"
                inputMode="numeric"
                className="input"
                value={inQty}
                onChange={e=>setInQty(e.target.value===''? '' : Number(e.target.value))}
                placeholder="예: 10"
              />
            </label>
            <label className="block">
              <div className="text-sm text-slate-600 mb-1">날짜</div>
              <input type="date" className="input" value={inDate} onChange={e=>setInDate(e.target.value)} />
            </label>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary">입고 반영</button>
          </div>
          <p className="text-xs text-gray-500 mt-2">💡 입고는 재고에 <b>+</b>로 반영됩니다.</p>
        </form>
      )}

      {tab === 'stock' && (
        <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white shadow-[0_6px_16px_rgba(2,132,199,0.08)] p-5">
          <div className="text-lg font-bold text-sky-800 mb-2">지역별 재고현황</div>
          <div className="overflow-x-auto -mx-2 md:mx-0">
            <table className="min-w-[720px] md:min-w-0 w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">자재</th>
                  <th className="text-left p-2">거래처</th>
                  {locations.map(l => <th key={l.id} className="text-right p-2">{l.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {Array.from(pivot.byMat.entries()).map(([matId, row]) => (
                  <tr key={matId} className="border-b">
                    <td className="p-2">{row.material_name}</td>
                    <td className="p-2">{row.vendor || '-'}</td>
                    {locations.map(l => (
                      <td key={l.id} className="p-2 text-right">{row.stocks[l.id] ?? 0}</td>
                    ))}
                  </tr>
                ))}
                {pivot.byMat.size === 0 && (
                  <tr><td className="p-3 text-gray-500" colSpan={2 + locations.length}>데이터가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white shadow-[0_6px_16px_rgba(2,132,199,0.08)] p-5 space-y-3">
          <div className="text-lg font-bold text-sky-800">지역 관리</div>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="예: 부산" value={newLoc} onChange={e=>setNewLoc(e.target.value)} />
            <button onClick={onAddLocation} className="btn-primary">+ 추가</button>
          </div>
          <ul className="list-disc pl-5 text-sm">
            {locations.map(l => <li key={l.id}>{l.name}</li>)}
          </ul>
          <p className="text-xs text-gray-500">추가된 지역은 재고현황 표에 열로 나타납니다.</p>
        </div>
      )}
    </div>
  );
}
