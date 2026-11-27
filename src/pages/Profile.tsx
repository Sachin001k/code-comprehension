import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Unlock, Trash2, Save } from 'lucide-react';
import { PROBLEM_BY_ID } from '../content';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase, supabaseEnabled } from '../lib/supabase';
import { LevelBadge, RatingPill, Stat } from '../components/ui';
import { titleFor } from '../lib/rating';

export default function Profile() {
  const st = useStore();
  const { session, signOut } = useAuth();
  const [username, setUsername] = useState(st.username ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const t = titleFor(st.rating);
  const history = Object.entries(st.progress)
    .filter(([id, p]) => p.completed && PROBLEM_BY_ID[id])
    .sort((a, b) => (b[1].completedAt ?? 0) - (a[1].completedAt ?? 0));

  const saveName = async () => {
    if (!supabase || !session) return;
    const { error } = await supabase.from('profiles').update({ username }).eq('id', session.user.id);
    setSaved(error ? error.message : 'Saved');
    if (!error) useStore.setState({ username });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">{session ? st.username ?? session.user.email : 'Guest'}</h1>
        <span className="text-sm font-semibold" style={{ color: t.color }}>{t.title}</span>
        {session && <button className="btn-ghost ml-auto" onClick={signOut}><LogOut size={15} /> Sign out</button>}
        {!session && supabaseEnabled && <Link to="/login" className="btn-primary ml-auto">Sign in to sync</Link>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Rating" value={<RatingPill rating={st.rating} className="!text-2xl" />} />
        <Stat label="Peak" value={Math.max(st.rating, ...st.ratingHistory.map((h) => h.r))} />
        <Stat label="Rated problems" value={st.ratedCount} />
        <Stat label="Drill accuracy" value={`${st.drill.aiBug.seen + st.drill.predict.seen ? Math.round(((st.drill.aiBug.correct + st.drill.predict.correct) / (st.drill.aiBug.seen + st.drill.predict.seen)) * 100) : 0}%`} />
      </div>

      {session && (
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted">Username (shown on leaderboard)</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} pattern="[A-Za-z0-9_.\-]{3,24}" />
          </div>
          <button className="btn-primary" onClick={saveName}><Save size={15} /> Save</button>
          {saved && <span className="text-xs text-muted">{saved}</span>}
        </div>
      )}

      <div className="card space-y-3 p-4">
        <div className="text-sm font-bold">Settings</div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={st.settings.unlockAll} onChange={(e) => st.setSettings({ unlockAll: e.target.checked })} />
          <Unlock size={15} className="text-muted" /> Unlock all levels <span className="text-xs text-faint">(tester mode: skip level gating)</span>
        </label>
        <button
          className="btn-ghost text-danger"
          onClick={() => { if (confirm('Reset all local progress, rating and notes in this browser?')) st.resetAll(); }}
        ><Trash2 size={15} /> Reset local progress</button>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-bold">History</h2>
        {history.length === 0 ? (
          <div className="text-sm text-muted">No completed problems yet.</div>
        ) : (
          <div className="card divide-y divide-line">
            {history.map(([id, p]) => {
              const pr = PROBLEM_BY_ID[id];
              return (
                <Link key={id} to={`/p/${id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-panel-2">
                  <LevelBadge level={pr.level} />
                  <span className="min-w-0 flex-1 truncate">{pr.title}</span>
                  <span className="font-mono text-xs">{Math.round((p.score ?? 0) * 100)}%</span>
                  <span className={`w-12 text-right font-mono text-xs ${(p.ratingDelta ?? 0) >= 0 ? 'text-accent' : 'text-danger'}`}>{(p.ratingDelta ?? 0) >= 0 ? '+' : ''}{p.ratingDelta ?? 0}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
