import { CheckCircle2, XCircle, Lightbulb, Eye, ArrowRight, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Problem, Stage } from '../content/types';
import { Md } from '../components/ui';
import type { StageProgress } from '../lib/store';

export interface StageCtx {
  problem: Problem;
  stage: Stage;
  /** Current editor buffers (path -> content), including edits. */
  files: Record<string, string>;
  progress?: StageProgress;
  mock: boolean;
  elapsedSec: number;
  selectedLine: number | null;
  setSelectedLine: (n: number | null) => void;
  openFile: (path: string) => void;
  /** Called when the stage is finished (correct, revealed, or mock single-shot). */
  complete: (r: { correct: boolean; partial?: number; revealed?: boolean; answer?: unknown; ranTests?: boolean }) => void;
  wrong: () => void;
  setConsole: (c: ConsoleState) => void;
  ranTests: boolean;
  setRanTests: (v: boolean) => void;
}

export interface ConsoleState {
  running?: boolean;
  title?: string;
  logs?: string[];
  results?: { name: string; passed: boolean; error?: string; durationMs: number }[];
  error?: string;
  durationMs?: number;
}

export function normAnswer(s: string) {
  return s
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l, i, a) => !(l === '' && (i === 0 || i === a.length - 1)))
    .join('\n')
    .replace(/^["'`]|["'`]$/g, '')
    .trim()
    .toLowerCase();
}

export function Feedback({ kind, children }: { kind: 'ok' | 'bad' | 'info'; children: ReactNode }) {
  const cls = kind === 'ok' ? 'border-accent/40 bg-accent/10 text-accent' : kind === 'bad' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-info/40 bg-info/10 text-info';
  const Icon = kind === 'ok' ? CheckCircle2 : kind === 'bad' ? XCircle : Lightbulb;
  return (
    <div className={`animate-pop flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="text-fg">{children}</div>
    </div>
  );
}

export function HintBox({ stage, used, onTake, disabled }: { stage: Stage; used: number; onTake: () => void; disabled?: boolean }) {
  if (!stage.hints.length) return null;
  return (
    <div className="space-y-2">
      {stage.hints.slice(0, used).map((h, i) => (
        <div key={i} className="animate-pop flex gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          <Lightbulb size={15} className="mt-0.5 shrink-0 text-warn" />
          <Md>{h}</Md>
        </div>
      ))}
      {used < stage.hints.length && !disabled && (
        <button className="btn-subtle !px-2 !py-1 text-xs" onClick={onTake}>
          <Lightbulb size={14} /> Take hint {used + 1}/{stage.hints.length} <span className="text-faint">(−12% score)</span>
        </button>
      )}
    </div>
  );
}

export function SubmitRow({ onSubmit, onReveal, disabled, label = 'Submit', extra, mock }: { onSubmit: () => void; onReveal?: () => void; disabled?: boolean; label?: string; extra?: ReactNode; mock: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <button className="btn-primary" disabled={disabled} onClick={onSubmit}>{label}</button>
      {extra}
      {onReveal && !mock && (
        <button className="btn-subtle ml-auto text-xs" onClick={onReveal}><Eye size={14} /> Give up & reveal</button>
      )}
    </div>
  );
}

export function StageResult({ sp, stage, mock, onNext, isLast }: { sp: StageProgress; stage: Stage; mock: boolean; onNext: () => void; isLast: boolean }) {
  const pct = Math.round(sp.score * 100);
  return (
    <div className="space-y-3">
      <Feedback kind={sp.correct ? 'ok' : sp.revealed ? 'info' : 'bad'}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">{sp.correct ? 'Correct' : sp.revealed ? 'Answer revealed' : 'Stage closed'}</span>
          <span className="font-mono text-xs text-muted">score {pct}%</span>
          {sp.wrongAttempts > 0 && <span className="text-xs text-muted">{sp.wrongAttempts} wrong attempt{sp.wrongAttempts > 1 ? 's' : ''}</span>}
          {sp.hintsUsed > 0 && <span className="text-xs text-muted">{sp.hintsUsed} hint{sp.hintsUsed > 1 ? 's' : ''}</span>}
          <span className="flex items-center gap-1 text-xs text-muted"><Clock size={12} /> {Math.round(sp.timeSec / 60)}m</span>
        </div>
      </Feedback>
      {!mock && (
        <div className="rounded-lg border border-line bg-bg-2 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Why</div>
          <Md>{stage.explanation}</Md>
        </div>
      )}
      <button className="btn-primary w-full" onClick={onNext}>
        {isLast ? 'See scorecard' : 'Next stage'} <ArrowRight size={16} />
      </button>
    </div>
  );
}

export function Choice({ selected, onClick, children, multi, state }: { selected: boolean; onClick: () => void; children: ReactNode; multi?: boolean; state?: 'correct' | 'wrong' }) {
  const ring = state === 'correct' ? 'border-accent bg-accent/10' : state === 'wrong' ? 'border-danger bg-danger/10' : selected ? 'border-accent bg-accent/5' : 'border-line hover:border-line-strong bg-bg-2';
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${ring}`}>
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${multi ? 'rounded' : 'rounded-full'} ${selected ? 'border-accent bg-accent' : 'border-line-strong'}`}>
        {selected && <span className={`${multi ? 'h-2 w-2 rounded-sm' : 'h-1.5 w-1.5 rounded-full'} bg-accent-ink`} />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/** Render a choice label: multi-line outputs as code. */
export function ChoiceLabel({ text }: { text: string }) {
  if (text.includes('\n') || /^[\[{(\d"'-]/.test(text.trim())) {
    return <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{text}</pre>;
  }
  return <Md className="[&_p]:my-0">{text}</Md>;
}
