import { Link } from 'react-router-dom';
import { Lock, Flame, Target, Sparkles, ArrowRight, Swords, Zap, Bot, Search, Bug, GitBranch } from 'lucide-react';
import { useMemo } from 'react';
import { PROBLEMS, PROBLEM_BY_ID, LANG_LABEL } from '../content';
import { LEVELS, STAGE_KIND_LABEL, type StageKind } from '../content/types';
import { useStore, levelStats, isLevelUnlocked, streak, dailyProblemId, UNLOCK_FRACTION } from '../lib/store';
import { LevelBadge, ProgressBar, RatingPill, Stat } from '../components/ui';
import { levelColor, titleFor } from '../lib/rating';

export default function Dashboard() {
  const { rating, progress, activity, ratingHistory, settings } = useStore();
  const solved = Object.values(progress).filter((p) => p.completed).length;
  const st = streak(activity);
  const daily = PROBLEM_BY_ID[dailyProblemId(rating) ?? ''];
  const t = titleFor(rating);
  const isNew = solved === 0 && !Object.keys(progress).length;

  const inProgress = useMemo(
    () => Object.entries(progress).filter(([id, p]) => !p.completed && Object.values(p.stages).some((s) => s.done) && PROBLEM_BY_ID[id]).slice(0, 3),
    [progress],
  );

  const skills = useMemo(() => {
    const kinds: StageKind[] = ['predict', 'trace', 'find-bug', 'review-ai', 'code', 'mcq'];
    return kinds.map((k) => {
      let n = 0, sum = 0;
      for (const [pid, pp] of Object.entries(progress)) {
        const p = PROBLEM_BY_ID[pid];
        if (!p) continue;
        for (const s of p.stages) if (s.kind === k && pp.stages[s.id]?.done) { n++; sum += pp.stages[s.id].score; }
      }
      return { k, label: STAGE_KIND_LABEL[k], v: n ? sum / n : 0, n };
    });
  }, [progress]);

  const stageCount = PROBLEMS.reduce((n, p) => n + p.stages.length, 0);

  return (
    <div className="space-y-8">
      {isNew && (
        <section className="relative overflow-hidden rounded-2xl border border-line bg-panel p-6 md:p-10">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative max-w-2xl">
            <span className="chip mb-4"><Sparkles size={12} className="text-accent" /> The new interview round, finally practisable</span>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight md:text-5xl">
              Read code you’ve never seen.<br /><span className="text-accent">Out-think the AI next to you.</span>
            </h1>
            <p className="mt-4 text-muted md:text-lg">
              Google, Meta, Atlassian, Canva and more now drop you into an unfamiliar codebase with an imperfect AI assistant. Practise orienting, tracing, debugging, extending and verifying across {PROBLEMS.length} problems and {stageCount} stages, from L1 to 3000-rated Grandmaster.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to={`/p/${PROBLEMS[0]?.id}`} className="btn-primary !px-5 !py-2.5">Start with L1 <ArrowRight size={16} /></Link>
              <Link to="/mock" className="btn-ghost !px-5 !py-2.5"><Swords size={16} /> Try a mock interview</Link>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-3 text-xs text-muted sm:grid-cols-4">
              {[[Search, 'Predict & trace'], [Bug, 'Root-cause bugs'], [Bot, 'Catch AI mistakes'], [GitBranch, 'Fix with real tests']].map(([I, l]) => {
                const Icon = I as typeof Bug;
                return <div key={l as string} className="flex items-center gap-2"><Icon size={14} className="text-accent" /> {l as string}</div>;
              })}
            </div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Rating" value={<RatingPill rating={rating} className="!text-2xl" />} sub={<span style={{ color: t.color }}>{t.title}</span>} />
        <Stat label="Problems solved" value={solved} sub={`of ${PROBLEMS.length}`} />
        <Stat label="Day streak" value={<span className="flex items-center gap-1">{st} <Flame size={20} className="text-warn" /></span>} sub="Practise daily to keep it" />
        <Stat label="Rating trend" value={<Sparkline data={[800, ...ratingHistory.map((h) => h.r)]} />} sub={`${ratingHistory.length} rated problems`} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="min-w-0 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-lg font-bold">Level ladder</h2>
            <span className="text-xs text-muted">Unlock the next level by solving {Math.round(UNLOCK_FRACTION * 100)}% of the current one, or by reaching its rating.</span>
          </div>
          <div className="space-y-3">
            {LEVELS.map((L) => {
              const s = levelStats(progress, L.level);
              const unlocked = isLevelUnlocked(L.level, progress, rating, settings.unlockAll);
              return (
                <Link
                  key={L.level}
                  to={unlocked ? `/problems?level=${L.level}` : '#'}
                  onClick={(e) => !unlocked && e.preventDefault()}
                  className={`card group flex items-center gap-4 p-4 transition-colors ${unlocked ? 'hover:border-line-strong' : 'opacity-60'}`}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-extrabold" style={{ color: levelColor(L.level), background: `color-mix(in srgb, ${levelColor(L.level)} 14%, transparent)` }}>
                    {unlocked ? `L${L.level}` : <Lock size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{L.name}</span>
                      <span className="font-mono text-xs text-faint">{L.range[0]}–{L.range[1]}</span>
                    </div>
                    <div className="truncate text-sm text-muted">{L.blurb}</div>
                    <ProgressBar className="mt-2" value={s.pct} color={levelColor(L.level)} />
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm font-bold">{s.solved}/{s.total}</div>
                    <div className="text-[11px] text-faint">solved</div>
                  </div>
                  <ArrowRight size={16} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
                </Link>
              );
            })}
          </div>
        </section>

        <aside className="min-w-0 space-y-4">
          {daily && (
            <Link to={`/p/${daily.id}`} className="card block p-4 transition-colors hover:border-accent/50">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-warn"><Target size={14} /> Daily challenge</div>
              <div className="font-bold">{daily.title}</div>
              <div className="mt-1 text-sm text-muted">{daily.summary}</div>
              <div className="mt-3 flex items-center gap-2"><LevelBadge level={daily.level} /><RatingPill rating={daily.rating} /><span className="text-xs text-faint">{LANG_LABEL[daily.lang]}</span>
                {progress[daily.id]?.completed && <span className="ml-auto text-xs font-semibold text-accent">Done ✓</span>}
              </div>
            </Link>
          )}

          <div className="card p-4">
            <div className="mb-3 text-sm font-bold">Skill radar</div>
            <Radar data={skills.map((s) => ({ label: s.label, v: s.v }))} />
            <div className="mt-2 text-center text-[11px] text-faint">Average stage score by stage type</div>
          </div>

          {inProgress.length > 0 && (
            <div className="card p-4">
              <div className="mb-2 text-sm font-bold">Continue</div>
              <div className="space-y-2">
                {inProgress.map(([id, pp]) => {
                  const p = PROBLEM_BY_ID[id];
                  const d = p.stages.filter((s) => pp.stages[s.id]?.done).length;
                  return (
                    <Link key={id} to={`/p/${id}`} className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-panel-2">
                      <LevelBadge level={p.level} /> <span className="min-w-0 flex-1 truncate">{p.title}</span> <span className="font-mono text-xs text-muted">{d}/{p.stages.length}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Link to="/drills" className="card p-4 hover:border-line-strong"><Zap size={18} className="mb-2 text-warn" /><div className="text-sm font-bold">Drills</div><div className="text-xs text-muted">5-minute rapid fire</div></Link>
            <Link to="/mock" className="card p-4 hover:border-line-strong"><Swords size={18} className="mb-2 text-danger" /><div className="text-sm font-bold">Mock</div><div className="text-xs text-muted">Company presets</div></Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <span className="text-base text-faint">No games yet</span>;
  const w = 120, h = 30;
  const min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 4) - 2}`).join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} className="mt-1" aria-label="Rating history">
      <polyline points={pts} fill="none" stroke={up ? 'var(--accent)' : 'var(--danger)'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Radar({ data }: { data: { label: string; v: number }[] }) {
  const size = 220, c = size / 2, r = 74;
  const pt = (i: number, rad: number) => {
    const a = (Math.PI * 2 * i) / data.length - Math.PI / 2;
    return [c + Math.cos(a) * rad, c + Math.sin(a) * rad] as const;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[240px]" role="img" aria-label="Skill radar">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={data.map((_, i) => pt(i, r * f).join(',')).join(' ')} fill="none" stroke="var(--border)" strokeWidth="1" />
      ))}
      {data.map((_, i) => <line key={i} x1={c} y1={c} x2={pt(i, r)[0]} y2={pt(i, r)[1]} stroke="var(--border)" />)}
      <polygon points={data.map((d, i) => pt(i, r * Math.max(0.04, d.v)).join(',')).join(' ')} fill="color-mix(in srgb, var(--accent) 25%, transparent)" stroke="var(--accent)" strokeWidth="2" />
      {data.map((d, i) => {
        const [x, y] = pt(i, r + 22);
        return <text key={d.label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="9.5" fill="var(--muted)">{d.label}</text>;
      })}
    </svg>
  );
}
