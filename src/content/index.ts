import type { Problem, Stage, Level, Company } from './types';

const modules = import.meta.glob<{ default: Problem[] }>('./problems/*.ts', { eager: true });

export const PROBLEMS: Problem[] = Object.values(modules)
  .flatMap((m) => m.default ?? [])
  .sort((a, b) => a.level - b.level || a.rating - b.rating);

export const PROBLEM_BY_ID: Record<string, Problem> = Object.fromEntries(PROBLEMS.map((p) => [p.id, p]));

export const problemsByLevel = (l: Level) => PROBLEMS.filter((p) => p.level === l);

export interface StageRef { problem: Problem; stage: Stage }
export const ALL_STAGES: StageRef[] = PROBLEMS.flatMap((problem) => problem.stages.map((stage) => ({ problem, stage })));

export const COMPANY_LABEL: Record<Company, string> = {
  google: 'Google', meta: 'Meta', atlassian: 'Atlassian', canva: 'Canva', apple: 'Apple', amazon: 'Amazon',
  microsoft: 'Microsoft', uber: 'Uber', stripe: 'Stripe', blackrock: 'BlackRock', goldman: 'Goldman Sachs',
  jpmorgan: 'JPMorgan', 'jane-street': 'Jane Street', citadel: 'Citadel', 'two-sigma': 'Two Sigma',
  'de-shaw': 'D. E. Shaw', hrt: 'HRT', optiver: 'Optiver', generic: 'General',
};

export const LANG_LABEL: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java', cpp: 'C++',
};

export const ALL_DOMAINS = [...new Set(PROBLEMS.map((p) => p.domain))].sort();
export const ALL_COMPANIES = [...new Set(PROBLEMS.flatMap((p) => p.companies))].sort() as Company[];
export const ALL_LANGS = [...new Set(PROBLEMS.map((p) => p.lang))];

export function totalTimeSec(p: Problem) {
  return p.stages.reduce((n, s) => n + s.timeLimitSec, 0);
}
