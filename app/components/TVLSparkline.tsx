"use client";

type TVLPoint = { value: number };

export default function TVLSparkline({ data }: { data: TVLPoint[] }) {
  if (!data || data.length === 0) return null;

  const max = Math.max(...data.map((d) => d.value));
  const last = data[data.length - 1].value;
  const pct = max === 0 ? 0 : (last / max) * 100;

  return (
    <div className="w-full h-full flex items-center">
      <div className="w-full h-3 rounded-full bg-slate-800/80 overflow-hidden">
        <div
          className="h-full rounded-full bg-sky-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
