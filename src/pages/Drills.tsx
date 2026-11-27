import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Terminal, ArrowRight, RotateCcw, CheckCircle2, XCircle, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { ALL_STAGES, LANG_LABEL, type StageRef } from '../content';
import type { PredictStage, ReviewAiStage, Level } from '../content/types';
import { PERSONAS } from '../content/personas';
import { useStore, isLevelUnlocked } from '../lib/store';
import { LevelBadge, Md, shuffle, hashStr } from '../components/ui';
import { Choice, ChoiceLabel } from '../stages/common';

type Mode = 'aiBug' | 'predict';

export default function Drills() {
  const { progress, rating, settings, drill, drillResult } = useStore();
  const [mode, setMode] = useState<Mode | null>(null);
  const [levels, setLevels] = useState<Level[]>([1, 2, 3]);
  const [count, setCount] = useState(5);
  const [deck, setDeck] = useState<StageRef[]>([]);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);

  const pool = (m: Mode) =>
    ALL_STAGES.filter(({ problem, stage }) =>
      levels.includes(problem.level) &&
      isLevelUnlocked(problem.level, progress, rating, settings.unlockAll) &&
      (m === 'aiBug' ? stage.kind === 'review-ai' : stage.kind === 'predict' && !!(stage as PredictStage).options),
    );

  const start = (m: Mode) => {
    const p = pool(m);
    setDeck(shuffle(p, Date.now() % 100000).slice(0, count));
    setMode(m);
    setI(0);
    setResults([]);
  };

  if (mode && deck.length && i < deck.length) {
    const ref = deck[i];
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-3">
          <button className="btn-subtle !px-2 text-xs" onClick={() => setMode(null)}>✕ Quit</button>
          <div className="flex flex-1 gap-1">
            {deck.map((_, k) => <div key={k} className={clsx('h-1.5 flex-1 rounded-full', k < results.length ? (results[k] ? 'bg-accent' : 'bg-danger') : k === i ? 'bg-fg/40' : 'bg-panel-2')} />)}
          </div>
          <span className="font-mono text-xs text-muted">{i + 1}/{deck.length}</span>
        </div>
        <DrillCard
          key={`${ref.problem.id}-${ref.stage.id}`}
          r={ref}
          onDone={(ok) => { drillResult(mode, ok); setResults((x) => [...x, ok]); }}
          onNext={() => setI(i + 1)}
        />
      </div>
    );
  }

  if (mode && results.length) {
    const right = results.filter(Boolean).length;
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        <div className="card p-8">
          <div className="text-sm text-muted">Drill complete</div>
          <div className="my-2 text-5xl font-extrabold" style={{ color: right / results.length >= 0.7 ? 'var(--accent)' : 'var(--warn)' }}>{right}/{results.length}</div>
          <div className="text-sm text-muted">{mode === 'aiBug' ? 'AI mistakes caught' : 'Outputs predicted'}</div>
          <div className="mt-6 flex justify-center gap-2">
            <button className="btn-primary" onClick={() => start(mode)}><RotateCcw size={15} /> Again</button>
            <button className="btn-ghost" onClick={() => setMode(null)}>Change drill</button>
          </div>
        </div>
      </div>
    );
  }

  const MODES: { m: Mode; icon: typeof Bot; title: string; desc: string; stat: { seen: number; correct: number } }[] = [
    { m: 'aiBug', icon: Bot, title: 'Spot the AI bug', desc: 'An assistant proposes a fix. Accept it, or name the flaw. Trains the #1 thing Canva/Meta grade: catching AI mistakes.', stat: drill.aiBug },
    { m: 'predict', icon: Terminal, title: 'Predict the output', desc: 'Flashcards from real functions: closures, aliasing, evaluation order, event loops, overflow.', stat: drill.predict },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Drills</h1>
        <p className="text-sm text-muted">5-minute micro-exercises. They don’t change your rating, but they do count toward your streak.</p>
      </div>
      <div className="card flex flex-wrap items-center gap-4 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-faint">Levels</span>
          {([1, 2, 3, 4, 5] as Level[]).map((l) => (
            <button key={l} onClick={() => setLevels(levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l])} className={clsx('rounded-md border px-2 py-1 text-xs font-semibold', levels.includes(l) ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted')}>L{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-xs text-faint">Cards</span>
          {[5, 10, 20].map((n) => <button key={n} onClick={() => setCount(n)} className={clsx('rounded-md border px-2 py-1 text-xs font-semibold', count === n ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted')}>{n}</button>)}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {MODES.map(({ m, icon: Icon, title, desc, stat }) => {
          const n = pool(m).length;
          return (
            <div key={m} className="card flex flex-col p-5">
              <Icon size={24} className="mb-3 text-accent" />
              <div className="text-lg font-bold">{title}</div>
              <div className="mt-1 flex-1 text-sm text-muted">{desc}</div>
              <div className="mt-4 flex items-center gap-3">
                <button className="btn-primary" disabled={!n} onClick={() => start(m)}>Start <ArrowRight size={15} /></button>
                <span className="text-xs text-faint">{n} cards available · lifetime {stat.correct}/{stat.seen}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CodeBlock({ path, code }: { path: string; code: string }) {
  const lines = code.replace(/\n$/, '').split('\n');
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-bg-2">
      <div className="border-b border-line px-3 py-1.5 font-mono text-[11px] text-muted">{path}</div>
      <pre className="max-h-[420px] overflow-auto py-2 font-mono text-xs leading-relaxed">
        {lines.map((l, k) => (
          <div key={k} className="flex"><span className="w-10 shrink-0 select-none pr-3 text-right text-faint">{k + 1}</span><span className="whitespace-pre pr-4">{l}</span></div>
        ))}
      </pre>
    </div>
  );
}

function DrillCard({ r, onDone, onNext }: { r: StageRef; onDone: (ok: boolean) => void; onNext: () => void }) {
  const { problem, stage } = r;
  const [pick, setPick] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [showCode, setShowCode] = useState(stage.kind === 'predict');
  const isPredict = stage.kind === 'predict';
  const ps = stage as PredictStage;
  const rs = stage as ReviewAiStage;
  const options = useMemo(() => {
    const raw = isPredict ? ps.options!.map((o) => ({ o, ok: o === ps.answer })) : rs.options.map((o, k) => ({ o, ok: k === rs.correct }));
    return shuffle(raw, hashStr(problem.id + stage.id));
  }, [r]);
  const files = problem.files.filter((f) => !f.hidden);
  const shown = isPredict ? files.filter((f) => f.path === (ps.entry ?? files[0].path) || !/\.(md|json|txt|csv)$/.test(f.path)).slice(0, 3) : files.filter((f) => f.path === stage.focusFile).concat(stage.focusFile ? [] : files.slice(0, 1));

  const submit = () => {
    if (pick == null) return;
    setDone(true);
    onDone(options[pick].ok);
  };

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <LevelBadge level={problem.level} />
        <span className="text-muted">{problem.title}</span>
        <span className="text-faint">· {LANG_LABEL[problem.lang]}</span>
        <Link to={`/p/${problem.id}`} className="ml-auto text-accent hover:underline">Open full problem</Link>
      </div>
      <Md>{stage.prompt}</Md>
      {!isPredict && (
        <div className="rounded-xl border border-line bg-bg-2">
          <div className="flex justify-end p-3"><div className="max-w-[90%] rounded-xl rounded-br-sm bg-accent/15 px-3 py-2 text-sm">{rs.request}</div></div>
          <div className="border-t border-line p-3">
            <div className="mb-1 text-xs font-semibold">{PERSONAS[rs.persona]?.emoji} {PERSONAS[rs.persona]?.name}</div>
            <Md>{rs.aiReply}</Md>
          </div>
        </div>
      )}
      <div>
        <button className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg" onClick={() => setShowCode(!showCode)}>
          <ChevronDown size={14} className={clsx('transition-transform', !showCode && '-rotate-90')} /> {isPredict ? 'Code' : 'Original code for context'}
        </button>
        {showCode && <div className="space-y-2">{shown.map((f) => <CodeBlock key={f.path} path={f.path} code={f.content} />)}</div>}
      </div>
      <div className="space-y-2">
        {options.map((o, k) => (
          <Choice key={k} selected={pick === k} onClick={() => !done && setPick(k)} state={done ? (o.ok ? 'correct' : pick === k ? 'wrong' : undefined) : undefined}>
            <ChoiceLabel text={o.o} />
          </Choice>
        ))}
      </div>
      {done ? (
        <div className="space-y-3">
          <div className={clsx('flex items-center gap-2 text-sm font-semibold', options[pick!].ok ? 'text-accent' : 'text-danger')}>
            {options[pick!].ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {options[pick!].ok ? 'Correct' : 'Not this time'}
          </div>
          <div className="rounded-lg border border-line bg-bg-2 p-3"><Md>{stage.explanation}</Md></div>
          <button className="btn-primary w-full" onClick={onNext}>Next <ArrowRight size={15} /></button>
        </div>
      ) : (
        <button className="btn-primary w-full" disabled={pick == null} onClick={submit}>Check</button>
      )}
    </div>
  );
}
