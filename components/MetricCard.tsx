export function MetricCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-2 text-3xl font-bold">{value}</div>
      {subtitle ? <div className="mt-1 text-xs text-gray-400">{subtitle}</div> : null}
    </div>
  );
}
