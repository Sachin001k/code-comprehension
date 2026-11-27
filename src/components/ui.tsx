import ReactMarkdown from 'react-markdown';
import clsx from 'clsx';
import type { Level } from '../content/types';
import { levelColor, levelName, titleFor } from '../lib/rating';
import type { ReactNode } from 'react';

export function Md({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx('md', className)}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}

export function LevelBadge({ level, full }: { level: Level; full?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide"
      style={{ color: levelColor(level), background: `color-mix(in srgb, ${levelColor(level)} 14%, transparent)` }}
    >
      L{level}
      {full && <span className="font-semibold">· {levelName(level)}</span>}
    </span>
  );
}

export function RatingPill({ rating, className }: { rating: number; className?: string }) {
  const t = titleFor(rating);
  return (
    <span className={clsx('inline-flex items-center gap-1.5 font-mono text-xs font-bold', className)} style={{ color: t.color }}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><polygon points="5,0 10,5 5,10 0,5" fill="currentColor" /></svg>
      {rating}
    </span>
  );
}

export function ProgressBar({ value, color = 'var(--accent)', className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-panel-2', className)}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, background: color }} />
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card flex items-center justify-center p-10 text-sm text-muted">{children}</div>;
}

export function fmtTime(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function shuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
