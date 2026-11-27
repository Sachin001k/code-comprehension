import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { useStore, type ProblemProgress, type StageProgress } from './store';

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ session: null, loading: false, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void pullRemote(session.user.id);
  }, [session?.user.id]);

  const signOut = async () => {
    await supabase?.auth.signOut();
    setSession(null);
  };

  return <Ctx.Provider value={{ session, loading, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

async function pullRemote(uid: string) {
  if (!supabase) return;
  const [{ data: prof }, { data: rows }] = await Promise.all([
    supabase.from('profiles').select('username, rating, rated_count').eq('id', uid).single(),
    supabase.from('problem_progress').select('problem_id, stages, completed, best_score, rating_delta, attempts, completed_at').eq('user_id', uid),
  ]);
  if (!prof) return;
  const progress: Record<string, ProblemProgress> = {};
  for (const r of rows ?? []) {
    progress[r.problem_id] = {
      stages: (r.stages ?? {}) as Record<string, StageProgress>,
      completed: r.completed,
      score: r.best_score ?? undefined,
      ratingDelta: r.rating_delta ?? undefined,
      attempts: r.attempts ?? 0,
      completedAt: r.completed_at ? Date.parse(r.completed_at) : undefined,
    };
  }
  useStore.getState().hydrateRemote({ rating: prof.rating, ratedCount: prof.rated_count, progress, username: prof.username });
}

/** Persist in-progress stage state (best effort). */
export async function pushStages(pid: string) {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return;
  const stages = useStore.getState().progress[pid]?.stages ?? {};
  await supabase.from('problem_progress').upsert({ user_id: uid, problem_id: pid, stages }, { onConflict: 'user_id,problem_id' });
}

/** Server-authoritative rating update. Returns null when offline/guest. */
export async function submitRemote(pid: string, score: number, timeSec: number, mode: 'practice' | 'mock') {
  if (!supabase) return null;
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) return null;
  const stages = useStore.getState().progress[pid]?.stages ?? {};
  const { data, error } = await supabase.rpc('submit_problem', { p_problem_id: pid, p_score: score, p_stages: stages, p_time_sec: Math.round(timeSec), p_mode: mode });
  if (error) {
    console.warn('submit_problem failed', error.message);
    return null;
  }
  return data as { rating: number; delta: number; alreadyRated: boolean; streak: number };
}
