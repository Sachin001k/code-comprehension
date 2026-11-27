/**
 * Content schema for CodeComprehend Arena.
 *
 * A Problem = a small (or not so small) codebase + an ordered list of Stages.
 * Every stage is auto-gradable in the browser. Run `npm run validate` to
 * execute every problem's code and confirm the answers are correct.
 */

export type Lang = 'javascript' | 'typescript' | 'python' | 'java' | 'cpp';

/** Languages whose code can be executed in the browser (needed for `code` stages). */
export const RUNNABLE_LANGS: Lang[] = ['javascript', 'typescript', 'python'];

export type Level = 1 | 2 | 3 | 4 | 5;

export type Company =
  | 'google' | 'meta' | 'atlassian' | 'canva' | 'apple' | 'amazon' | 'microsoft'
  | 'uber' | 'stripe' | 'blackrock' | 'goldman' | 'jpmorgan' | 'jane-street'
  | 'citadel' | 'two-sigma' | 'de-shaw' | 'hrt' | 'optiver' | 'generic';

export type PersonaId =
  | 'helpful-senior'   // strong, correct
  | 'tunnel-vision'    // only sees the open file
  | 'confident-intern' // sounds sure, ~30% of suggestions have a subtle bug
  | 'api-dreamer'      // invents APIs that don't exist
  | 'lazy-copier'      // partial code, drops error handling
  | 'outdated-docs'    // deprecated idioms / APIs
  | 'rate-limited'     // few messages
  | 'agent-mode';      // edits multiple files, over-edits

export interface RepoFile {
  /** POSIX path relative to repo root, e.g. "src/booking/service.js" */
  path: string;
  content: string;
  /** Defaults to problem.lang. Use for data/config files: 'json' | 'text' | 'markdown' etc. */
  language?: Lang | 'json' | 'text' | 'markdown' | 'yaml' | 'sql';
  /** Hidden from the explorer (e.g. hidden tests). */
  hidden?: boolean;
}

interface StageBase {
  /** Unique within the problem, e.g. "s1". */
  id: string;
  title: string;
  /** Markdown. What the candidate must do. */
  prompt: string;
  /** Progressive hints, cheapest first. Each hint taken costs score. */
  hints: string[];
  /** Markdown shown after submission: the reasoning, not just the answer. */
  explanation: string;
  /** Suggested time budget for the stage. */
  timeLimitSec: number;
  /** File to open in the editor when the stage starts. */
  focusFile?: string;
}

/** Predict the output of running `entry`. Validator runs the code and compares stdout. */
export interface PredictStage extends StageBase {
  kind: 'predict';
  /** File to execute. Defaults to the first file. */
  entry?: string;
  /** Exact expected stdout (trailing whitespace on each line and trailing newlines ignored). */
  answer: string;
  /** If present, the stage is multiple choice and `answer` MUST be one of these strings. */
  options?: string[];
  /** Set false only if the program cannot be executed by the validator (rare). */
  verify?: boolean;
}

/** Click the buggy line(s) in a file, then pick the root cause. */
export interface FindBugStage extends StageBase {
  kind: 'find-bug';
  file: string;
  /** 1-based line numbers; clicking any one of them counts as correct. */
  lines: number[];
  options: string[];
  correct: number;
}

/** Multiple choice (single or multi-select). */
export interface McqStage extends StageBase {
  kind: 'mcq';
  options: string[];
  /** Indices of correct options. More than one => multi-select ("select all that apply"). */
  correct: number[];
}

/** Put the steps of a call path / data flow in the order they execute. */
export interface TraceStage extends StageBase {
  kind: 'trace';
  /** Steps in the CORRECT order. The UI shuffles them. 4-9 items. */
  items: string[];
}

/** An imperfect AI assistant proposes something. Decide whether to accept it and what is wrong. */
export interface ReviewAiStage extends StageBase {
  kind: 'review-ai';
  persona: PersonaId;
  /** What the candidate asked the assistant. */
  request: string;
  /** The assistant's reply (markdown, usually contains a code block or diff). */
  aiReply: string;
  /** Choices. Exactly one is correct. Include "The suggestion is correct" style options when relevant. */
  options: string[];
  correct: number;
}

/** Edit code until hidden tests pass. Only for runnable languages (javascript, typescript, python). */
export interface CodeStage extends StageBase {
  kind: 'code';
  task: 'fix' | 'feature' | 'optimise' | 'refactor';
  /** Paths the candidate may edit. */
  editable: string[];
  /**
   * Hidden test files (not shown). JS/TS: use global `test(name, fn)` and jest-like `expect`.
   * Python: plain `def test_x():` functions with `assert`.
   * Tests may `require`/`import` repo files by relative path from the test file's own path.
   */
  tests: RepoFile[];
  /** Reference solution: replacement content for (a subset of) editable files. */
  solution: Record<string, string>;
  /** Per-run wall clock limit in ms (default 4000). Use for optimise stages. */
  timeoutMs?: number;
}

export type Stage = PredictStage | FindBugStage | McqStage | TraceStage | ReviewAiStage | CodeStage;
export type StageKind = Stage['kind'];

export interface Problem {
  /** Globally unique slug, prefixed by level: "l3-ts-booking-trace". */
  id: string;
  title: string;
  level: Level;
  /** Chess-style difficulty. L1: 600-1200, L2: 1100-1600, L3: 1500-2000, L4: 1900-2450, L5: 2350-3000 */
  rating: number;
  lang: Lang;
  /** e.g. booking, payments, rate-limiter, cache, file-system, chat, inventory, log-processor, scheduler, orderbook, risk, pricing, market-data, auth, search, graph, parser, concurrency, language-semantics */
  domain: string;
  companies: Company[];
  tags: string[];
  /** One-line teaser for the problem card. */
  summary: string;
  /** Markdown briefing shown before stage 1 ("You've just joined the payments team..."). */
  context?: string;
  files: RepoFile[];
  stages: Stage[];
  /** Default AI persona in the assistant panel for this problem. */
  persona?: PersonaId;
}

export const LEVELS: { level: Level; name: string; blurb: string; range: [number, number] }[] = [
  { level: 1, name: 'Line Reader', blurb: 'Syntax, idioms, return values, simple control flow.', range: [600, 1200] },
  { level: 2, name: 'Function Tracer', blurb: 'Recursion, mutation, aliasing, closures, edge cases.', range: [1100, 1600] },
  { level: 3, name: 'Module Navigator', blurb: 'Cross-file call paths, data flow, dependency injection, first debugging.', range: [1500, 2000] },
  { level: 4, name: 'Debugger & Extender', blurb: 'Root-cause failures, extend features in existing patterns, optimise at scale.', range: [1900, 2450] },
  { level: 5, name: 'Grandmaster', blurb: 'Concurrency, memory models, numeric precision, event loops, full interview simulations. 3000-rated.', range: [2350, 3000] },
];

export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  predict: 'Predict output',
  'find-bug': 'Find the bug',
  mcq: 'Reasoning',
  trace: 'Trace the flow',
  'review-ai': 'Verify AI output',
  code: 'Hands-on code',
};
