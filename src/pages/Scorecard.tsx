import { useState } from 'react';
import { CheckCircle2, XCircle, RotateCcw, ArrowLeft, ChevronDown, Trophy, TrendingUp, TrendingDown } from 'lucide-react';
import clsx from 'clsx';
import type { Problem } from '../content/types';
import { STAGE_KIND_LABEL } from '../content/types';
import type { ProblemProgress } from '../lib/store';
import { LevelBadge, Md, ProgressBar, RatingPill, fmtTime } from '../components/ui';
import { titleFor } from '../lib/rating';
import { useThemeSync } from '../components/Layout';

export interface SessionMetrics {
  prompts: number;
  promptsWithContext: number;
  earlyPrompts: number;
  filesOpened: Set<string>;
  stagesRanTests: number;
}

interface Props {
  problem: Problem;
  progress?: ProblemProgress;
  result: { score: number; delta: number; newRating: number; alreadyRated: boolean } | null;
  mock: boolean;
  preset?: string;
  metrics: SessionMetrics;
  totalSec: number;
  onRestart: () => void;
  onBack: () => void;
}

/** Rubric mirrors the design doc section 7.6, computed from what the platform can observe. */
function rubric(problem: Problem, pp: ProblemProgress | undefined, m: SessionMetrics) {
  const st = problem.stages.map((s) => ({ s, p: pp?.stages[s.id] }));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const correctness = avg(st.map(({ p }) => (p?.correct ? 1 : p?.score ?? 0)));
  const codeStages = st.filter(({ s }) => s.kind === 'code');
  const reviewStages = st.filter(({ s }) => s.kind === 'review-ai');
  const verificationParts: number[] = [];
  for (const { p } of codeStages) verificationParts.push(p?.ranTests ? 1 : 0.3);
  for (const { p } of reviewStages) verificationParts.push(p?.correct ? 1 : 0);
  const verification = avg(verificationParts);
  const aiParts: number[] = reviewStages.map(({ p }) => (p?.correct ? 1 : 0));
  if (m.prompts > 0) aiParts.push(Math.max(0, m.promptsWithContext / m.prompts - 0.3 * Math.min(1, m.earlyPrompts / m.prompts)));
  const aiUsage = avg(aiParts);
  const independence = avg(st.map(({ s, p }) => (s.hints.length ? 1 - (p?.hintsUsed ?? 0) / s.hints.length : 1)));
  const time = avg(st.map(({ s, p }) => (p ? (p.timeSec <= s.timeLimitSec ? 1 : p.timeSec <= s.timeLimitSec * 1.5 ? 0.6 : 0.3) : 0)));
  return [
    { k: 'Correctness', w: '30%', v: correctness, d: 'Stages answered correctly; partial credit for code stages and multi-selects.' },
    { k: 'Verification', w: '20%', v: verification, d: 'Ran tests before submitting; caught flaws in AI-written code.' },
    { k: 'AI usage', w: '15%', v: aiUsage, d: 'Rejected flawed AI output; prompts named files/symbols; did not prompt before reading.' },
    { k: 'Independence', w: '15%', v: independence, d: 'Fewer hints used.' },
    { k: 'Time management', w: '20%', v: time, d: 'Stages completed within their time budget.' },
  ];
}

export default function Scorecard({ problem, progress, result, mock, preset, metrics, totalSec, onRestart, onBack }: Props) {
  useThemeSync();
  const [open, setOpen] = useState<string | null>(null);
  const score = result?.score ?? progress?.score ?? 0;
  const rb = rubric(problem, progress, metrics);
  const delta = result?.delta ?? progress?.ratingDelta ?? 0;
  const t = result ? titleFor(result.newRating) : null;
  const verdict = score >= 0.85 ? 'Strong hire signal' : score >= 0.65 ? 'Hire signal' : score >= 0.45 ? 'Mixed signal' : 'Needs more practice';

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <button className="btn-subtle mb-4 !px-2" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <div className="card overflow-hidden">
          <div className="border-b border-line bg-panel-2 p-6">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <LevelBadge level={problem.level} full />
              <RatingPill rating={problem.rating} />
              {mock && <span className="chip">Mock interview · {preset}</span>}
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">{problem.title}</h1>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted">Score</div>
                <div className="text-3xl font-extrabold" style={{ color: score >= 0.65 ? 'var(--accent)' : score >= 0.45 ? 'var(--warn)' : 'var(--danger)' }}>{Math.round(score * 100)}%</div>
              </div>
              <div>
                <div className="text-xs text-muted">Rating change</div>
                <div className={clsx('flex items-center gap-1 text-3xl font-extrabold', delta > 0 ? 'text-accent' : delta < 0 ? 'text-danger' : 'text-muted')}>
                  {delta > 0 ? <TrendingUp size={22} /> : delta < 0 ? <TrendingDown size={22} /> : null}
                  {delta > 0 ? '+' : ''}{delta}
                </div>
                {result?.alreadyRated && <div className="text-[11px] text-faint">Already rated: replays don’t change rating</div>}
              </div>
              <div>
                <div className="text-xs text-muted">New rating</div>
                <div className="text-3xl font-extrabold">{result ? <RatingPill rating={result.newRating} className="!text-3xl" /> : '—'}</div>
                {t && <div className="text-[11px] font-semibold" style={{ color: t.color }}>{t.title}</div>}
              </div>
              <div>
                <div className="text-xs text-muted">Time</div>
                <div className="text-3xl font-extrabold">{fmtTime(progress ? Object.values(progress.stages).reduce((a, s) => a + s.timeSec, 0) || totalSec : totalSec)}</div>
              </div>
            </div>
            {mock && <div className="mt-4 flex items-center gap-2 text-sm font-semibold"><Trophy size={16} className="text-warn" /> Interviewer verdict: {verdict}</div>}
          </div>

          <div className="grid gap-6 p-6 md:grid-cols-2">
            <div>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Rubric</h2>
              <div className="space-y-3">
                {rb.map((r) => (
                  <div key={r.k}>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="font-semibold">{r.k} <span className="text-xs font-normal text-faint">{r.w}</span></span>
                      <span className="font-mono text-xs">{r.v === null ? 'n/a' : `${Math.round(r.v * 100)}%`}</span>
                    </div>
                    <ProgressBar value={r.v ?? 0} color={r.v === null ? 'var(--border)' : r.v >= 0.7 ? 'var(--accent)' : r.v >= 0.45 ? 'var(--warn)' : 'var(--danger)'} />
                    <div className="mt-0.5 text-[11px] text-faint">{r.d}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-line bg-bg-2 p-3 text-xs text-muted">
                Session: {metrics.filesOpened.size} files opened · {metrics.prompts} AI prompts{metrics.prompts ? ` (${metrics.promptsWithContext} with file/symbol context)` : ''} · tests run in {metrics.stagesRanTests} code stage(s)
              </div>
            </div>
            <div>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Stages {mock && '· explanations unlocked'}</h2>
              <div className="space-y-2">
                {problem.stages.map((s, i) => {
                  const p = progress?.stages[s.id];
                  return (
                    <div key={s.id} className="rounded-lg border border-line">
                      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(open === s.id ? null : s.id)}>
                        {p?.correct ? <CheckCircle2 size={16} className="shrink-0 text-accent" /> : <XCircle size={16} className="shrink-0 text-danger" />}
                        <span className="min-w-0 flex-1 truncate"><span className="text-faint">{i + 1}.</span> {s.title}</span>
                        <span className="chip">{STAGE_KIND_LABEL[s.kind]}</span>
                        <span className="w-10 text-right font-mono text-xs">{Math.round((p?.score ?? 0) * 100)}%</span>
                        <ChevronDown size={14} className={clsx('transition-transform', open === s.id && 'rotate-180')} />
                      </button>
                      {open === s.id && <div className="border-t border-line bg-bg-2 px-3 py-2"><Md>{s.explanation}</Md></div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line p-4">
            <button className="btn-ghost" onClick={onRestart}><RotateCcw size={15} /> Practise again</button>
            <button className="btn-primary ml-auto" onClick={onBack}>Continue</button>
          </div>
        </div>
      </div>
    </div>
  );
}
