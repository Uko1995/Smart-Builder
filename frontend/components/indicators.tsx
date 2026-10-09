import { formatOdds, formatProbability, runStatusLabel, type RunTone } from "@/lib/format";

const TONE: Record<RunTone, string> = {
  idle: "bg-slate-100 text-slate-700",
  running: "bg-amber-50 text-amber-800",
  ok: "bg-emerald-50 text-emerald-800",
  warn: "bg-amber-50 text-amber-900",
  bad: "bg-rose-50 text-rose-800",
  muted: "bg-slate-100 text-slate-700",
};

export function RunStatus({ status }: { status: string | null | undefined }) {
  const view = runStatusLabel(status);
  return (
    <div className={`rounded-2xl px-4 py-3 ${TONE[view.tone]}`}>
      <p className="text-sm font-semibold">{view.label}</p>
      <p className="text-sm">{view.detail}</p>
    </div>
  );
}

export function Odds({ value }: { value: string | number | null | undefined }) {
  return <span className="num">{formatOdds(value)}</span>;
}

export function Probability({ value }: { value: string | number | null | undefined }) {
  return <span className="num">{formatProbability(value)}</span>;
}

export function OriginBadge({ origin }: { origin: string | null | undefined }) {
  if (origin === "synthetic_demo") {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Synthetic demo</span>;
  }
  if (origin === "manual") {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Manual entry</span>;
  }
  return <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-tide">Recorded</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel px-5 py-8">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 max-w-xl text-sm text-slate-600">{body}</p>
    </div>
  );
}

export function WarningList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {item}
        </li>
      ))}
    </ul>
  );
}
