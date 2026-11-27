import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swords, Clock, Bot, Layers, Play, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { PROBLEMS, LANG_LABEL, totalTimeSec } from '../content';
import { PRESETS, PERSONAS, type CompanyPreset } from '../content/personas';
import { useStore } from '../lib/store';
import { LevelBadge, RatingPill } from '../components/ui';
import type { Problem } from '../content/types';

function candidates(p: CompanyPreset): Problem[] {
  const multi = PROBLEMS.filter((x) => x.stages.length >= 3 && p.levels.includes(x.level));
  const tagged = multi.filter((x) => x.companies.some((c) => p.companies.includes(c)));
  return (tagged.length >= 3 ? tagged : [...tagged, ...multi.filter((x) => !tagged.includes(x))]).sort((a, b) => b.stages.length - a.stages.length || b.rating - a.rating);
}

export default function Mock() {
  const nav = useNavigate();
  const progress = useStore((s) => s.progress);
  const [sel, setSel] = useState<CompanyPreset>(PRESETS[0]);
  const list = useMemo(() => candidates(sel), [sel]);

  const launch = (p?: Problem) => {
    const pool = list.filter((x) => !progress[x.id]?.completed);
    const pick = p ?? (pool.length ? pool : list)[Math.floor(Math.random() * Math.min(6, (pool.length ? pool : list).length))];
    if (pick) nav(`/p/${pick.id}?mock=${sel.id}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight"><Swords size={22} className="text-danger" /> Mock interview</h1>
        <p className="text-sm text-muted">Strict mode: a single attempt per stage, no hints, explanations only at the end, one overall clock, and the AI setup the company is reported to use.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => setSel(p)} className={clsx('card p-4 text-left transition-colors', sel.id === p.id ? 'border-accent ring-1 ring-accent' : 'hover:border-line-strong')}>
            <div className="font-bold">{p.name}</div>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted">
              <span className="flex items-center gap-1"><Clock size={12} /> {p.minutes}m</span>
              <span className="flex items-center gap-1"><Bot size={12} /> {p.personas.length ? p.ai : 'No AI'}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="card grid grid-cols-1 gap-6 p-5 md:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="text-lg font-bold">{sel.name} format</div>
          <p className="mt-1 text-sm text-muted">{sel.format}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-faint">Clock</dt><dd className="font-semibold">{sel.minutes} minutes total</dd></div>
            <div><dt className="text-xs text-faint">Levels</dt><dd className="flex gap-1">{sel.levels.map((l) => <LevelBadge key={l} level={l} />)}</dd></div>
            <div><dt className="text-xs text-faint">AI assistant</dt><dd className="font-semibold">{sel.ai}</dd></div>
            <div><dt className="text-xs text-faint">Model switching</dt><dd className="font-semibold">{sel.modelSwitching ? 'Allowed' : 'Fixed'}</dd></div>
          </dl>
          {sel.personas.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {sel.personas.map((id) => <span key={id} className="chip">{PERSONAS[id].emoji} {PERSONAS[id].name}</span>)}
            </div>
          )}
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-muted">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
            Formats are reported publicly and change often. Treat this as a realistic rehearsal, not a guarantee.
          </div>
          <button className="btn-primary mt-5 !px-5 !py-2.5" disabled={!list.length} onClick={() => launch()}><Play size={16} /> Start random {sel.name} mock</button>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><Layers size={13} /> Or pick a codebase ({list.length})</div>
          <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {list.map((p) => (
              <button key={p.id} onClick={() => launch(p)} className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-line-strong">
                <LevelBadge level={p.level} />
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="hidden text-[11px] text-faint sm:inline">{LANG_LABEL[p.lang]} · {p.stages.length} stages · {Math.round(totalTimeSec(p) / 60)}m</span>
                <RatingPill rating={p.rating} />
              </button>
            ))}
            {!list.length && <div className="text-sm text-muted">No multi-stage problems for this preset yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
