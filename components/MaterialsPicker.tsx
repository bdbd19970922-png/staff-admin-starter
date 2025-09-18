// FILE: app/components/MaterialsPicker.tsx
'use client';

import { useMemo } from 'react';

export type MatLine = {
  id: string;                 // 로컬 행 id(키용)
  material_id: string;        // 자재 id
  location_id: string;        // 지역 id
  qty: number | '';           // 수량
};

export type MaterialPub = {
  id: string;
  name: string;
  vendor: string | null;
  unit_price_visible: number | null; // 관리자면 숫자, 아니면 null
};

export type Location = { id: string; name: string };

export default function MaterialsPicker({
  lines,
  setLines,
  materials,
  locations,
}: {
  lines: MatLine[];
  setLines: (next: MatLine[]) => void;
  materials: MaterialPub[];
  locations: Location[];
}) {
  const totalEst = useMemo(() => {
    // 관리자면 unit_price_visible을 이용해 대략 합계 표시(관리자 외엔 '—')
    // 실제 비용 반영은 서버에서 materials.unit_price로 계산됨(보안/RLS)
    let sum = 0;
    for (const ln of lines) {
      if (!ln.material_id || !ln.qty || Number(ln.qty) <= 0) continue;
      const m = materials.find((x) => x.id === ln.material_id);
      const p = m?.unit_price_visible ?? null;
      if (p != null) sum += Number(ln.qty) * Number(p);
    }
    return sum;
  }, [lines, materials]);

  const addLine = () => {
    setLines([
      ...lines,
      { id: crypto.randomUUID(), material_id: '', location_id: '', qty: '' },
    ]);
  };

  const removeLine = (id: string) => {
    setLines(lines.filter((x) => x.id !== id));
  };

  const updateLine = (id: string, patch: Partial<MatLine>) => {
    setLines(lines.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">자재 사용(여러 개 선택 가능)</h3>
        <button type="button" onClick={addLine} className="px-3 py-2 border rounded-md">+ 추가</button>
      </div>

      <div className="space-y-2">
        {lines.length === 0 && (
          <div className="text-sm text-gray-500">사용할 자재가 없으면 비워두세요.</div>
        )}

        {lines.map((ln) => (
          <div key={ln.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md p-2">
            <div className="md:col-span-5">
              <label className="block text-xs mb-1">자재</label>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={ln.material_id}
                onChange={(e) => updateLine(ln.id, { material_id: e.target.value })}
              >
                <option value="">선택</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.vendor ? ` · ${m.vendor}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs mb-1">지역</label>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={ln.location_id}
                onChange={(e) => updateLine(ln.id, { location_id: e.target.value })}
              >
                <option value="">선택</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs mb-1">수량</label>
              <input
                type="number"
                inputMode="numeric"
                placeholder="예: 3"
                className="w-full border rounded-md px-3 py-2"
                value={ln.qty}
                onChange={(e) => {
                  const v = e.target.value;
                  updateLine(ln.id, { qty: v === '' ? '' : Number(v) });
                }}
              />
            </div>

            <div className="md:col-span-1 flex md:justify-end">
              <button
                type="button"
                onClick={() => removeLine(ln.id)}
                className="px-3 py-2 border rounded-md"
              >
                삭제
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="text-sm text-gray-600">
        예상 자재비 합계(관리자 화면용): {Number.isFinite(totalEst) ? totalEst.toLocaleString() : '—'} 원
      </div>
      <p className="text-xs text-gray-500">
        ※ 최종 자재비는 서버에서 자재 단가×수량으로 계산되어 스케줄에 반영되며, 재고는 선택한 지역에서 차감됩니다.
      </p>
    </div>
  );
}
