'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/** =================================================================================
 *  🔐 Access Gate: 관리자/매니저만 진입 허용 (직원은 차단)
 * ================================================================================= */
export default function MaterialsPage() {
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id ?? '';
        const email = (session?.user?.email ?? '').toLowerCase();

        // 환경변수 기반 허용(운영 편의)
        const adminIds = (process.env.NEXT_PUBLIC_ADMIN_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        let envAdmin = (!!uid && adminIds.includes(uid)) || (!!email && adminEmails.includes(email));

        let dbAdmin = false;
        let dbManager = false;

        if (uid) {
          const { data: me } = await supabase
            .from('profiles')
            .select('is_admin, is_manager')
            .eq('id', uid)
            .maybeSingle();

        dbAdmin = !!me?.is_admin;
        dbManager = !!me?.is_manager;
        }

        setIsAdmin(envAdmin || dbAdmin);
        setIsManager(dbManager);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready) {
    return (
      <div className="rounded-xl border p-4 text-sm text-slate-600">
        권한 확인 중…
      </div>
    );
  }

  // ✅ 관리자 또는 매니저만 통과 (직원은 차단)
  if (!(isAdmin || isManager)) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
        <div className="text-lg font-bold text-rose-700 mb-1">접근 권한이 없습니다</div>
        <p className="text-sm text-rose-800">
          이 페이지는 관리자/매니저만 사용할 수 있습니다.
        </p>
      </div>
    );
  }

  return <MaterialsInner />;
}

/** ===== 타입 ===== */
type MaterialPub = {
  id: string;
  name: string;
  vendor: string | null;
  unit_price_visible: number | null;
};

type Material = {
  id: string;
  name: string;
  vendor: string | null;
  unit_price: number | null;
};

type Location = { id: string; name: string };

type StockRow = {
  material_id: string;
  material_name: string;
  vendor: string | null;
  unit_price: number | null;
  location_id: string;
  location_name: string;
  stock_qty: number;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
};

type Movement = {
  kind: '입고' | '사용';
  date: string;
  qtySigned: number;
  qty: number;
  created_at: string | null;
  schedule_id?: number | null;
  title?: string | null;
  customer_name?: string | null;
  employee_label?: string | null;
};

/** =================================================================================
 *  📦 기존 자재 페이지 본문 (변경 최소화)
 * ================================================================================= */
function MaterialsInner() {
  const [tab, setTab] = useState<'register' | 'inbound' | 'stock' | 'settings'>('register');

  // 등록 폼
  const [matName, setMatName] = useState('');
  const [matVendor, setMatVendor] = useState('');
  const [matPrice, setMatPrice] = useState<number | ''>('');

  // 입고 폼
  const [inMatId, setInMatId] = useState<string>('');
  const [inLocId, setInLocId] = useState<string>('');
  const [inQty, setInQty] = useState<number | ''>('');
  const [inDate, setInDate] = useState<string>('');

  // 마스터 목록
  const [materialsPub, setMaterialsPub] = useState<MaterialPub[]>([]);
  const [materialsFull, setMaterialsFull] = useState<Material[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // 재고 뷰
  const [stock, setStock] = useState<StockRow[]>([]);

  // 상태
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 지역 관리
  const [newLoc, setNewLoc] = useState('');

  // 상세 모달
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTitle, setDetailTitle] = useState<{ matName: string; locName: string } | null>(null);
  const [detailMoves, setDetailMoves] = useState<Movement[]>([]);

  // 자재 수정/삭제용 상태
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editVendor, setEditVendor] = useState<string | ''>('');
  const [editPrice, setEditPrice] = useState<number | ''>('');

  /** ===== 모바일 전용 상태 ===== */
  const [regSearch, setRegSearch] = useState('');               // 등록된 자재 검색
  const [mobileStockLoc, setMobileStockLoc] = useState<'ALL' | string>('ALL'); // 재고 지역 선택
  const [stockSearch, setStockSearch] = useState('');           // 재고 자재 검색

  /** ===== 최초 로드 ===== */
  useEffect(() => {
    (async () => {
      await loadBase();
      await loadStock();
    })();
  }, []);

  /** ===== 기본 마스터 로드 ===== */
  async function loadBase() {
    setMsg(null);
    setLoading(true);
    try {
      const [{ data: matsPub, error: e1 }, { data: matsFull, error: e2 }, { data: locs, error: e3 }] =
        await Promise.all([
          supabase
            .from('materials_public')
            .select('id,name,vendor,unit_price_visible')
            .order('name', { ascending: true })
            .returns<MaterialPub[]>(),
          supabase
            .from('materials')
            .select('id,name,vendor,unit_price')
            .eq('deleted', false)                 // 🔹 소프트 삭제 필터 추가
            .order('name', { ascending: true })
            .returns<Material[]>(),
          supabase
            .from('material_locations')
            .select('id,name')
            .order('name', { ascending: true })
            .returns<Location[]>(),
        ]);

      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;

      setMaterialsPub(matsPub ?? []);
      setMaterialsFull(matsFull ?? []);
      setLocations(locs ?? []);
      if ((locs?.length ?? 0) > 0) setMobileStockLoc('ALL');
    } catch (e: any) {
      setMsg(`기본 데이터 로드 실패: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  /** ===== 재고 뷰 로드 ===== */
  async function loadStock() {
    setMsg(null);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('material_stock_view')
        .select('material_id,material_name,vendor,unit_price,location_id,location_name,stock_qty,last_inbound_at,last_outbound_at')
        .order('material_name', { ascending: true })
        .order('location_name', { ascending: true })
        .returns<StockRow[]>();
      if (error) throw error;
      setStock(data ?? []);
    } catch (e: any) {
      setMsg(`재고 로드 실패: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  /** ===== 자재 등록 ===== */
  async function onCreateMaterial() {
    setMsg(null);

    const name = (matName ?? '').trim();
    const vendor = (matVendor ?? '').trim();
    const priceNum = Number(matPrice);

    if (!name || matPrice === '' || Number.isNaN(priceNum) || priceNum < 0) {
      setMsg('자재 이름과 단가를 확인해줘.');
      return;
    }

    // 화면엔 없지만 DB가 요구하는 필드 자동 채움
    const quantity = 1;
    const date = new Date().toISOString().slice(0, 10);
    const total_amount = quantity * priceNum;

    const payload = {
      item: name,
      name,
      vendor: vendor || null,
      unit_price: priceNum,
      quantity,
      date,
      total_amount,
    };

    const { error } = await supabase.from('materials').insert([payload]);

    if (error) {
      setMsg(`자재 등록 실패: ${error.code ? error.code + ' - ' : ''}${error.message}`);
      console.error('onCreateMaterial error:', error);
      return;
    }

    setMatName('');
    setMatVendor('');
    setMatPrice('');
    await loadBase();
    setMsg('자재 등록 완료');
  }

  /** ===== 자재 수정/삭제 ===== */
  function startEdit(id: string) {
    const m = materialsFull.find(x => x.id === id);
    if (!m) return;
    setEditId(id);
    setEditName(m.name || '');
    setEditVendor(m.vendor || '');
    setEditPrice(m.unit_price ?? '');
  }
  async function saveEdit() {
    if (!editId) return;
    if (!editName.trim() || editPrice === '' || Number(editPrice) < 0) {
      setMsg('자재 이름/단가를 확인해줘.');
      return;
    }
    const { error } = await supabase
      .from('materials')
      .update({
        name: editName.trim(),
        vendor: (editVendor || '').trim() || null,
        unit_price: Number(editPrice),
      })
      .eq('id', editId);
    if (error) { setMsg(`수정 실패: ${error.message}`); return; }
    setEditId(null);
    await loadBase();
    setMsg('수정 완료');
  }
  async function deleteMaterial(id: string) {
    if (!confirm('이 자재를 숨길까요? (연결된 입고/사용 기록은 보존됩니다)')) return;
    // 🔹 하드 삭제 → 소프트 삭제로 변경
    const { error } = await supabase
      .from('materials')
      .update({ deleted: true })
      .eq('id', id);
    if (error) { setMsg(`삭제 실패: ${error.message}`); return; }
    await loadBase();
    await loadStock();
    setMsg('삭제(숨김) 완료');
  }

  /** ===== 재고 입고 ===== */
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

  /** ===== 지역 추가 ===== */
  async function onAddLocation() {
    const name = (newLoc ?? '').trim();
    if (!name) {
      setMsg('지역 이름을 입력해줘.');
      return;
    }
    setMsg(null);
    setLoading(true);
    try {
      // 중복 체크(대소문자 무시)
      const { data: existed, error: qErr } = await supabase
        .from('material_locations')
        .select('id,name')
        .ilike('name', name)
        .limit(1);
      if (qErr) throw qErr;
      if (existed && existed.length > 0) {
        setMsg('이미 존재하는 지역입니다.');
        return;
      }

      // 추가
      const { error: insErr } = await supabase
        .from('material_locations')
        .insert([{ name }]);
      if (insErr) throw insErr;

      // 목록 새로고침 & 입력값 초기화
      const { data: locs, error: e3 } = await supabase
        .from('material_locations')
        .select('id,name')
        .order('name', { ascending: true });
      if (e3) throw e3;

      setLocations(locs ?? []);
      setNewLoc('');
      setMsg('지역이 추가되었습니다.');
    } catch (e: any) {
      setMsg(`지역 추가 실패: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  /** ===== 재고 피벗 (행=자재, 열=지역) ===== */
  const pivot = useMemo(() => {
    const byMat = new Map<string, {
      material_name: string;
      vendor: string | null;
      unit_price: number | null;
      stocks: Record<string, number>;
    }>();
    for (const r of stock) {
      const row = byMat.get(r.material_id) || {
        material_name: r.material_name,
        vendor: r.vendor,
        unit_price: r.unit_price,
        stocks: {} as Record<string, number>,
      };
      row.stocks[r.location_id] = Number(r.stock_qty || 0);
      byMat.set(r.material_id, row);
    }
    return byMat;
  }, [stock]);

  /** ===== 합계 계산 유틸 ===== */
  const totalByMatAllLoc = useMemo(() => {
    const map = new Map<string, number>();
    for (const [id, row] of pivot.entries()) {
      map.set(id, Object.values(row.stocks).reduce((a, b) => a + (b || 0), 0));
    }
    return map;
  }, [pivot]);

  /** ===== 상세 모달 열기: 자재×지역 내역 ===== */
  async function openDetail(materialId: string, locationId: string) {
    const matName = materialsFull.find(m => m.id === materialId)?.name
      ?? materialsPub.find(m => m.id === materialId)?.name
      ?? '';
    const locName = locations.find(l => l.id === locationId)?.name ?? '';
    setDetailTitle({ matName, locName });
    setDetailMoves([]);
    setDetailLoading(true);
    setDetailOpen(true);

    try {
      const recQ = supabase
        .from('material_receipts')
        .select('id, material_id, location_id, qty, received_date, created_at')
        .eq('material_id', materialId)
        .eq('location_id', locationId)
        .order('received_date', { ascending: false })
        .limit(500);

      const useQ = supabase
        .from('material_usages')
        .select(`
          id, material_id, location_id, qty, used_date, created_at, schedule_id,
          schedules!inner(
            id, title, customer_name, employee_name, employee_names
          )
        `)
        .eq('material_id', materialId)
        .eq('location_id', locationId)
        .order('used_date', { ascending: false })
        .limit(500);

      const [{ data: recs, error: rErr }, { data: usesRaw, error: uErr }] = await Promise.all([recQ, useQ]);
      if (rErr) throw rErr;
      if (uErr) throw uErr;

      const recMoves: Movement[] = (recs ?? []).map(r => ({
        kind: '입고',
        date: r.received_date ?? r.created_at ?? '',
        qtySigned: +Number(r.qty || 0),
        qty: Math.abs(Number(r.qty || 0)),
        created_at: r.created_at ?? null,
      }));

      const useMoves: Movement[] = (usesRaw ?? []).map((u: any) => {
        const s = u.schedules;
        const empLabel =
          (Array.isArray(s?.employee_names) && s.employee_names.length > 0)
            ? s.employee_names.join(', ')
            : (s?.employee_name ?? null);
        return {
          kind: '사용',
          date: u.used_date ?? u.created_at ?? '',
          qtySigned: -Number(u.qty || 0),
          qty: Math.abs(Number(u.qty || 0)),
          created_at: u.created_at ?? null,
          schedule_id: typeof u.schedule_id === 'number' ? u.schedule_id : (u.schedule_id != null ? Number(u.schedule_id) : null),
          title: s?.title ?? null,
          customer_name: s?.customer_name ?? null,
          employee_label: empLabel,
        } as Movement;
      });

      const merged = [...recMoves, ...useMoves].sort((a, b) => {
        const da = (a.date || a.created_at || '');
        const db = (b.date || b.created_at || '');
        if (da === db) return (b.created_at || '').localeCompare(a.created_at || '');
        return db.localeCompare(da);
      });

      setDetailMoves(merged);
    } catch (e: any) {
      setMsg(`상세내역 로드 실패: ${e.message || e}`);
    } finally {
      setDetailLoading(false);
    }
  }

  /** ====== 필터링(모바일 등록된 자재) ====== */
  const filteredRegMob = useMemo(() => {
    const q = regSearch.trim().toLowerCase();
    if (!q) return materialsPub;
    return materialsPub.filter(m =>
      m.name.toLowerCase().includes(q) || (m.vendor ?? '').toLowerCase().includes(q)
    );
  }, [materialsPub, regSearch]);

  /** ====== 필터링(모바일 재고현황) ====== */
  const filteredStockMob = useMemo(() => {
    const entries = Array.from(pivot.entries());
    const q = stockSearch.trim().toLowerCase();
    return entries.filter(([_, row]) =>
      !q || row.material_name.toLowerCase().includes(q) || (row.vendor ?? '').toLowerCase().includes(q)
    );
  }, [pivot, stockSearch]);

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-sky-700 via-sky-600 to-indigo-600 bg-clip-text text-transparent">
            자재
          </span>{' '}
          <span className="text-slate-600">관리</span>
        </h1>
        <p className="text-slate-600 text-sm mt-1">
          자재를 등록하고 입고/사용 내역을 관리하세요. 지역별 재고현황에서 <b>상세</b>를 통해 타임라인으로 확인할 수 있습니다.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTab('register')} className={`btn ${tab==='register' ? 'btn-primary' : ''}`}>자재등록</button>
        <button onClick={() => setTab('inbound')}  className={`btn ${tab==='inbound'  ? 'btn-primary' : ''}`}>입고</button>
        <button onClick={() => setTab('stock')}    className={`btn ${tab==='stock'    ? 'btn-primary' : ''}`}>지역별 재고현황</button>
        <button onClick={() => setTab('settings')} className={`btn ${tab==='settings' ? 'btn-primary' : ''}`}>지역 관리(+추가)</button>
      </div>

      {msg && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{msg}</div>}
      {loading && <div className="p-3 text-sm text-slate-600">불러오는 중…</div>}

      {/* === 자재 등록/목록 === */}
      {tab === 'register' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 등록 폼 */}
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
              <p className="text-xs text-gray-500 mt-1">⚠️ 단가는 정책에 따라 비관리자에게 마스킹될 수 있습니다.</p>
            </label>
            <div className="flex justify-end">
              <button className="btn-primary">등록</button>
            </div>
          </form>

          {/* 등록된 자재 - 데스크탑 표 유지 */}
          <div className="hidden sm:block rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white shadow-[0_6px_16px_rgba(2,132,199,0.08)] p-5">
            <div className="text-lg font-bold text-sky-800 mb-3">등록된 자재</div>
            <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <table className="min-w-[720px] md:min-w-0 w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">이름</th>
                    <th className="text-left p-2">거래처</th>
                    <th className="text-right p-2">단가(관리자)</th>
                    <th className="text-center p-2 w-[140px]">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {materialsFull.map(m => (
                    <tr key={m.id} className="border-b">
                      <td className="p-2">
                        {editId === m.id ? (
                          <input className="input h-8" value={editName} onChange={e=>setEditName(e.target.value)} />
                        ) : (
                          m.name
                        )}
                      </td>
                      <td className="p-2">
                        {editId === m.id ? (
                          <input className="input h-8" value={editVendor} onChange={e=>setEditVendor(e.target.value)} />
                        ) : (
                          m.vendor || '-'
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {editId === m.id ? (
                          <input
                            className="input h-8 text-right"
                            type="number"
                            inputMode="numeric"
                            value={editPrice}
                            onChange={e=>setEditPrice(e.target.value===''? '' : Number(e.target.value))}
                          />
                        ) : (
                          m.unit_price ?? '—'
                        )}
                      </td>
                      <td className="p-2 text-center">
                        {editId === m.id ? (
                          <div className="inline-flex gap-1">
                            <button onClick={saveEdit} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs">저장</button>
                            <button onClick={()=>setEditId(null)} className="px-2 py-1 rounded border text-xs">취소</button>
                          </div>
                        ) : (
                          <div className="inline-flex gap-1">
                            <button onClick={()=>startEdit(m.id)} className="px-2 py-1 rounded border border-sky-200 text-sky-700 hover:bg-sky-50 text-xs">수정</button>
                            <button onClick={()=>deleteMaterial(m.id)} className="px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs">삭제</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {materialsFull.length === 0 && (
                    <tr><td className="p-3 text-gray-500" colSpan={4}>아직 등록된 자재가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 등록된 자재 - 모바일 카드형 리스트 */}
          <div className="sm:hidden rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white p-4 space-y-2">
            <div className="text-base font-bold text-sky-800">등록된 자재</div>
            <input
              className="input h-9 text-[13px]"
              placeholder="자재/거래처 검색"
              value={regSearch}
              onChange={(e)=>setRegSearch(e.target.value)}
            />
            <div className="divide-y">
              {filteredRegMob.map(m => (
                <div key={m.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-[14px]">{m.name}</div>
                    <div className="text-[12px] text-slate-500">{m.vendor || '-'}</div>
                  </div>
                  <div className="text-[12px] text-slate-700 mt-0.5">
                    단가(공개): {m.unit_price_visible != null ? numberWon(m.unit_price_visible) : '—'}
                  </div>
                </div>
              ))}
              {filteredRegMob.length === 0 && (
                <div className="py-3 text-[12px] text-slate-500">검색 결과가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === 입고 === */}
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
                {materialsFull.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
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

      {/* === 지역별 재고현황 === */}
      {tab === 'stock' && (
        <div className="rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white shadow-[0_6px_16px_rgba(2,132,199,0.08)] p-5">
          <div className="text-lg font-bold text-sky-800 mb-2">지역별 재고현황</div>

          {/* 데스크탑 표: 기존 유지 */}
          <div className="hidden sm:block overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[860px] md:min-w-0 w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">자재</th>
                  <th className="text-left p-2">거래처</th>
                  {locations.map(l => <th key={l.id} className="text-right p-2">{l.name}</th>)}
                  <th className="text-center p-2 w-[160px]">상세</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(pivot.entries()).map(([matId, row]) => (
                  <tr key={matId} className="border-b">
                    <td className="p-2">{row.material_name}</td>
                    <td className="p-2">{row.vendor || '-'}</td>
                    {locations.map(l => (
                      <td key={l.id} className="p-2 text-right">{row.stocks[l.id] ?? 0}</td>
                    ))}
                    <td className="p-2 text-center">
                      <div className="inline-flex flex-wrap gap-1 justify-center">
                        {locations.map((l) => (
                          <button
                            key={l.id}
                            onClick={() => openDetail(matId, l.id)}
                            className="text-xs px-2 py-1 rounded border border-sky-200 text-sky-700 hover:bg-sky-50"
                            title={`${row.material_name} / ${l.name} 상세보기`}
                          >
                            {l.name}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {pivot.size === 0 && (
                  <tr>
                    <td className="p-3 text-gray-500" colSpan={3 + locations.length}>데이터가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 모바일: 지역 탭 + 카드 리스트 */}
          <div className="sm:hidden">
            {/* 지역 선택 탭 */}
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2">
              <button
                className={`px-3 py-1 rounded-full border text-[12px] whitespace-nowrap ${mobileStockLoc==='ALL' ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-300'}`}
                onClick={()=>setMobileStockLoc('ALL')}
              >
                전체
              </button>
              {locations.map(l => (
                <button
                  key={l.id}
                  className={`px-3 py-1 rounded-full border text-[12px] whitespace-nowrap ${mobileStockLoc===l.id ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-300'}`}
                  onClick={()=>setMobileStockLoc(l.id)}
                >
                  {l.name}
                </button>
              ))}
            </div>

            {/* 검색 */}
            <div className="mt-2">
              <input
                className="input h-9 text-[13px]"
                placeholder="자재/거래처 검색"
                value={stockSearch}
                onChange={(e)=>setStockSearch(e.target.value)}
              />
            </div>

            {/* 리스트 */}
            <div className="mt-2 divide-y">
              {Array.from(pivot.entries())
                .filter(([matId, row]) => {
                  const q = stockSearch.trim().toLowerCase();
                  return !q || row.material_name.toLowerCase().includes(q) || (row.vendor ?? '').toLowerCase().includes(q);
                })
                .map(([matId, row]) => {
                  const totalAll = totalByMatAllLoc.get(matId) ?? 0;
                  const oneLocQty = mobileStockLoc === 'ALL' ? null : (row.stocks[mobileStockLoc] ?? 0);
                  return (
                    <div key={matId} className="py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="font-semibold text-[14px]">{row.material_name}</div>
                        <div className="text-[11px] text-slate-500">{row.vendor || '-'}</div>
                      </div>

                      {/* 수량 요약 */}
                      <div className="mt-1 flex items-center gap-3 text-[12px]">
                        <span className="px-2 py-0.5 rounded bg-sky-50 border border-sky-100">
                          전체 {totalAll}
                        </span>
                        {mobileStockLoc !== 'ALL' && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-100">
                            {locations.find(l=>l.id===mobileStockLoc)?.name}: {oneLocQty}
                          </span>
                        )}
                      </div>

                      {/* 액션 버튼 */}
                      <div className="mt-1">
                        {mobileStockLoc === 'ALL' ? (
                          <div className="flex flex-wrap gap-1">
                            {locations.map(l => (
                              <button
                                key={l.id}
                                className="text-[11px] px-2 py-1 rounded border border-slate-200"
                                onClick={()=>openDetail(matId, l.id)}
                              >
                                {l.name} 상세
                              </button>
                            ))}
                          </div>
                        ) : (
                          <button
                            className="text-[12px] px-3 py-1 rounded border border-slate-300"
                            onClick={()=>openDetail(matId, mobileStockLoc)}
                          >
                            상세 보기
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* === 지역 관리 === */}
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

      {/* ▶ 상세 모달 */}
      {detailOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-50">
          <div className="w-full md:w-[min(900px,94vw)] max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl border border-sky-100 ring-1 ring-sky-100/70 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-lg font-bold text-sky-800">
                {detailTitle ? `상세내역 — ${detailTitle.matName} / ${detailTitle.locName}` : '상세내역'}
              </h2>
              <button onClick={() => setDetailOpen(false)} className="text-slate-500 hover:text-slate-800">✕</button>
            </div>

            {detailLoading ? (
              <div className="text-sm text-slate-600">불러오는 중…</div>
            ) : (
              <>
                <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
                  <table className="min-w-[760px] md:min-w-0 w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">날짜</th>
                        <th className="text-left p-2">구분</th>
                        <th className="text-right p-2">수량</th>
                        <th className="text-left p-2">작업/고객</th>
                        <th className="text-left p-2">직원</th>
                        <th className="text-left p-2">일정ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailMoves.map((m, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="p-2 whitespace-nowrap">{fmtDateTime(m.date)}</td>
                          <td className="p-2">
                            <span className={m.kind === '입고' ? 'text-emerald-700' : 'text-rose-700'}>
                              {m.kind}
                            </span>
                          </td>
                          <td className={`p-2 text-right whitespace-nowrap ${m.qtySigned >=0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {m.qtySigned >= 0 ? `+${m.qty}` : `-${m.qty}`}
                          </td>
                          <td className="p-2">
                            {m.kind === '사용'
                              ? (m.title || '-') + (m.customer_name ? ` / ${m.customer_name}` : '')
                              : '입고'}
                          </td>
                          <td className="p-2">{m.kind === '사용' ? (m.employee_label || '-') : '-'}</td>
                          <td className="p-2">{m.kind === '사용' ? (m.schedule_id ?? '-') : '-'}</td>
                        </tr>
                      ))}
                      {detailMoves.length === 0 && (
                        <tr><td className="p-3 text-gray-500" colSpan={6}>내역이 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 간단 합계 */}
                <div className="mt-3 text-sm text-slate-700">
                  총 입고: <b className="text-emerald-700">{sum(detailMoves.filter(m => m.kind==='입고').map(m=>m.qty))}</b> /
                  총 사용: <b className="text-rose-700">{sum(detailMoves.filter(m => m.kind==='사용').map(m=>m.qty))}</b> /
                  재고량: <b>{sum(detailMoves.map(m => m.qtySigned))}</b>
                </div>
              </>
            )}

            <div className="mt-4 text-right">
              <button onClick={() => setDetailOpen(false)} className="btn">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** ===== 유틸 ===== */
function sum(nums: number[]) {
  return nums.reduce((a, b) => a + Number(b || 0), 0);
}
function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(+d)) return iso;
    const y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).toString().padStart(2, '0');
    const m = String(d.getMinutes()).toString().padStart(2, '0');
    return `${y}-${M}-${D} ${h}:${m}`;
  } catch {
    return iso;
  }
}
function numberWon(n: number) {
  try { return new Intl.NumberFormat('ko-KR').format(n) + '원'; }
  catch { return `${Math.round(n).toLocaleString()}원`; }
}
