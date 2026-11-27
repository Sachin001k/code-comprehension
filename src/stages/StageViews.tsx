import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, MousePointerClick, Play, FlaskConical } from 'lucide-react';
import type { CodeStage, FindBugStage, McqStage, PredictStage, ReviewAiStage, TraceStage } from '../content/types';
import { PERSONAS } from '../content/personas';
import { Md, shuffle, hashStr } from '../components/ui';
import { runTests } from '../runner/client';
import { Choice, ChoiceLabel, Feedback, SubmitRow, normAnswer, type StageCtx } from './common';

/* ------------------------------------------------------------------ predict */
export function PredictView({ ctx, stage }: { ctx: StageCtx; stage: PredictStage }) {
  const [val, setVal] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const opts = useMemo(() => (stage.options ? shuffle(stage.options, hashStr(ctx.problem.id + stage.id)) : null), [stage]);

  const submit = () => {
    const ans = opts ? pick ?? '' : val;
    const ok = opts ? ans === stage.answer : normAnswer(ans) === normAnswer(stage.answer);
    if (ok) return ctx.complete({ correct: true, answer: ans });
    if (ctx.mock) return ctx.complete({ correct: false, answer: ans });
    ctx.wrong();
    setMsg('Not quite. Re-trace the execution carefully. Check the evaluation order and what each line returns.');
  };

  return (
    <div className="space-y-3">
      {stage.entry && <div className="text-xs text-muted">Program entry: <button className="font-mono text-accent hover:underline" onClick={() => ctx.openFile(stage.entry!)}>{stage.entry}</button></div>}
      {opts ? (
        <div className="space-y-2">
          {opts.map((o) => <Choice key={o} selected={pick === o} onClick={() => { setPick(o); setMsg(null); }}><ChoiceLabel text={o} /></Choice>)}
        </div>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Exact output</label>
          <textarea className="input min-h-[84px] font-mono" placeholder="Type what the program prints…" value={val} onChange={(e) => { setVal(e.target.value); setMsg(null); }} />
          <div className="mt-1 text-[11px] text-faint">Whitespace and letter case are normalised.</div>
        </div>
      )}
      {msg && <Feedback kind="bad">{msg}</Feedback>}
      <SubmitRow mock={ctx.mock} disabled={opts ? !pick : !val.trim()} onSubmit={submit} onReveal={() => ctx.complete({ correct: false, revealed: true })} />
    </div>
  );
}

/* ------------------------------------------------------------------ find bug */
export function FindBugView({ ctx, stage }: { ctx: StageCtx; stage: FindBugStage }) {
  const [pick, setPick] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const opts = useMemo(() => shuffle(stage.options.map((o, i) => ({ o, i })), hashStr(stage.id + ctx.problem.id)), [stage]);
  useEffect(() => { ctx.openFile(stage.file); }, [stage.id]);

  const submit = () => {
    const lineOk = ctx.selectedLine != null && stage.lines.includes(ctx.selectedLine);
    const causeOk = pick === stage.correct;
    if (lineOk && causeOk) return ctx.complete({ correct: true, answer: { line: ctx.selectedLine, pick } });
    if (ctx.mock) return ctx.complete({ correct: false, partial: lineOk || causeOk ? 0.4 : 0, answer: { line: ctx.selectedLine, pick } });
    ctx.wrong();
    setMsg(lineOk ? 'Right line, but that is not the root cause.' : causeOk ? 'Right idea, but that is not the line where the bug lives.' : 'Neither the line nor the cause is right yet.');
  };

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${ctx.selectedLine ? 'border-warn/50 bg-warn/10' : 'border-dashed border-line-strong'}`}>
        <MousePointerClick size={16} className="text-warn" />
        {ctx.selectedLine ? (
          <span>Selected <span className="font-mono font-semibold">{stage.file}:{ctx.selectedLine}</span></span>
        ) : (
          <span className="text-muted">Click the buggy line in <button className="font-mono text-accent hover:underline" onClick={() => ctx.openFile(stage.file)}>{stage.file}</button></span>
        )}
      </div>
      <div className="text-xs font-medium text-muted">Root cause</div>
      <div className="space-y-2">
        {opts.map(({ o, i }) => <Choice key={i} selected={pick === i} onClick={() => { setPick(i); setMsg(null); }}><ChoiceLabel text={o} /></Choice>)}
      </div>
      {msg && <Feedback kind="bad">{msg}</Feedback>}
      <SubmitRow mock={ctx.mock} disabled={pick == null || ctx.selectedLine == null} onSubmit={submit} onReveal={() => ctx.complete({ correct: false, revealed: true })} />
    </div>
  );
}

/* ------------------------------------------------------------------ mcq */
export function McqView({ ctx, stage }: { ctx: StageCtx; stage: McqStage }) {
  const multi = stage.correct.length > 1;
  const [sel, setSel] = useState<number[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const opts = useMemo(() => shuffle(stage.options.map((o, i) => ({ o, i })), hashStr(stage.id + ctx.problem.id)), [stage]);
  const toggle = (i: number) => { setMsg(null); setSel(multi ? (sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]) : [i]); };

  const submit = () => {
    const ok = sel.length === stage.correct.length && stage.correct.every((c) => sel.includes(c));
    if (ok) return ctx.complete({ correct: true, answer: sel });
    if (ctx.mock) {
      const hit = sel.filter((s) => stage.correct.includes(s)).length - sel.filter((s) => !stage.correct.includes(s)).length;
      return ctx.complete({ correct: false, partial: multi ? Math.max(0, hit / stage.correct.length) * 0.6 : 0, answer: sel });
    }
    ctx.wrong();
    setMsg(multi ? 'Not quite: check each option independently against the code.' : 'Not quite. Look again.');
  };

  return (
    <div className="space-y-3">
      {multi && <div className="text-xs font-medium text-warn">Select all that apply</div>}
      <div className="space-y-2">
        {opts.map(({ o, i }) => <Choice key={i} multi={multi} selected={sel.includes(i)} onClick={() => toggle(i)}><ChoiceLabel text={o} /></Choice>)}
      </div>
      {msg && <Feedback kind="bad">{msg}</Feedback>}
      <SubmitRow mock={ctx.mock} disabled={!sel.length} onSubmit={submit} onReveal={() => ctx.complete({ correct: false, revealed: true })} />
    </div>
  );
}

/* ------------------------------------------------------------------ trace */
export function TraceView({ ctx, stage }: { ctx: StageCtx; stage: TraceStage }) {
  const initial = useMemo(() => {
    let s = shuffle(stage.items, hashStr(stage.id + ctx.problem.id));
    if (s.every((x, i) => x === stage.items[i])) s = [...s.slice(1), s[0]];
    return s;
  }, [stage]);
  const [order, setOrder] = useState(initial);
  const [drag, setDrag] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const n = order.slice();
    const [x] = n.splice(from, 1);
    n.splice(to, 0, x);
    setOrder(n);
    setMsg(null);
  };

  const submit = () => {
    const right = order.filter((x, i) => x === stage.items[i]).length;
    if (right === order.length) return ctx.complete({ correct: true, answer: order });
    if (ctx.mock) return ctx.complete({ correct: false, partial: (right / order.length) * 0.6, answer: order });
    ctx.wrong();
    setMsg(`${right}/${order.length} steps are in the right position.`);
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted">Drag (or use the arrows) to put the steps in execution order. First step on top.</div>
      <ol className="space-y-1.5">
        {order.map((it, i) => (
          <li
            key={it}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { move(drag, i); setDrag(i); } }}
            onDragEnd={() => setDrag(null)}
            className={`flex items-center gap-2 rounded-lg border bg-bg-2 px-2 py-2 text-sm ${drag === i ? 'border-accent' : 'border-line'}`}
          >
            <GripVertical size={14} className="shrink-0 cursor-grab text-faint" />
            <span className="w-5 shrink-0 font-mono text-xs text-faint">{i + 1}</span>
            <span className="min-w-0 flex-1 break-words font-mono text-xs">{it}</span>
            <button className="btn-subtle !p-1" onClick={() => move(i, i - 1)} aria-label="Move up"><ArrowUp size={13} /></button>
            <button className="btn-subtle !p-1" onClick={() => move(i, i + 1)} aria-label="Move down"><ArrowDown size={13} /></button>
          </li>
        ))}
      </ol>
      {msg && <Feedback kind="bad">{msg}</Feedback>}
      <SubmitRow mock={ctx.mock} onSubmit={submit} onReveal={() => ctx.complete({ correct: false, revealed: true })} />
    </div>
  );
}

/* ------------------------------------------------------------------ review AI */
export function ReviewAiView({ ctx, stage }: { ctx: StageCtx; stage: ReviewAiStage }) {
  const [pick, setPick] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const persona = PERSONAS[stage.persona] ?? PERSONAS['confident-intern'];
  const opts = useMemo(() => shuffle(stage.options.map((o, i) => ({ o, i })), hashStr(stage.id + ctx.problem.id)), [stage]);

  const submit = () => {
    if (pick === stage.correct) return ctx.complete({ correct: true, answer: pick });
    if (ctx.mock) return ctx.complete({ correct: false, answer: pick });
    ctx.wrong();
    setMsg('Not quite. Compare the suggestion line by line with the original code, and think about the edge cases.');
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-bg-2">
        <div className="flex justify-end p-3">
          <div className="max-w-[90%] rounded-xl rounded-br-sm bg-accent/15 px-3 py-2 text-sm">{stage.request}</div>
        </div>
        <div className="border-t border-line p-3">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold">
            <span>{persona.emoji}</span> {persona.name}
            <span className="font-normal text-faint">· {persona.behaviour}</span>
          </div>
          <Md className="[&_pre]:max-h-80">{stage.aiReply}</Md>
        </div>
      </div>
      <div className="text-xs font-medium text-muted">Your verdict</div>
      <div className="space-y-2">
        {opts.map(({ o, i }) => <Choice key={i} selected={pick === i} onClick={() => { setPick(i); setMsg(null); }}><ChoiceLabel text={o} /></Choice>)}
      </div>
      {msg && <Feedback kind="bad">{msg}</Feedback>}
      <SubmitRow mock={ctx.mock} disabled={pick == null} onSubmit={submit} onReveal={() => ctx.complete({ correct: false, revealed: true })} />
    </div>
  );
}

/* ------------------------------------------------------------------ code */
export function CodeView({ ctx, stage }: { ctx: StageCtx; stage: CodeStage }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  useEffect(() => { ctx.openFile(stage.focusFile ?? stage.editable[0]); }, [stage.id]);

  const exec = async () => {
    const tests = Object.fromEntries(stage.tests.map((t) => [t.path, t.content]));
    ctx.setConsole({ running: true, title: ctx.problem.lang === 'python' ? 'Running tests (Python runtime loads on first run)…' : 'Running tests…' });
    const out = await runTests(ctx.problem.lang, ctx.files, tests, stage.timeoutMs ?? 4000);
    ctx.setConsole({ ...out, title: 'Test results' });
    return out;
  };

  const run = async () => {
    setBusy(true);
    setMsg(null);
    await exec();
    ctx.setRanTests(true);
    setBusy(false);
  };

  const submit = async () => {
    setBusy(true);
    const out = await exec();
    setBusy(false);
    const total = out.results.length;
    const passed = out.results.filter((r) => r.passed).length;
    const all = !out.error && total > 0 && passed === total;
    if (all) return ctx.complete({ correct: true, ranTests: ctx.ranTests });
    if (ctx.mock) return ctx.complete({ correct: false, partial: total ? (passed / total) * 0.8 : 0, ranTests: ctx.ranTests });
    ctx.wrong();
    setMsg({ kind: 'bad', text: out.error ? `Run failed: ${out.error}` : `${passed}/${total} hidden tests pass. Read the failures in the console.` });
  };

  const taskLabel = { fix: 'Fix', feature: 'Feature', optimise: 'Optimise', refactor: 'Refactor' }[stage.task];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="chip">{taskLabel}</span>
        Editable:
        {stage.editable.map((p) => <button key={p} className="font-mono text-accent hover:underline" onClick={() => ctx.openFile(p)}>{p}</button>)}
        {stage.timeoutMs && <span className="chip">⏱ {stage.timeoutMs} ms budget</span>}
      </div>
      <div className="text-xs text-faint">Hidden tests: {stage.tests.length} file(s). Run them as often as you like. Interviewers reward verifying before submitting.</div>
      {msg && <Feedback kind={msg.kind}>{msg.text}</Feedback>}
      <SubmitRow
        mock={ctx.mock}
        label={busy ? 'Running…' : 'Submit solution'}
        disabled={busy}
        onSubmit={submit}
        onReveal={() => ctx.complete({ correct: false, revealed: true })}
        extra={<button className="btn-ghost" disabled={busy} onClick={run}><Play size={14} /> Run tests</button>}
      />
      {!ctx.ranTests && <div className="flex items-center gap-1.5 text-[11px] text-faint"><FlaskConical size={12} /> Tip: submitting without running tests first costs verification points.</div>}
    </div>
  );
}
