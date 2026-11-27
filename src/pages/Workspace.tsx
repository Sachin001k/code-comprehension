import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  ChevronLeft, FileCode2, Folder, Pencil, Clock, X, Terminal, ListTodo, Bot, NotebookPen, Check, RotateCcw,
  CheckCircle2, XCircle, ChevronDown, ChevronUp, Eye, FolderTree, Code2,
} from 'lucide-react';
import { PROBLEM_BY_ID, LANG_LABEL, COMPANY_LABEL } from '../content';
import { STAGE_KIND_LABEL, type PersonaId, type Stage } from '../content/types';
import { PERSONAS, PRESETS } from '../content/personas';
import { useStore } from '../lib/store';
import { stageScore } from '../lib/rating';
import { pushStages, submitRemote } from '../lib/auth';
import CodeEditor, { langForPath } from '../components/CodeEditor';
import AssistantPanel from '../components/AssistantPanel';
import { LevelBadge, Md, RatingPill, fmtTime } from '../components/ui';
import { ThemeToggle, useThemeSync } from '../components/Layout';
import { HintBox, StageResult, type ConsoleState, type StageCtx } from '../stages/common';
import { CodeView, FindBugView, McqView, PredictView, ReviewAiView, TraceView } from '../stages/StageViews';
import { warmRunner } from '../runner/client';
import Scorecard, { type SessionMetrics } from './Scorecard';

type RightTab = 'task' | 'ai' | 'notes';
type MobileTab = 'files' | 'code' | 'task' | 'ai' | 'notes';

export default function Workspace() {
  useThemeSync();
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const problem = PROBLEM_BY_ID[id];
  const preset = PRESETS.find((p) => p.id === sp.get('mock'));
  const mock = !!preset;

  const progress = useStore((s) => s.progress[id]);
  const buffers = useStore((s) => s.buffers[id]);
  const notes = useStore((s) => s.notes[id] ?? '');
  const rating = useStore((s) => s.rating);
  const { takeHint, recordWrong, completeStage, finishProblem, setBuffer, clearBuffers, setNotes, resetProblem } = useStore.getState();

  const visibleFiles = useMemo(() => problem?.files.filter((f) => !f.hidden) ?? [], [problem]);
  const firstOpen = problem ? (problem.stages[0].focusFile ?? visibleFiles[0]?.path) : '';

  const [stageIdx, setStageIdx] = useState(() => {
    if (!problem) return 0;
    if (mock) return 0;
    const i = problem.stages.findIndex((s) => !progress?.stages[s.id]?.done);
    return i === -1 ? problem.stages.length - 1 : i;
  });
  const [showScore, setShowScore] = useState(() => !mock && !!progress?.completed && problem?.stages.every((s) => progress.stages[s.id]?.done));
  const [tabs, setTabs] = useState<string[]>(firstOpen ? [firstOpen] : []);
  const [active, setActive] = useState(firstOpen);
  const [rightTab, setRightTab] = useState<RightTab>('task');
  const [mobileTab, setMobileTab] = useState<MobileTab>('task');
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [consoleState, setConsoleState] = useState<ConsoleState>({});
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [ranTests, setRanTests] = useState(false);
  const [persona, setPersona] = useState<PersonaId>(preset ? (preset.personas[0] ?? 'helpful-senior') : problem?.persona ?? 'helpful-senior');
  const [stageStart, setStageStart] = useState(() => Date.now());
  const [sessionStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<{ score: number; delta: number; newRating: number; alreadyRated: boolean } | null>(null);
  const metrics = useRef<SessionMetrics>({ prompts: 0, promptsWithContext: 0, earlyPrompts: 0, filesOpened: new Set(firstOpen ? [firstOpen] : []), stagesRanTests: 0 });
  const mockInit = useRef(false);

  // Mock interviews always start fresh.
  useEffect(() => {
    if (mock && problem && !mockInit.current) {
      mockInit.current = true;
      resetProblem(id);
      clearBuffers(id);
    }
  }, [mock, id]);

  useEffect(() => { if (problem) warmRunner(problem.lang); }, [problem?.lang]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const stage: Stage | undefined = problem?.stages[stageIdx];
  const sp_ = stage ? progress?.stages[stage.id] : undefined;
  const stageDone = !!sp_?.done;

  const fileContents = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of problem?.files ?? []) if (!f.hidden) m[f.path] = buffers?.[f.path] ?? f.content;
    return m;
  }, [problem, buffers]);

  const openFile = useCallback((path: string) => {
    if (!problem?.files.some((f) => f.path === path)) return;
    metrics.current.filesOpened.add(path);
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActive(path);
    setMobileTab((m) => (m === 'files' ? 'code' : m));
  }, [problem]);

  // On stage change: focus file, reset per-stage UI.
  useEffect(() => {
    if (!stage) return;
    setSelectedLine(null);
    setRanTests(false);
    setStageStart(Date.now());
    if (stage.focusFile) openFile(stage.focusFile);
    if (stage.kind !== 'code') setConsoleOpen(false);
  }, [stage?.id]);

  const elapsed = (now - stageStart) / 1000;
  const totalElapsed = (now - sessionStart) / 1000;
  const mockRemaining = preset ? preset.minutes * 60 - totalElapsed : null;

  const finish = useCallback(async () => {
    const r = finishProblem(id);
    setResult(r);
    setShowScore(true);
    const remote = await submitRemote(id, r.score, totalElapsed, mock ? 'mock' : 'practice');
    if (remote) {
      useStore.setState({ rating: remote.rating });
      setResult({ score: r.score, delta: remote.delta, newRating: remote.rating, alreadyRated: remote.alreadyRated });
    }
  }, [id, totalElapsed, mock]);

  // Mock: time's up -> close remaining stages with 0.
  useEffect(() => {
    if (!problem || mockRemaining === null || mockRemaining > 0 || showScore) return;
    for (const s of problem.stages) {
      if (!useStore.getState().progress[id]?.stages[s.id]?.done) completeStage(id, s.id, { correct: false, score: 0, revealed: false, timeSec: 0 });
    }
    void finish();
  }, [mockRemaining !== null && mockRemaining <= 0]);

  if (!problem || !stage) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-muted">
        Problem not found. <Link to="/problems" className="btn-ghost">Back to problems</Link>
      </div>
    );
  }

  const hintsUsed = sp_?.hintsUsed ?? 0;
  const editable = stage.kind === 'code' && !stageDone ? stage.editable : [];

  const complete: StageCtx['complete'] = (r) => {
    const cur = useStore.getState().progress[id]?.stages[stage.id];
    const wrongAttempts = cur?.wrongAttempts ?? 0;
    let score = stageScore({ correct: r.correct, wrongAttempts, hintsUsed, overTime: elapsed > stage.timeLimitSec * 1.25, revealed: !!r.revealed, partial: r.partial });
    if (stage.kind === 'code' && r.correct && !r.ranTests) score = Math.max(0, score - 0.1);
    if (stage.kind === 'code' && r.ranTests) metrics.current.stagesRanTests++;
    completeStage(id, stage.id, { correct: r.correct, score, revealed: !!r.revealed, timeSec: Math.round(elapsed), ranTests: r.ranTests, answer: r.answer });
    if (stage.kind === 'find-bug' && !mock) setSelectedLine(null);
    void pushStages(id);
    if (mock) next();
  };

  const next = () => {
    const ni = problem.stages.findIndex((s, i) => i > stageIdx && !useStore.getState().progress[id]?.stages[s.id]?.done);
    if (ni === -1) {
      const allDone = problem.stages.every((s) => useStore.getState().progress[id]?.stages[s.id]?.done);
      if (allDone) void finish();
      else setStageIdx(problem.stages.findIndex((s) => !useStore.getState().progress[id]?.stages[s.id]?.done));
    } else setStageIdx(ni);
    setRightTab('task');
    setMobileTab('task');
  };

  const ctx: StageCtx = {
    problem, stage, files: fileContents, progress: sp_, mock, elapsedSec: elapsed,
    selectedLine, setSelectedLine, openFile, complete,
    wrong: () => recordWrong(id, stage.id),
    setConsole: (c) => { setConsoleState(c); setConsoleOpen(true); },
    ranTests, setRanTests,
  };

  const onPrompt = (text: string) => {
    const m = metrics.current;
    m.prompts++;
    if (problem.files.some((f) => text.includes(f.path.split('/').pop()!)) || /[A-Za-z_]+\(|`/.test(text)) m.promptsWithContext++;
    if (elapsed < 20 && m.filesOpened.size <= 1) m.earlyPrompts++;
  };

  const restart = () => {
    resetProblem(id);
    clearBuffers(id);
    setStageIdx(0);
    setShowScore(false);
    setResult(null);
    setTabs(firstOpen ? [firstOpen] : []);
    setActive(firstOpen);
    setStageStart(Date.now());
  };

  const loadSolution = () => {
    if (stage.kind !== 'code') return;
    for (const [p, c] of Object.entries(stage.solution)) setBuffer(id, p, c);
    openFile(Object.keys(stage.solution)[0]);
  };

  const activeFile = problem.files.find((f) => f.path === active);
  const findBugFile = stage.kind === 'find-bug' ? stage.file : null;
  const allowedPersonas = preset ? preset.personas : null;
  const overTime = elapsed > stage.timeLimitSec;

  /* ---------------- panels ---------------- */
  const explorer = (
    <FileTree files={visibleFiles.map((f) => f.path)} active={active} editable={editable} modified={Object.keys(buffers ?? {}).filter((p) => buffers![p] !== problem.files.find((f) => f.path === p)?.content)} onOpen={openFile} />
  );

  const editor = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-bg-2">
        {tabs.map((t) => (
          <div key={t} className={clsx('group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-line px-3 text-xs', t === active ? 'bg-panel text-fg' : 'text-muted hover:text-fg')} onClick={() => setActive(t)}>
            <FileCode2 size={13} className={editable.includes(t) ? 'text-accent' : 'text-faint'} />
            <span className="font-mono">{t.split('/').pop()}</span>
            {editable.includes(t) && <Pencil size={11} className="text-accent" />}
            <button
              className="ml-1 rounded p-0.5 opacity-0 hover:bg-panel-2 group-hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); const n = tabs.filter((x) => x !== t); setTabs(n); if (active === t) setActive(n[n.length - 1] ?? ''); }}
              aria-label={`Close ${t}`}
            ><X size={11} /></button>
          </div>
        ))}
      </div>
      {activeFile && (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-[11px] text-muted">
          <span className="truncate font-mono">{activeFile.path}</span>
          {editable.includes(activeFile.path) ? <span className="text-accent">editable</span> : <span className="text-faint">read-only</span>}
          {findBugFile === activeFile.path && !stageDone && <span className="ml-auto text-warn">Click a line to select it</span>}
          {editable.includes(activeFile.path) && buffers?.[activeFile.path] !== undefined && buffers[activeFile.path] !== activeFile.content && (
            <button className="ml-auto flex items-center gap-1 text-muted hover:text-fg" onClick={() => setBuffer(id, activeFile.path, activeFile.content)}><RotateCcw size={11} /> reset file</button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {activeFile ? (
          <CodeEditor
            path={`${problem.id}/${activeFile.path}`}
            value={fileContents[activeFile.path] ?? activeFile.content}
            language={activeFile.language && !['javascript', 'typescript', 'python', 'java', 'cpp'].includes(activeFile.language) ? activeFile.language === 'text' ? 'plaintext' : activeFile.language : langForPath(activeFile.path, problem.lang)}
            readOnly={!editable.includes(activeFile.path)}
            onChange={(v) => editable.includes(activeFile.path) && setBuffer(id, activeFile.path, v)}
            onLineClick={findBugFile === activeFile.path && !stageDone ? (l) => setSelectedLine(l) : undefined}
            selectedLines={findBugFile === activeFile.path && selectedLine ? [selectedLine] : []}
            correctLines={stage.kind === 'find-bug' && stageDone && !mock && stage.file === activeFile.path ? stage.lines : []}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">Open a file from the explorer</div>
        )}
      </div>
      <ConsolePanel state={consoleState} open={consoleOpen} setOpen={setConsoleOpen} />
    </div>
  );

  const task = (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      {stageIdx === 0 && problem.context && !stageDone && (
        <div className="mb-4 rounded-lg border border-info/30 bg-info/5 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-info">Briefing</div>
          <Md>{problem.context}</Md>
        </div>
      )}
      <div className="mb-1 flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold uppercase tracking-wide">Stage {stageIdx + 1}/{problem.stages.length}</span>
        <span>·</span>
        <span>{STAGE_KIND_LABEL[stage.kind]}</span>
        <span className={clsx('ml-auto flex items-center gap-1 font-mono', overTime && !stageDone ? 'text-warn' : '')}>
          <Clock size={12} /> {fmtTime(stageDone ? sp_!.timeSec : elapsed)} / {fmtTime(stage.timeLimitSec)}
        </span>
      </div>
      <h2 className="mb-2 text-lg font-bold tracking-tight">{stage.title}</h2>
      <Md className="mb-4">{stage.prompt}</Md>
      {stageDone ? (
        <div className="space-y-3">
          <StageResult sp={sp_!} stage={stage} mock={mock} isLast={problem.stages.every((s) => progress?.stages[s.id]?.done)} onNext={next} />
          {stage.kind === 'code' && !mock && (
            <button className="btn-ghost w-full text-xs" onClick={loadSolution}><Eye size={14} /> Load reference solution into editor</button>
          )}
          {stage.kind === 'find-bug' && !mock && <div className="text-xs text-muted">Correct line{stage.lines.length > 1 ? 's' : ''}: <span className="font-mono">{stage.file}:{stage.lines.join(', ')}</span> (highlighted green)</div>}
          {(stage.kind === 'predict') && !mock && <div className="rounded-lg border border-line bg-bg-2 p-2"><div className="mb-1 text-[11px] text-muted">Actual output</div><pre className="whitespace-pre-wrap font-mono text-xs">{stage.answer}</pre></div>}
          {stage.kind === 'trace' && !mock && <ol className="list-decimal space-y-0.5 pl-5 font-mono text-xs text-muted">{stage.items.map((x) => <li key={x}>{x}</li>)}</ol>}
          {(stage.kind === 'mcq' || stage.kind === 'review-ai') && !mock && (
            <div className="text-xs text-muted">Correct: {(stage.kind === 'mcq' ? stage.correct : [stage.correct]).map((i) => <div key={i} className="mt-1 rounded border border-accent/30 bg-accent/5 px-2 py-1 text-fg"><Md className="[&_p]:my-0">{stage.options[i]}</Md></div>)}</div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <StageBody ctx={ctx} />
          <HintBox stage={stage} used={hintsUsed} onTake={() => takeHint(id, stage.id)} disabled={mock} />
        </div>
      )}
    </div>
  );

  const ai = (
    <AssistantPanel
      problem={problem} stage={stage} files={fileContents} openFile={active}
      persona={persona} setPersona={setPersona}
      allowed={allowedPersonas} switching={!preset || preset.modelSwitching}
      revealFlaws={stageDone && !mock} onPrompt={onPrompt}
    />
  );

  const notesPanel = (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 text-xs text-muted">Scratchpad: build your mental model. Entry points, key modules, invariants, suspicious lines. Saved locally.</div>
      <textarea className="input flex-1 resize-none font-mono text-xs leading-relaxed" placeholder={'Entry point: ...\nRequest flow: controller -> service -> repo\nInvariants: ...\nSuspicious: time.ts:5'} value={notes} onChange={(e) => setNotes(id, e.target.value)} />
    </div>
  );

  if (showScore) {
    return (
      <Scorecard
        problem={problem} progress={useStore.getState().progress[id]} result={result} mock={mock} preset={preset?.name}
        metrics={metrics.current} totalSec={totalElapsed} onRestart={restart} onBack={() => nav(mock ? '/mock' : '/problems')}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-bg">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <Link to={mock ? '/mock' : '/problems'} className="btn-subtle !px-1.5" aria-label="Back"><ChevronLeft size={18} /></Link>
        <div className="flex min-w-0 items-center gap-2">
          <LevelBadge level={problem.level} />
          <span className="truncate text-sm font-semibold">{problem.title}</span>
          <span className="hidden font-mono text-xs text-faint sm:inline">{LANG_LABEL[problem.lang]}</span>
          <RatingPill rating={problem.rating} className="hidden sm:inline-flex" />
        </div>
        <Stepper stages={problem.stages} idx={stageIdx} done={(s) => !!progress?.stages[s.id]?.done} correct={(s) => !!progress?.stages[s.id]?.correct} onPick={(i) => !mock && setStageIdx(i)} mock={mock} />
        <div className="ml-auto flex items-center gap-2">
          {preset && (
            <span className={clsx('flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs font-bold', (mockRemaining ?? 0) < 300 ? 'border-danger/50 text-danger' : 'border-line text-fg')}>
              <Clock size={13} /> {fmtTime(mockRemaining ?? 0)}
            </span>
          )}
          {preset && <span className="hidden chip md:inline-flex">Mock · {preset.name}</span>}
          <span className="hidden text-xs text-muted lg:inline">You <RatingPill rating={rating} /></span>
          <ThemeToggle />
        </div>
      </header>

      {/* Desktop: 3 panels */}
      <div className="hidden min-h-0 flex-1 lg:flex">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-line bg-panel">{explorer}</aside>
        <section className="min-w-0 flex-1">{editor}</section>
        <aside className="flex w-[420px] shrink-0 flex-col border-l border-line bg-panel xl:w-[460px]">
          <div className="flex h-9 shrink-0 border-b border-line">
            <RTab icon={ListTodo} label="Task" on={rightTab === 'task'} onClick={() => setRightTab('task')} />
            <RTab icon={Bot} label={allowedPersonas?.length === 0 ? 'No AI' : `AI · ${PERSONAS[persona].name}`} on={rightTab === 'ai'} onClick={() => setRightTab('ai')} />
            <RTab icon={NotebookPen} label="Notes" on={rightTab === 'notes'} onClick={() => setRightTab('notes')} />
          </div>
          <div className="min-h-0 flex-1">
            <div className={rightTab === 'task' ? 'h-full' : 'hidden'}>{task}</div>
            <div className={rightTab === 'ai' ? 'h-full' : 'hidden'}>{ai}</div>
            <div className={rightTab === 'notes' ? 'h-full' : 'hidden'}>{notesPanel}</div>
          </div>
        </aside>
      </div>

      {/* Mobile/tablet: one panel at a time */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="min-h-0 flex-1">
          <div className={mobileTab === 'files' ? 'h-full overflow-y-auto bg-panel' : 'hidden'}>{explorer}</div>
          <div className={mobileTab === 'code' ? 'h-full' : 'hidden'}>{editor}</div>
          <div className={mobileTab === 'task' ? 'h-full bg-panel' : 'hidden'}>{task}</div>
          <div className={mobileTab === 'ai' ? 'h-full bg-panel' : 'hidden'}>{ai}</div>
          <div className={mobileTab === 'notes' ? 'h-full bg-panel' : 'hidden'}>{notesPanel}</div>
        </div>
        <nav className="grid h-14 shrink-0 grid-cols-5 border-t border-line bg-panel">
          {([['files', FolderTree, 'Files'], ['code', Code2, 'Code'], ['task', ListTodo, 'Task'], ['ai', Bot, 'AI'], ['notes', NotebookPen, 'Notes']] as const).map(([k, Icon, label]) => (
            <button key={k} onClick={() => setMobileTab(k)} className={clsx('flex flex-col items-center justify-center gap-0.5 text-[11px]', mobileTab === k ? 'text-accent' : 'text-muted')}>
              <Icon size={17} /> {label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function StageBody({ ctx }: { ctx: StageCtx }) {
  const s = ctx.stage;
  switch (s.kind) {
    case 'predict': return <PredictView key={s.id} ctx={ctx} stage={s} />;
    case 'find-bug': return <FindBugView key={s.id} ctx={ctx} stage={s} />;
    case 'mcq': return <McqView key={s.id} ctx={ctx} stage={s} />;
    case 'trace': return <TraceView key={s.id} ctx={ctx} stage={s} />;
    case 'review-ai': return <ReviewAiView key={s.id} ctx={ctx} stage={s} />;
    case 'code': return <CodeView key={s.id} ctx={ctx} stage={s} />;
  }
}

function RTab({ icon: Icon, label, on, onClick }: { icon: typeof Bot; label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={clsx('flex min-w-0 items-center gap-1.5 border-b-2 px-3 text-xs font-semibold', on ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}>
      <Icon size={14} className="shrink-0" /> <span className="truncate">{label}</span>
    </button>
  );
}

function Stepper({ stages, idx, done, correct, onPick, mock }: { stages: Stage[]; idx: number; done: (s: Stage) => boolean; correct: (s: Stage) => boolean; onPick: (i: number) => void; mock: boolean }) {
  return (
    <div className="mx-2 hidden items-center gap-1 md:flex">
      {stages.map((s, i) => (
        <button
          key={s.id}
          title={`${i + 1}. ${s.title} (${STAGE_KIND_LABEL[s.kind]})`}
          onClick={() => onPick(i)}
          disabled={mock}
          className={clsx(
            'flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 text-[11px] font-bold transition-colors',
            i === idx ? 'border-accent text-accent' : 'border-line text-muted',
            done(s) && !mock && (correct(s) ? 'bg-accent/15' : 'bg-danger/10'),
            done(s) && mock && 'bg-panel-2',
          )}
        >
          {done(s) && !mock ? correct(s) ? <Check size={12} /> : <X size={12} /> : i + 1}
        </button>
      ))}
    </div>
  );
}

function FileTree({ files, active, editable, modified, onOpen }: { files: string[]; active: string; editable: string[]; modified: string[]; onOpen: (p: string) => void }) {
  // Build a nested tree from paths.
  type Node = { name: string; path: string; children: Map<string, Node>; file: boolean };
  const root: Node = { name: '', path: '', children: new Map(), file: false };
  for (const f of files) {
    let cur = root;
    f.split('/').forEach((part, i, arr) => {
      const path = arr.slice(0, i + 1).join('/');
      if (!cur.children.has(part)) cur.children.set(part, { name: part, path, children: new Map(), file: i === arr.length - 1 });
      cur = cur.children.get(part)!;
    });
  }
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const render = (n: Node, depth: number): React.ReactNode =>
    [...n.children.values()]
      .sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name))
      .map((c) =>
        c.file ? (
          <button key={c.path} onClick={() => onOpen(c.path)} style={{ paddingLeft: 10 + depth * 12 }} className={clsx('flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs', c.path === active ? 'bg-accent/10 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg')}>
            <FileCode2 size={13} className={editable.includes(c.path) ? 'shrink-0 text-accent' : 'shrink-0 text-faint'} />
            <span className="truncate font-mono">{c.name}</span>
            {modified.includes(c.path) && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="modified" />}
          </button>
        ) : (
          <div key={c.path}>
            <button onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(c.path)) n.delete(c.path); else n.add(c.path); return n; })} style={{ paddingLeft: 10 + depth * 12 }} className="flex w-full items-center gap-1.5 py-1 text-left text-xs font-semibold text-muted hover:text-fg">
              <Folder size={13} className="shrink-0 text-info" /> {c.name}
            </button>
            {!closed.has(c.path) && render(c, depth + 1)}
          </div>
        ),
      );
  return (
    <div className="py-2">
      <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-faint">Explorer · {files.length} files</div>
      {render(root, 0)}
    </div>
  );
}

function ConsolePanel({ state, open, setOpen }: { state: ConsoleState; open: boolean; setOpen: (b: boolean) => void }) {
  const passed = state.results?.filter((r) => r.passed).length ?? 0;
  const total = state.results?.length ?? 0;
  return (
    <div className={clsx('shrink-0 border-t border-line bg-panel', open ? 'h-56' : 'h-8')}>
      <button className="flex h-8 w-full items-center gap-2 px-3 text-xs font-semibold text-muted hover:text-fg" onClick={() => setOpen(!open)}>
        <Terminal size={13} /> Console
        {state.running && <span className="text-info">running…</span>}
        {!state.running && total > 0 && <span className={passed === total ? 'text-accent' : 'text-danger'}>{passed}/{total} passed</span>}
        {!state.running && state.error && <span className="truncate text-danger">error</span>}
        {state.durationMs !== undefined && !state.running && <span className="font-mono font-normal text-faint">{Math.round(state.durationMs)} ms</span>}
        <span className="ml-auto">{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
      </button>
      {open && (
        <div className="h-48 overflow-y-auto px-3 pb-3 font-mono text-xs">
          {state.running && <div className="text-muted">{state.title}</div>}
          {state.error && <div className="mb-2 whitespace-pre-wrap text-danger">{state.error}</div>}
          {state.results?.map((r, i) => (
            <div key={i} className="py-0.5">
              <div className="flex items-center gap-1.5">
                {r.passed ? <CheckCircle2 size={12} className="text-accent" /> : <XCircle size={12} className="text-danger" />}
                <span className={r.passed ? 'text-fg' : 'text-danger'}>{r.name}</span>
                <span className="text-faint">{r.durationMs.toFixed(0)}ms</span>
              </div>
              {r.error && <div className="ml-5 whitespace-pre-wrap text-muted">{r.error}</div>}
            </div>
          ))}
          {!!state.logs?.length && (
            <div className="mt-2 border-t border-line pt-2">
              <div className="mb-1 text-faint">stdout</div>
              {state.logs.slice(0, 200).map((l, i) => <div key={i} className="whitespace-pre-wrap text-muted">{l}</div>)}
            </div>
          )}
          {!state.running && !state.results && !state.error && <div className="text-faint">Run tests to see results here.</div>}
        </div>
      )}
    </div>
  );
}

export { COMPANY_LABEL };
