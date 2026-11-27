import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { PROBLEM_BY_ID, PROBLEMS, problemsByLevel } from '../content';
import { LEVELS, type Level } from '../content/types';
import { START_RATING, updateRating } from './rating';
import { UNLOCK_ALL_ENV } from './supabase';

export interface StageProgress {
  done: boolean;
  correct: boolean;
  score: number;
  wrongAttempts: number;
  hintsUsed: number;
  revealed: boolean;
  timeSec: number;
  ranTests?: boolean;
  /** Last submitted answer (for review) */
  answer?: unknown;
}

export interface ProblemProgress {
  stages: Record<string, StageProgress>;
  completed: boolean;
  score?: number;
  ratingDelta?: number;
  completedAt?: number;
  attempts: number;
  /** Mock-interview runs don't reveal explanations until the end */
  mock?: boolean;
}

export interface Settings {
  unlockAll: boolean;
  theme: 'dark' | 'light';
}

interface State {
  rating: number;
  ratedCount: number;
  ratingHistory: { t: number; r: number; problemId: string }[];
  progress: Record<string, ProblemProgress>;
  activity: Record<string, number>;
  buffers: Record<string, Record<string, string>>;
  notes: Record<string, string>;
  drill: { aiBug: { seen: number; correct: number }; predict: { seen: number; correct: number } };
  settings: Settings;
  username?: string;

  hintsTaken: (pid: string, sid: string) => number;
  takeHint: (pid: string, sid: string) => void;
  recordWrong: (pid: string, sid: string) => void;
  completeStage: (pid: string, sid: string, sp: Omit<StageProgress, 'done' | 'wrongAttempts' | 'hintsUsed'> & Partial<StageProgress>) => void;
  finishProblem: (pid: string) => { score: number; delta: number; newRating: number; alreadyRated: boolean };
  resetProblem: (pid: string) => void;
  setBuffer: (pid: string, path: string, content: string) => void;
  clearBuffers: (pid: string) => void;
  setNotes: (pid: string, text: string) => void;
  drillResult: (kind: 'aiBug' | 'predict', correct: boolean) => void;
  setSettings: (s: Partial<Settings>) => void;
  hydrateRemote: (r: { rating: number; ratedCount: number; progress: Record<string, ProblemProgress>; username?: string }) => void;
  resetAll: () => void;
}

export const today = () => new Date().toISOString().slice(0, 10);

const emptyStage = (): StageProgress => ({ done: false, correct: false, score: 0, wrongAttempts: 0, hintsUsed: 0, revealed: false, timeSec: 0 });

const initial = {
  rating: START_RATING,
  ratedCount: 0,
  ratingHistory: [] as State['ratingHistory'],
  progress: {} as Record<string, ProblemProgress>,
  activity: {} as Record<string, number>,
  buffers: {} as Record<string, Record<string, string>>,
  notes: {} as Record<string, string>,
  drill: { aiBug: { seen: 0, correct: 0 }, predict: { seen: 0, correct: 0 } },
  settings: { unlockAll: UNLOCK_ALL_ENV, theme: 'dark' as const },
};

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const upd = (pid: string, sid: string, f: (s: StageProgress) => StageProgress) =>
        set((st) => {
          const pp = st.progress[pid] ?? { stages: {}, completed: false, attempts: 0 };
          const sp = pp.stages[sid] ?? emptyStage();
          return { progress: { ...st.progress, [pid]: { ...pp, stages: { ...pp.stages, [sid]: f(sp) } } } };
        });
      return {
        ...initial,
        hintsTaken: (pid, sid) => get().progress[pid]?.stages[sid]?.hintsUsed ?? 0,
        takeHint: (pid, sid) => upd(pid, sid, (s) => ({ ...s, hintsUsed: s.hintsUsed + 1 })),
        recordWrong: (pid, sid) => upd(pid, sid, (s) => ({ ...s, wrongAttempts: s.wrongAttempts + 1 })),
        completeStage: (pid, sid, sp) => {
          upd(pid, sid, (s) => ({ ...s, ...sp, done: true }));
          const d = today();
          set((st) => ({ activity: { ...st.activity, [d]: (st.activity[d] ?? 0) + 1 } }));
        },
        finishProblem: (pid) => {
          const st = get();
          const p = PROBLEM_BY_ID[pid];
          const pp = st.progress[pid];
          const scores = p.stages.map((s) => pp?.stages[s.id]?.score ?? 0);
          const score = scores.reduce((a, b) => a + b, 0) / scores.length;
          const alreadyRated = !!pp?.completed;
          let newRating = st.rating;
          if (!alreadyRated) newRating = updateRating(st.rating, p.rating, score, st.ratedCount);
          const delta = newRating - st.rating;
          set((s) => ({
            rating: newRating,
            ratedCount: alreadyRated ? s.ratedCount : s.ratedCount + 1,
            ratingHistory: alreadyRated ? s.ratingHistory : [...s.ratingHistory, { t: Date.now(), r: newRating, problemId: pid }],
            progress: {
              ...s.progress,
              [pid]: {
                ...s.progress[pid],
                completed: true,
                score: Math.max(score, s.progress[pid]?.score ?? 0),
                ratingDelta: alreadyRated ? s.progress[pid]?.ratingDelta : delta,
                completedAt: s.progress[pid]?.completedAt ?? Date.now(),
                attempts: (s.progress[pid]?.attempts ?? 0) + 1,
              },
            },
          }));
          return { score, delta, newRating, alreadyRated };
        },
        resetProblem: (pid) =>
          set((st) => {
            const pp = st.progress[pid];
            if (!pp) return {};
            // Keep completion/rating record, reset stage work so it can be practised again.
            return { progress: { ...st.progress, [pid]: { ...pp, stages: {} } }, buffers: { ...st.buffers, [pid]: {} } };
          }),
        setBuffer: (pid, path, content) => set((st) => ({ buffers: { ...st.buffers, [pid]: { ...(st.buffers[pid] ?? {}), [path]: content } } })),
        clearBuffers: (pid) => set((st) => ({ buffers: { ...st.buffers, [pid]: {} } })),
        setNotes: (pid, text) => set((st) => ({ notes: { ...st.notes, [pid]: text } })),
        drillResult: (kind, correct) =>
          set((st) => {
            const d = today();
            return {
              drill: { ...st.drill, [kind]: { seen: st.drill[kind].seen + 1, correct: st.drill[kind].correct + (correct ? 1 : 0) } },
              activity: { ...st.activity, [d]: (st.activity[d] ?? 0) + 1 },
            };
          }),
        setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
        hydrateRemote: (r) =>
          set((st) => {
            const merged = { ...st.progress };
            for (const [pid, rp] of Object.entries(r.progress)) {
              const lp = merged[pid];
              merged[pid] = !lp ? rp : { ...lp, ...rp, stages: { ...lp.stages, ...rp.stages }, completed: lp.completed || rp.completed };
            }
            return { rating: r.rating, ratedCount: r.ratedCount, progress: merged, username: r.username };
          }),
        resetAll: () => set({ ...initial }),
      };
    },
    {
      name: 'cc-arena-v1',
      storage: createJSONStorage(() => {
        try { return localStorage; } catch { return sessionStorage; }
      }),
    },
  ),
);

/* ---------- derived selectors ---------- */

export function levelStats(progress: Record<string, ProblemProgress>, level: Level) {
  const ps = problemsByLevel(level);
  const solved = ps.filter((p) => progress[p.id]?.completed).length;
  return { total: ps.length, solved, pct: ps.length ? solved / ps.length : 0 };
}

export const UNLOCK_FRACTION = 0.4;

export function isLevelUnlocked(level: Level, progress: Record<string, ProblemProgress>, rating: number, unlockAll: boolean) {
  if (unlockAll || level === 1) return true;
  const prev = (level - 1) as Level;
  const st = levelStats(progress, prev);
  const range = LEVELS.find((l) => l.level === level)!.range;
  return st.pct >= UNLOCK_FRACTION || rating >= range[0];
}

export function streak(activity: Record<string, number>) {
  let n = 0;
  const d = new Date();
  // today counts if active; otherwise streak continues from yesterday
  if (!activity[d.toISOString().slice(0, 10)]) d.setDate(d.getDate() - 1);
  while (activity[d.toISOString().slice(0, 10)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function dailyProblemId(rating: number) {
  const d = today();
  let h = 0;
  for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const near = PROBLEMS.filter((p) => Math.abs(p.rating - rating) <= 250);
  const pool = near.length ? near : PROBLEMS;
  return pool[h % pool.length]?.id;
}
