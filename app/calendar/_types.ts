// /app/calendar/_types.ts
export type ScheduleRow = {
  id: number;
  title: string;
  start_ts: string; // ISO
  end_ts: string;   // ISO
  location?: string | null;
  status?: 'scheduled' | 'in_progress' | 'done' | 'cancelled';
  daily_wage?: number | null;
  revenue?: number | null;
  material_cost?: number | null;
  extra_cost?: number | null;
};

