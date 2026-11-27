import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Flame } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useStore } from '../lib/store';
import { RatingPill, Empty } from '../components/ui';
import { titleFor } from '../lib/rating';

interface Row { id: string; username: string; display_name: string | null; rating: number; best_rating: number; solved_count: number; streak: number }

export default function Leaderboard() {
  const { session } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const local = useStore();

  useEffect(() => {
    if (!supabase) return;
    supabase.from('leaderboard').select('*').limit(100).then(({ data, error }) => {
      if (error) setErr(error.message);
      else setRows(data as Row[]);
    });
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight"><Trophy size={22} className="text-warn" /> Leaderboard</h1>
        <p className="text-sm text-muted">Ratings are computed server-side from first completions of each problem.</p>
      </div>
      {!supabase ? (
        <Empty>
          <div className="text-center">
            The global leaderboard needs Supabase. Add <code className="font-mono">VITE_SUPABASE_URL</code> and <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> to <code className="font-mono">.env</code>.
            <div className="mt-3">Your local rating: <RatingPill rating={local.rating} /></div>
          </div>
        </Empty>
      ) : err ? (
        <Empty>Could not load the leaderboard: {err}</Empty>
      ) : !rows ? (
        <Empty>Loading…</Empty>
      ) : !rows.length ? (
        <Empty>No rated players yet. Be the first: <Link to="/problems" className="ml-1 text-accent">solve a problem</Link>.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr><th className="px-4 py-2.5 w-12">#</th><th className="px-4 py-2.5">Player</th><th className="px-4 py-2.5">Rating</th><th className="hidden px-4 py-2.5 sm:table-cell">Peak</th><th className="px-4 py-2.5">Solved</th><th className="hidden px-4 py-2.5 sm:table-cell">Streak</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const me = r.id === session?.user.id;
                const t = titleFor(r.rating);
                return (
                  <tr key={r.id} className={`border-b border-line last:border-0 ${me ? 'bg-accent/5' : ''}`}>
                    <td className="px-4 py-2.5 font-mono text-muted">{i + 1}</td>
                    <td className="px-4 py-2.5"><span className="font-semibold">{r.display_name || r.username}</span> <span className="text-xs text-faint">@{r.username}</span>{me && <span className="ml-2 chip">you</span>}<div className="text-[11px]" style={{ color: t.color }}>{t.title}</div></td>
                    <td className="px-4 py-2.5"><RatingPill rating={r.rating} /></td>
                    <td className="hidden px-4 py-2.5 font-mono text-xs text-muted sm:table-cell">{r.best_rating}</td>
                    <td className="px-4 py-2.5 font-mono">{r.solved_count}</td>
                    <td className="hidden px-4 py-2.5 sm:table-cell"><span className="flex items-center gap-1 text-warn"><Flame size={13} />{r.streak}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
