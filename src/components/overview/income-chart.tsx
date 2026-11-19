"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import { axisLabel, niceTicks, smoothPath } from "@/lib/chart";

export interface MonthPoint { month: string; income: number; expense: number }

const H = 260;
const PAD = { top: 12, right: 44, bottom: 28, left: 8 };

/**
 * Income vs expenses per month: smooth lines, income area-filled, nice y steps on the right,
 * a hover tooltip per month. The selected (last) month gets ringed end points.
 */
export function IncomeChart({ data, label }: { data: MonthPoint[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const empty = data.every((d) => d.income === 0 && d.expense === 0);
  // At least $100 of scale, so tiny or empty months still get readable steps.
  const max = Math.max(10_000, ...data.flatMap((d) => [d.income, d.expense]));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1];
  const innerW = w - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / top) * innerH;
  const inc = data.map((d, i) => [x(i), y(d.income)] as [number, number]);
  const exp = data.map((d, i) => [x(i), y(d.expense)] as [number, number]);
  const incPath = smoothPath(inc);
  const area = `${incPath} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const last = data.length - 1;
  const shown = hover ?? null;

  const monthName = (iso: string, long = false) => {
    const [yy, mm] = iso.split("-").map(Number);
    return new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString("en-US", long ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "short", timeZone: "UTC" });
  };

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden" data-testid="income-chart">
      <svg width={w} height={H} role="img" aria-label={label} className="block overflow-visible"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - box.left - PAD.left;
          const i = Math.round((px / innerW) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, i)));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={w - PAD.right + 8} y={y(t) + 4} fontSize="11" fill="var(--muted-foreground)">{axisLabel(t)}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <text key={d.month} x={x(i)} y={H - 6} fontSize="11" textAnchor={i === 0 ? "start" : "middle"}
            fill={i === last ? "var(--foreground)" : "var(--muted-foreground)"} fontWeight={i === last ? 600 : 400}>
            {monthName(d.month)}
          </text>
        ))}
        {!empty && <>
        <path d={area} fill="var(--money-in-soft)" opacity="0.9" />
        <path d={incPath} fill="none" stroke="var(--money-in)" strokeWidth="2.25" strokeLinecap="round" />
        <path d={smoothPath(exp)} fill="none" stroke="var(--money-out)" strokeWidth="2.25" strokeLinecap="round" />
        {shown !== null && <line x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={y(0)} stroke="var(--border)" />}
        {[last, ...(shown !== null && shown !== last ? [shown] : [])].map((i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(data[i].income)} r="4.5" fill="var(--card)" stroke="var(--money-in)" strokeWidth="2" />
            <circle cx={x(i)} cy={y(data[i].expense)} r="4.5" fill="var(--card)" stroke="var(--money-out)" strokeWidth="2" />
          </g>
        ))}
        </>}
      </svg>
      {empty && (
        <p className="absolute inset-x-0 top-[38%] text-center text-sm text-muted-foreground">
          Import a statement to see income and expenses by month.
        </p>
      )}
      {!empty && shown !== null && (
        <div role="status" className="pointer-events-none absolute top-1 z-10 min-w-56 rounded-xl border bg-card px-3 py-2.5 text-xs overlay-shadow"
          style={{ left: Math.min(Math.max(0, x(shown) - 112), w - 236) }}>
          <p className="mb-1.5 font-medium">{monthName(data[shown].month, true)}</p>
          <p className="flex items-center gap-2"><span className="size-2 rounded-full bg-money-in" />Income<span className="ml-auto font-medium tabular-nums">{formatCents(data[shown].income)}</span></p>
          <p className="mt-1 flex items-center gap-2"><span className="size-2 rounded-full bg-money-out" />Expenses<span className="ml-auto font-medium tabular-nums">{formatCents(data[shown].expense)}</span></p>
        </div>
      )}
    </div>
  );
}
