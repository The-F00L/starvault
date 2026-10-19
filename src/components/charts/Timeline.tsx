import { useLayoutEffect, useMemo, useRef, useState } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

/** Single-series area chart of stars per month with a snapping crosshair tooltip. */
export function Timeline({ data, height = 220 }: { data: { month: string; count: number }[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { top: 12, right: 12, bottom: 24, left: 32 };
  const w = Math.max(width - pad.left - pad.right, 10);
  const h = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d.count));
  const niceMax = useMemo(() => {
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / step) * step;
  }, [max]);
  const x = (i: number) => (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v: number) => h - (v / niceMax) * h;

  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.count).toFixed(1)}`).join("");
  const area = `${line}L${x(data.length - 1).toFixed(1)},${h}L${x(0).toFixed(1)},${h}Z`;
  const yTicks = [0, niceMax / 2, niceMax];
  const years = data.map((d, i) => ({ i, d })).filter(({ d }) => d.month.endsWith("-01"));
  const yearStep = Math.ceil(years.length / Math.max(1, Math.floor(w / 60)));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    setHover(data.length === 1 ? 0 : Math.round((px / w) * (data.length - 1)));
  }

  if (data.length === 0) return <p className="py-16 text-center text-on-surface-variant">No stars yet.</p>;
  const hv = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" aria-label={`Stars per month from ${label(data[0].month)} to ${label(data[data.length - 1].month)}, peak ${max}`}>
        <defs>
          <linearGradient id="tl-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary-container)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-primary-container)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g transform={`translate(${pad.left},${pad.top})`}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke="var(--color-surface-container-highest)" strokeDasharray={t ? "2 4" : undefined} />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-on-surface-variant font-mono text-[10px]">
                {t}
              </text>
            </g>
          ))}
          {years
            .filter((_, k) => k % yearStep === 0)
            .map(({ i, d }) => (
              <text key={d.month} x={x(i)} y={h + 16} textAnchor="middle" className="fill-on-surface-variant font-mono text-[10px]">
                {d.month.slice(0, 4)}
              </text>
            ))}
          <path d={area} fill="url(#tl-fill)" />
          <path d={line} fill="none" stroke="var(--color-primary-container)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hv && hover !== null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke="var(--color-on-surface-variant)" strokeOpacity={0.5} />
              <circle cx={x(hover)} cy={y(hv.count)} r={4} fill="var(--color-primary-container)" stroke="var(--color-surface-container-low)" strokeWidth={2} />
            </>
          )}
          <rect width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </g>
      </svg>
      {hv && hover !== null && (
        <div
          className="absolute pointer-events-none px-2.5 py-1.5 rounded bg-surface-container-highest border border-[#484f58] shadow-lg"
          style={{ left: Math.min(pad.left + x(hover) + 10, width - 120), top: pad.top }}
        >
          <p className="font-mono text-code-md font-semibold">{hv.count} stars</p>
          <p className="text-body-sm text-on-surface-variant">{label(hv.month)}</p>
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-code-sm text-on-surface-variant hover:text-on-surface">View as table</summary>
        <div className="max-h-48 overflow-auto mt-2">
          <table className="w-full font-mono text-code-sm">
            <thead>
              <tr className="text-on-surface-variant text-left">
                <th className="font-normal py-1">Month</th>
                <th className="font-normal py-1 text-right">Stars</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.month} className="border-t border-surface-container-highest">
                  <td className="py-1">{label(d.month)}</td>
                  <td className="py-1 text-right">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
