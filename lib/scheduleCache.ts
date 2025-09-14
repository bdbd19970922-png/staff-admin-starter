// FILE: /lib/scheduleCache.ts
export type SRow = {
  id: number;
  title: string | null;
  start_ts: string | null;
  end_ts: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  employee_names?: string[] | null;
  off_day?: boolean | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  site_address?: string | null;
  revenue?: number | null;
  material_cost?: number | null;
  daily_wage?: number | null;
  extra_cost?: number | null;
};

// 전역 캐시: 탭을 새로고침하기 전까지 유지
const byId = new Map<number, SRow>();
const loadedKeys = new Set<string>(); // 예: '2025-09' 같은 달 키

export function mergeRows(rows: SRow[]) {
  for (const r of rows) {
    if (!r || typeof r.id !== 'number') continue;
    byId.set(r.id, { ...(byId.get(r.id) ?? {}), ...r });
  }
}

// 'YYYY-MM' 형태의 달 키
export function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

export function markLoaded(key: string) {
  loadedKeys.add(key);
}
export function isLoaded(key: string) {
  return loadedKeys.has(key);
}

// 특정 기간에 해당하는 row만 필터
export function getRowsBetween(startISO: string, endISO: string): SRow[] {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const out: SRow[] = [];
  for (const r of byId.values()) {
    if (!r.start_ts) continue;
    const s = new Date(r.start_ts);
    if (s >= start && s < end) out.push(r);
  }
  return out;
}

// 전체 캐시(디버그용)
export function getAllCached(): SRow[] {
  return Array.from(byId.values());
}
