import { LEVELS, type Level } from '../content/types';

export const START_RATING = 800;

/** Expected score of a player rated `r` against a problem rated `p`. */
export function expected(r: number, p: number) {
  return 1 / (1 + Math.pow(10, (p - r) / 400));
}

/**
 * Elo-style update. `score` in [0,1] is the problem score (partial credit allowed).
 * Must stay in sync with the `submit_problem` SQL function in supabase/migrations.
 */
export function updateRating(r: number, p: number, score: number, ratedGames: number) {
  const k = ratedGames < 10 ? 48 : ratedGames < 30 ? 32 : 20;
  return Math.max(100, Math.round(r + k * (score - expected(r, p))));
}

export function titleFor(rating: number): { title: string; color: string } {
  if (rating >= 2700) return { title: 'Grandmaster', color: 'var(--l5)' };
  if (rating >= 2400) return { title: 'Master', color: 'var(--l5)' };
  if (rating >= 2000) return { title: 'Expert', color: 'var(--l4)' };
  if (rating >= 1600) return { title: 'Specialist', color: 'var(--l3)' };
  if (rating >= 1200) return { title: 'Apprentice', color: 'var(--l2)' };
  return { title: 'Novice', color: 'var(--l1)' };
}

export const levelColor = (l: Level) => `var(--l${l})`;
export const levelName = (l: Level) => LEVELS.find((x) => x.level === l)!.name;

/** Stage scoring. Kept simple and explainable to the user. */
export function stageScore(o: { correct: boolean; wrongAttempts: number; hintsUsed: number; overTime: boolean; revealed: boolean; partial?: number }) {
  if (o.revealed) return 0;
  const base = o.partial ?? (o.correct ? 1 : 0);
  let s = base - 0.3 * o.wrongAttempts - 0.12 * o.hintsUsed;
  if (o.overTime) s *= 0.85;
  return Math.max(0, Math.min(1, s));
}
