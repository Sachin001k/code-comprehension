import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Lock, CheckCircle2, CircleDashed, CircleDot, Clock, Shuffle } from 'lucide-react';
import clsx from 'clsx';
import { PROBLEMS, ALL_COMPANIES, ALL_DOMAINS, ALL_LANGS, COMPANY_LABEL, LANG_LABEL, totalTimeSec } from '../content';
import { LEVELS, STAGE_KIND_LABEL, type Level, type StageKind } from '../content/types';
import { useStore, isLevelUnlocked } from '../lib/store';
import { LevelBadge, RatingPill, Empty } from '../components/ui';
import { useNavigate } from 'react-router-dom';

const KINDS = Object.keys(STAGE_KIND_LABEL) as StageKind[];

export default function Problems() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const { progress, rating, settings } = useStore();
  const [q, setQ] = useState('');
  const level = sp.get('level') ? (Number(sp.get('level')) as Level) : null;
  const lang = sp.get('lang');
  const company = sp.get('company');
  const domain = sp.get('domain');
  const kind = sp.get('kind') as StageKind | null;
  const status = sp.get('status');

  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v === null || n.get(k) === v) n.delete(k);
    else n.set(k, v);
    setSp(n, { replace: true });
  };

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return PROBLEMS.filter((p) => {
      if (level && p.level !== level) return false;
      if (lang && p.lang !== lang) return false;
      if (company && !p.companies.includes(company as never)) return false;
      if (domain && p.domain !== domain) return false;
      if (kind && !p.stages.some((s) => s.kind === kind)) return false;
      const pp = progress[p.id];
      if (status === 'solved' && !pp?.completed) return false;
      if (status === 'todo' && pp?.completed) return false;
      if (qq && !`${p.title} ${p.summary} ${p.tags.join(' ')} ${p.domain}`.toLowerCase().includes(qq)) return false;
      return true;
    });
  }, [q, level, lang, company, domain, kind, status, progress]);

  const pickRandom = () => {
    const pool = list.filter((p) => !progress[p.id]?.completed && isLevelUnlocked(p.level, progress, rating, settings.unlockAll));
    const p = pool[Math.floor(Math.random() * pool.length)];
    if (p) nav(`/p/${p.id}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Problem bank</h1>
          <p className="text-sm text-muted">{PROBLEMS.length} problems · filter by level, stack, company, domain or stage type.</p>
        </div>
        <button className="btn-ghost" onClick={pickRandom}><Shuffle size={15} /> Random unsolved</button>
      </div>

      <div className="card space-y-3 p-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !pl-9" placeholder="Search titles, tags, domains…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <FilterRow label="Level">
          {LEVELS.map((L) => <Pill key={L.level} on={level === L.level} onClick={() => set('level', String(L.level))}>L{L.level} {L.name}</Pill>)}
        </FilterRow>
        <FilterRow label="Language">
          {ALL_LANGS.map((l) => <Pill key={l} on={lang === l} onClick={() => set('lang', l)}>{LANG_LABEL[l] ?? l}</Pill>)}
        </FilterRow>
        <FilterRow label="Company">
          {ALL_COMPANIES.map((c) => <Pill key={c} on={company === c} onClick={() => set('company', c)}>{COMPANY_LABEL[c] ?? c}</Pill>)}
        </FilterRow>
        <FilterRow label="Stage type">
          {KINDS.map((k) => <Pill key={k} on={kind === k} onClick={() => set('kind', k)}>{STAGE_KIND_LABEL[k]}</Pill>)}
        </FilterRow>
        <div className="flex flex-wrap items-center gap-2">
          <FilterRow label="Status">
            <Pill on={status === 'todo'} onClick={() => set('status', 'todo')}>Unsolved</Pill>
            <Pill on={status === 'solved'} onClick={() => set('status', 'solved')}>Solved</Pill>
          </FilterRow>
          <select className="input !w-auto !py-1 text-xs" value={domain ?? ''} onChange={(e) => set('domain', e.target.value || null)} aria-label="Domain">
            <option value="">All domains</option>
            {ALL_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {[...sp.keys()].length > 0 && <button className="btn-subtle !py-1 text-xs" onClick={() => setSp({}, { replace: true })}>Clear filters</button>}
        </div>
      </div>

      <div className="text-xs text-muted">{list.length} result{list.length === 1 ? '' : 's'}</div>

      {list.length === 0 ? (
        <Empty>No problems match these filters.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const pp = progress[p.id];
            const locked = !isLevelUnlocked(p.level, progress, rating, settings.unlockAll);
            const done = pp?.completed;
            const started = !done && pp && Object.values(pp.stages).some((s) => s.done);
            return (
              <Link
                key={p.id}
                to={locked ? '#' : `/p/${p.id}`}
                onClick={(e) => locked && e.preventDefault()}
                className={clsx('card group flex flex-col p-4 transition-colors', locked ? 'opacity-55' : 'hover:border-line-strong')}
              >
                <div className="mb-2 flex items-center gap-2">
                  <LevelBadge level={p.level} />
                  <RatingPill rating={p.rating} />
                  <span className="text-xs text-faint">{LANG_LABEL[p.lang]}</span>
                  <span className="ml-auto">
                    {locked ? <Lock size={15} className="text-faint" /> : done ? <CheckCircle2 size={16} className="text-accent" /> : started ? <CircleDot size={16} className="text-warn" /> : <CircleDashed size={16} className="text-faint" />}
                  </span>
                </div>
                <div className="font-bold leading-snug group-hover:text-accent">{p.title}</div>
                <div className="mt-1 line-clamp-2 text-sm text-muted">{p.summary}</div>
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                  {[...new Set(p.stages.map((s) => s.kind))].map((k) => <span key={k} className="chip !text-[10px]">{STAGE_KIND_LABEL[k]}</span>)}
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-faint"><Clock size={11} /> {Math.round(totalTimeSec(p) / 60)}m · {p.stages.length} stage{p.stages.length > 1 ? 's' : ''}</span>
                </div>
                {done && pp.score !== undefined && <div className="mt-2 text-[11px] text-accent">Best {Math.round(pp.score * 100)}%{pp.ratingDelta !== undefined && ` · ${pp.ratingDelta >= 0 ? '+' : ''}${pp.ratingDelta}`}</div>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 shrink-0 text-xs font-medium text-faint">{label}</span>
      {children}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={clsx('rounded-md border px-2 py-1 text-xs font-medium transition-colors', on ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:border-line-strong hover:text-fg')}>
      {children}
    </button>
  );
}
