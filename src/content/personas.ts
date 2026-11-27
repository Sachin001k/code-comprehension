import type { PersonaId, Company, Level } from './types';

export interface Persona {
  id: PersonaId;
  name: string;
  emoji: string;
  behaviour: string;
  trains: string;
  /** Strength 1-5 shown in the model switcher. */
  strength: number;
  /** Max messages per stage (rate-limited persona). */
  messageBudget?: number;
  /** Only the open file is sent as context. */
  singleFileContext?: boolean;
}

export const PERSONAS: Record<PersonaId, Persona> = {
  'helpful-senior': {
    id: 'helpful-senior', name: 'Helpful Senior', emoji: '🧑‍🏫', strength: 5,
    behaviour: 'Strong model with full repo context. Baseline for learning.',
    trains: 'Learning the codebase; control group',
  },
  'tunnel-vision': {
    id: 'tunnel-vision', name: 'Tunnel Vision', emoji: '🔦', strength: 3, singleFileContext: true,
    behaviour: 'Only sees the file currently open; ignores the rest of the repo.',
    trains: 'Feeding the right context; prompting with file paths',
  },
  'confident-intern': {
    id: 'confident-intern', name: 'Confident Intern', emoji: '😎', strength: 2,
    behaviour: 'Answers fast and sounds certain; roughly 30% of code suggestions contain a subtle bug.',
    trains: 'Verifying every suggestion with tests',
  },
  'api-dreamer': {
    id: 'api-dreamer', name: 'API Dreamer', emoji: '💭', strength: 2,
    behaviour: 'Invents methods and config options that do not exist in this codebase or library version.',
    trains: 'Checking against real code and docs',
  },
  'lazy-copier': {
    id: 'lazy-copier', name: 'Lazy Copier', emoji: '🥱', strength: 2,
    behaviour: "Returns partial code with '// rest unchanged' and drops error handling.",
    trains: 'Reviewing diffs completely',
  },
  'outdated-docs': {
    id: 'outdated-docs', name: 'Outdated Docs', emoji: '📜', strength: 3,
    behaviour: 'Suggests deprecated APIs and older language idioms.',
    trains: 'Version awareness',
  },
  'rate-limited': {
    id: 'rate-limited', name: 'Rate-limited', emoji: '⏳', strength: 4, messageBudget: 4,
    behaviour: 'Only a handful of messages per stage.',
    trains: 'Planning and asking precise questions',
  },
  'agent-mode': {
    id: 'agent-mode', name: 'Agent Mode', emoji: '🤖', strength: 3,
    behaviour: 'Proposes multi-file edits and sometimes over-edits beyond the request.',
    trains: 'Reviewing multi-file agent edits',
  },
};

export const PERSONA_LIST = Object.values(PERSONAS);

export interface CompanyPreset {
  id: string;
  name: string;
  companies: Company[];
  format: string;
  ai: string;
  personas: PersonaId[];
  modelSwitching: boolean;
  minutes: number;
  levels: Level[];
  /** Preferred languages for picking problems. */
  langs?: string[];
}

export const PRESETS: CompanyPreset[] = [
  {
    id: 'google', name: 'Google', companies: ['google'], minutes: 45, levels: [3, 4, 5],
    format: 'Pilot code comprehension round. Unfamiliar 200–500 line codebase; read, debug and optimise existing code. File explorer, editor, AI chat.',
    ai: 'Single fixed assistant', personas: ['helpful-senior'], modelSwitching: false,
  },
  {
    id: 'meta', name: 'Meta', companies: ['meta'], minutes: 60, levels: [4, 5],
    format: 'AI-enabled coding round in a CoderPad-style IDE. Multi-file codebase, one theme across multiple stages, large data files.',
    ai: 'Several models, switchable mid-round', personas: ['helpful-senior', 'confident-intern', 'tunnel-vision', 'rate-limited'], modelSwitching: true,
  },
  {
    id: 'atlassian', name: 'Atlassian', companies: ['atlassian'], minutes: 60, levels: [3, 4, 5],
    format: 'Repository task with an interviewer observing: debug or implement features in a backend service.',
    ai: 'Agent with Plan and Agent modes', personas: ['agent-mode', 'helpful-senior'], modelSwitching: true,
  },
  {
    id: 'canva', name: 'Canva', companies: ['canva'], minutes: 60, levels: [3, 4, 5],
    format: 'AI-assisted coding interview. Graded heavily on catching the AI’s mistakes.',
    ai: 'Bring-your-own style chat, heavy bug injection', personas: ['confident-intern', 'api-dreamer', 'lazy-copier'], modelSwitching: true,
  },
  {
    id: 'apple', name: 'Apple', companies: ['apple'], minutes: 45, levels: [3, 4, 5],
    format: 'IDE-based round. No verified public description of an AI round: practise pure comprehension.',
    ai: 'No AI', personas: [], modelSwitching: false,
  },
  {
    id: 'finance', name: 'BlackRock / Banks', companies: ['blackrock', 'goldman', 'jpmorgan'], minutes: 60, levels: [3, 4, 5],
    format: 'Risk, portfolio and ledger codebases in Java and Python. Precision, money handling and correctness under scrutiny.',
    ai: 'Single weak assistant', personas: ['outdated-docs', 'helpful-senior'], modelSwitching: false,
  },
  {
    id: 'quant', name: 'Quant firms', companies: ['jane-street', 'citadel', 'hrt', 'optiver', 'two-sigma', 'de-shaw'], minutes: 60, levels: [4, 5],
    format: 'Future-proof prep: order books, market data, pricing and latency-sensitive C++/Python/TS code, with deep semantics questions.',
    ai: 'No AI or rate-limited', personas: ['rate-limited'], modelSwitching: false,
  },
];
